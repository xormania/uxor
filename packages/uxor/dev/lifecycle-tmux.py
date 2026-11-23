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

ROOT = Path(__file__).resolve().parents[3]
SUITE = ROOT / "packages/uxor/tools/check-package.py"


def tmux(run: Path, *arguments: str) -> list[str]:
    return ["tmux", "-S", str(run / "tmux.sock"), "-f", "/dev/null", *arguments]


def finish(run: Path, state: str, code: int) -> None:
    temporary = run / "result.tmp"
    temporary.write_text(json.dumps({"state": state, "exit_code": code, "finished": time.time()}) + "\n")
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
    # Multiple command arguments make tmux exec argv directly, including in a checkout with spaces.
    result = subprocess.run(tmux(run, "new-session", "-d", "-s", "lifecycle", "-c", str(ROOT),
                                 sys.executable, "-u", str(Path(__file__).resolve()), "_run", str(run)))
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
    with (run / "run.json").open() as owner, (run / "output.log").open("ab", buffering=0) as log, \
            (run / "output.log").open("rb") as view:
        fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (run / "result.json").exists():
            raise ValueError("This run has finished. Use repeat to start a fresh run.")
        try:
            deadline = time.monotonic() + record["timeout_seconds"]
            process = subprocess.Popen(args, cwd=ROOT, start_new_session=True, stdout=log, stderr=subprocess.STDOUT,
                                       env=dict(os.environ, TMPDIR=str(run), PYTHONUNBUFFERED="1"))
            while process.poll() is None:
                chunk = view.read(65536)
                if chunk:
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                if interrupted or (run / "stop-requested").exists():
                    state, code = "stopped", 130
                    break
                if time.monotonic() >= deadline:
                    state, code = "timed_out", 124
                    break
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


def wait(run: Path, *, watch: bool = False) -> int:
    with (run / "output.log").open("rb") as log:
        while True:
            result = status(run)
            if watch:
                shutil.copyfileobj(log, sys.stdout.buffer)
                sys.stdout.buffer.flush()
            if result["exit_code"] is not None:
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
        ("status", "Report run state and exit code as JSON"),
        ("stop", "Stop this run and wait for its children"),
        ("collect", "Report the checkout, verdict and retained log as JSON"),
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
    if args.command == "collect":
        result = {**record, **result, "directory": str(run), "log": str(run / "output.log")}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        sys.exit(f"Lifecycle harness: {error}")
