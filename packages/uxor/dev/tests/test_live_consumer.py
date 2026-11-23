"""Accept a real tmux lifecycle from another process, or start an opt-in local release upgrade."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import unittest


HARNESS = Path(__file__).resolve().parents[1] / "lifecycle-tmux.py"
RUN_TIMEOUT = 1200


def control(*args, timeout=30):
    return subprocess.run([sys.executable, str(HARNESS), *map(str, args)], stdout=subprocess.PIPE,
                          text=True, timeout=timeout)


def report(command, run):
    result = control(command, run)
    result.check_returncode()
    return json.loads(result.stdout)


def in_upgrade_window(receipt):
    target = receipt["target_version"]
    if target == "dev-candidate":
        # This identity means development following the archived checkout's latest numbered heading.
        changelog = subprocess.check_output(["git", "show", f"{receipt['revision']}:CHANGELOG.md"],
                                           cwd=HARNESS.parents[3], text=True, timeout=15)
        heading = re.search(r"^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$", changelog, re.MULTILINE)
        if not heading:
            raise ValueError("Cannot determine the historical upgrade window of the pinned development checkout")
        return tuple(map(int, heading[1].split("."))) < (0, 9, 9)
    if not re.fullmatch(r"\d+\.\d+\.\d+", target):
        raise ValueError("Unrecognized candidate identity")
    return tuple(map(int, target.split("."))) <= (0, 9, 9)


def verify(receipt, observed):
    if receipt["state"] != "passed" or receipt["exit_code"] != 0 or "telemetry_error" in receipt:
        raise ValueError("Successful lifecycle must have a passing verdict and valid operation journal")
    if observed is None:
        raise ValueError("No operation was observed while the real suite was running")
    rows = receipt["timeline"]
    final = next((row for row in rows if row["operation_id"] == observed["operation_id"]), None)
    if (not final or final["state"] != "succeeded" or final["name"] != observed["name"]
            or final["started_at"] != observed["started_at"] or observed["elapsed_seconds"] < 0):
        raise ValueError("Terminal timeline did not confirm the independently observed operation")

    names = [row["name"] for row in rows if row["state"] == "succeeded"]
    in_window = in_upgrade_window(receipt)
    if ("release-window.exceeded" in names) == in_window:
        raise ValueError("Historical upgrade events contradict the pinned release version")
    if receipt["story"] == "lifecycle":
        if not all(name in names for name in ("consumer.agent-handoff", "consumer.update", "consumer.remove")):
            raise ValueError("The full lifecycle lacks its successful install, update or removal operation")
        if not in_window:
            if "release-upgrade" in names:
                raise ValueError("The advertised historical skip contradicts the recorded upgrade")
            return
    if not in_window:
        raise ValueError("A focused historical upgrade beyond its window must report a skipped outcome")
    if "release-upgrade" not in names or names.index("baseline.customized-component") >= names.index("candidate.customized-component"):
        raise ValueError("The release upgrade lacks its successful baseline and candidate render sequence")
    transcript = Path(receipt["log"]).read_text()
    for version in ("0.3.2", receipt["target_version"]):
        if f"Confirmed xormania/uxor {version} in composer.lock and the installed UXor CLI." not in transcript:
            raise ValueError(f"The real consumer did not confirm version {version} in its lock and installed CLI")


def observe(run):
    """Stream the public watch command; a failing suite always keeps its own exit code."""
    print(f"Observing live Composer lifecycle: {run}", flush=True)
    watcher = subprocess.Popen([sys.executable, str(HARNESS), "watch", str(run)])
    deadline = time.monotonic() + RUN_TIMEOUT + 15
    observed = None
    observation_error = None
    try:
        try:
            remaining_budget = report("collect", run)["timeout_seconds"]
            if type(remaining_budget) is not int or remaining_budget <= 0:
                raise ValueError("The run has an invalid timeout")
            deadline = time.monotonic() + remaining_budget + 15
            while watcher.poll() is None and time.monotonic() < deadline:
                status = report("status", run)
                if status["state"] != "running":
                    break
                observed = status["current_operation"]
                if observed is not None:
                    last = status["last_successful_operation"]
                    print(f"Live operation {observed['operation_id']} {observed['name']} after {last['name'] if last else 'launch'}", flush=True)
                    break
                time.sleep(0.1)
        except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
            observation_error = error
        code = watcher.wait(timeout=max(0.1, deadline - time.monotonic()))
    finally:
        if watcher.poll() is None:
            watcher.kill()
            watcher.wait()

    if code == 77:
        receipt = report("collect", run)
        if (receipt["state"] != "skipped" or receipt["story"] != "release-upgrade" or in_upgrade_window(receipt)
                or not any(row["name"] == "release-window.exceeded" and row["state"] == "succeeded"
                           for row in receipt["timeline"])):
            raise ValueError("Focused upgrade skip contradicts the historical window or lacks its recorded check")
    if code:
        if observation_error is not None:
            print(f"Observer diagnostic: {observation_error}", file=sys.stderr)
        return code
    if observation_error is not None:
        raise observation_error
    control("wait", run).check_returncode()
    receipt = report("collect", run)
    verify(receipt, observed)
    print(f"Verified live observation against {len(receipt['timeline'])} recorded operations.", flush=True)
    return 0


class ObserverContractTest(unittest.TestCase):
    def test_a_spurious_historical_skip_cannot_pass_a_numbered_release(self):
        names = ("consumer.agent-handoff", "consumer.update", "consumer.remove", "release-window.exceeded")
        rows = [{"name": name, "operation_id": i, "state": "succeeded", "started_at": i}
                for i, name in enumerate(names, 1)]
        receipt = {"state": "passed", "exit_code": 0, "story": "lifecycle", "timeline": rows}
        observed = rows[0] | {"state": "running", "elapsed_seconds": 0.1}
        for version in ("0.3.5", "0.9.9"):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "contradict"):
                verify(receipt | {"target_version": version}, observed)
        verify(receipt | {"target_version": "0.10.0"}, observed)


@unittest.skipUnless(os.environ.get("UXOR_TEST_TMUX") == "1" or os.environ.get("UXOR_TEST_LIVE_CONSUMER") == "1",
                     "Set UXOR_TEST_LIVE_CONSUMER=1 to observe a real Composer upgrade through tmux")
class LiveConsumerTest(unittest.TestCase):
    def test_observe_real_release_upgrade(self):
        upgrade_timeout = 300
        start = control("start", "--story", "release-upgrade", "--timeout", upgrade_timeout, timeout=upgrade_timeout + 15)
        self.assertEqual(start.returncode, 0, start.stdout)
        run = Path(start.stdout.strip())
        try:
            code = observe(run)
        except BaseException:
            control("stop", run)
            raise
        if code == 77:
            self.skipTest("The selected release is outside the historical upgrade window")
        self.assertEqual(0, code, run)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--observe":
        try:
            sys.exit(observe(Path(sys.argv[2])))
        except (OSError, KeyError, ValueError, TypeError, subprocess.SubprocessError) as error:
            sys.exit(f"Live lifecycle observer failed: {error}")
    unittest.main()
