#!/usr/bin/env python3
"""Run the Composer lifecycle acceptance suite in a private, attachable tmux session."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

from lifecycle_events import progress

ROOT = Path(__file__).resolve().parents[3]
SUITE = ROOT / "packages/uxor/tools/check-package.py"


def tmux(run: Path, *arguments: str) -> list[str]:
    return ["tmux", "-S", str(run / "tmux.sock"), "-f", "/dev/null", *arguments]


def finish(run: Path, state: str, code: int) -> None:
    result = {"state": state, "exit_code": code, "finished": None}
    if state == "interrupted":  # Another process discovered the loss. The worker's actual end time is unknown.
        result["observed_at"] = time.time()
    else:
        result.update(finished=time.time(), finished_monotonic=time.monotonic())
    result.update(progress(run / "events.jsonl", terminal_state=state, finished=result["finished"],
                           finished_monotonic=result.get("finished_monotonic"), timeline=True))
    temporary = run / "result.tmp"
    temporary.write_text(json.dumps(result) + "\n")
    temporary.replace(run / "result.json")


def start(story: str, target: str | None, timeout: int, revision: str | None = None) -> int:
    if not shutil.which("tmux"):
        raise ValueError("Install tmux on the host that runs the lifecycle suite.")
    if timeout <= 0:
        raise ValueError("The timeout must be positive (seconds).")
    if revision is None:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        describe = [sys.executable, str(SUITE), "--print-target", "--revision", revision]
        if target is not None:
            describe.extend(["--target-version", target])
        target = subprocess.check_output(describe, cwd=ROOT, text=True, timeout=timeout).strip()
    run = Path(tempfile.mkdtemp(prefix="uxor-lifecycle-")).resolve()
    record = {"checkout": str(ROOT), "revision": revision, "story": story, "target_version": target,
              "timeout_seconds": timeout, "started": time.time()}
    (run / "run.json").write_text(json.dumps(record, indent=2) + "\n")
    (run / "output.log").touch(mode=0o600)
    (run / "events.jsonl").touch(mode=0o600)
    # Multiple command arguments make tmux exec argv directly, including in a checkout with spaces.
    result = subprocess.run(tmux(run, "new-session", "-d", "-s", "lifecycle", "-c", str(ROOT),
                                 sys.executable, "-u", str(Path(__file__).resolve()), "_run", str(run),
                                 ";", "set-option", "status-right-length", "100",
                                 ";", "set-option", "status-interval", "1",
                                 ";", "set-option", "status-right", "#{pane_title}"))
    print(run)
    if result.returncode:
        finish(run, "launch_failed", 125)
        print(f"tmux launch failed. Evidence: {run}", file=sys.stderr)
        return 125
    return 0


def interrupt_group(process: subprocess.Popen) -> None:
    # Isolate and reap the lifecycle's HTTP server and Composer children when it is interrupted.
    try:
        os.killpg(process.pid, signal.SIGTERM)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            process.poll()
            os.killpg(process.pid, 0)
            time.sleep(0.1)
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def update_pane_title(journal: Path) -> None:
    operations = progress(journal)
    current = operations["current_operation"]
    if current is not None:
        title = f"{current['name']} ({int(current['elapsed_seconds'])}s)"
        parents = [row["name"] for row in operations["active_operations"][:-1]]
        if parents:
            title += " | " + " / ".join(parents)
    elif operations["last_successful_operation"] is not None:
        title = f"Completed {operations['last_successful_operation']['name']}"
    else:
        title = "Waiting for lifecycle operation"
    # Write the tmux pane title to its terminal only. Watchers and output.log keep the exact suite transcript.
    sys.stdout.write("\033]2;" + title + "\007")
    sys.stdout.flush()


def worker(run: Path, record: dict) -> int:
    interrupted = False

    def request_stop(signum, frame):
        nonlocal interrupted
        interrupted = True

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, request_stop)

    selector = "--consumer" if record["story"] == "lifecycle" else "--release-upgrade"
    args = [sys.executable, "-u", str(SUITE), selector, "--revision", record["revision"],
            "--target-version", record["target_version"]]
    state, code = "failed", 1
    process = None
    journal = run / "events.jsonl"
    with (run / "run.json").open() as owner, (run / "output.log").open("ab", buffering=0) as log, \
            (run / "output.log").open("rb") as view:
        fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (run / "result.json").exists():
            raise ValueError("This run has finished. Use repeat to start a fresh run.")
        try:
            deadline = time.monotonic() + record["timeout_seconds"]
            next_title = 0 if sys.stdout.isatty() else float("inf")
            process = subprocess.Popen(args, cwd=ROOT, start_new_session=True, stdout=log, stderr=subprocess.STDOUT,
                                       env=dict(os.environ, TMPDIR=str(run), PYTHONUNBUFFERED="1",
                                                UXOR_LIFECYCLE_EVENTS=str(journal)))
            while process.poll() is None:
                chunk = view.read(65536)
                if chunk:
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                if interrupted or (run / "stop-requested").exists():
                    state, code = "stopped", 130
                    break
                now = time.monotonic()
                if now >= deadline:
                    state, code = "timed_out", 124
                    break
                if now >= next_title:
                    update_pane_title(journal)
                    next_title = now + 1
                if not chunk:
                    time.sleep(0.1)
            else:
                code = process.returncode if process.returncode >= 0 else 128 - process.returncode
                state = {0: "passed", 77: "skipped"}.get(code, "failed")
        except OSError as error:
            log.write(f"Lifecycle harness: {error}\n".encode())
        finally:
            if process is not None and (state in ("stopped", "timed_out") or process.poll() is None):
                interrupt_group(process)
            finish(run, state, code)
        if not interrupted:
            shutil.copyfileobj(view, sys.stdout.buffer)
    return code


def status(run: Path) -> dict:
    result = run / "result.json"
    if result.exists():
        return json.loads(result.read_text())
    live = subprocess.run(tmux(run, "has-session", "-t", "=lifecycle"), stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL)
    if live.returncode:
        with (run / "run.json").open() as owner:
            try:
                fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass  # The worker may still be cleaning up after its terminal closed.
            else:
                if not result.exists():
                    finish(run, "interrupted", 125)
    if result.exists():
        return json.loads(result.read_text())
    return {"state": "running", "exit_code": None}


def print_summary(result: dict) -> None:
    timeline = result.get("timeline", [])
    if timeline:
        parts = [f"{len(timeline)} lifecycle operations recorded"]
        last = result["last_successful_operation"]
        if last:
            parts.append(f"last success: {last['name']} [operation {last['operation_id']}]")
        operation = result["current_operation"]
        if operation is None and result["exit_code"]:
            operation = next((row for row in reversed(timeline) if row["state"] == "failed"), None)
        if operation:
            elapsed = operation["elapsed_seconds"]
            duration = (f"{elapsed:.1f}s" if elapsed is not None
                        else f"at least {operation['elapsed_at_least_seconds']:.1f}s")
            parts.append(f"{operation['state']}: {operation['name']} [operation {operation['operation_id']}] ({duration})")
        print(", ".join(parts), file=sys.stderr)
    if result.get("telemetry_error"):
        print(result["telemetry_error"], file=sys.stderr)


def wait(run: Path, *, watch: bool = False) -> int:
    with (run / "output.log").open("rb") as log:
        while True:
            result = status(run)
            if watch:
                shutil.copyfileobj(log, sys.stdout.buffer)
                sys.stdout.buffer.flush()
            if result["exit_code"] is not None:
                if watch:
                    print_summary(result)
                print(f'{result["state"]} (exit {result["exit_code"]}) — {run}', file=sys.stderr)
                return result["exit_code"]
            time.sleep(0.5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True,
                                     metavar="{start,attach,watch,wait,status,stop,collect,repeat}")
    first = commands.add_parser("start", help="Start detached and print the evidence directory")
    first.add_argument("--story", choices=["lifecycle", "release-upgrade"], default="lifecycle",
                       help="Run the full lifecycle (default) or only the released-baseline upgrade")
    first.add_argument("--target-version", metavar="X.Y.Z", help="Override the current candidate version")
    first.add_argument("--timeout", type=int, default=1200, metavar="SECONDS", help="Maximum suite duration (default 1200)")
    for name, description in (
        ("attach", "Attach to the live terminal (detach with Ctrl-b d)"),
        ("watch", "Follow the full log and return the suite exit code"),
        ("wait", "Wait and return the suite exit code"),
        ("status", "Report state, current operation, elapsed time and latest success as JSON"),
        ("stop", "Stop this run and wait for its children"),
        ("collect", "Report the checkout, verdict, operation timeline and evidence paths as JSON"),
        ("repeat", "Start a fresh run of the recorded commit with the same options"),
    ):
        commands.add_parser(name, help=description).add_argument("directory", type=Path)
    commands.add_parser("_run").add_argument("directory", type=Path)
    args = parser.parse_args()
    if args.command == "start":
        return start(args.story, args.target_version, args.timeout)
    run = args.directory.resolve(strict=True)
    record = json.loads((run / "run.json").read_text())
    if not run.name.startswith("uxor-lifecycle-") or record.get("checkout") != str(ROOT):
        raise ValueError("Use the run directory printed by this checkout's start command.")
    if args.command == "_run":
        return worker(run, record)
    if args.command == "repeat":
        return start(record["story"], record["target_version"], record["timeout_seconds"], record["revision"])
    if args.command == "attach":
        env = dict(os.environ)
        env.pop("TMUX", None)
        return subprocess.call(tmux(run, "attach-session", "-t", "=lifecycle"), env=env)
    if args.command in ("watch", "wait"):
        return wait(run, watch=args.command == "watch")
    result = status(run)
    if args.command == "stop":
        if result["state"] == "running":
            (run / "stop-requested").touch(mode=0o600)
            return wait(run)
        return result["exit_code"]
    journal = run / "events.jsonl"
    if "timeline" not in result:  # Running now, or a receipt written by an earlier harness.
        result.update(progress(journal, terminal_state=result["state"], finished=result.get("finished"),
                               finished_monotonic=result.get("finished_monotonic"), timeline=args.command == "collect"))
    if args.command == "collect":
        result = {**record, **result, "directory": str(run), "log": str(run / "output.log"),
                  "events": str(journal) if journal.exists() else None}
    else:
        result.pop("timeline", None)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        sys.exit(f"Lifecycle harness: {error}")
