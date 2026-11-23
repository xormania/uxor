"""Test the live controller with short processes. CI also drives the real Composer suite."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time
import unittest

HARNESS = Path(__file__).resolve().parents[1] / "lifecycle-tmux.py"
SHORT_SUITE = """
import json, os, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dev'))
from lifecycle_events import operation
run = Path(os.environ['TMPDIR'])
if '--print-target' in sys.argv:
    if '--target-version' in sys.argv:
        print(sys.argv[sys.argv.index('--target-version') + 1])
    else:
        print(Path('candidate.txt').read_text())
    sys.exit(0)
print(json.dumps(sys.argv[1:]), flush=True)
with operation('fixture.prepare'):
    pass
if '--target-version' in sys.argv:
    version = sys.argv[sys.argv.index('--target-version') + 1]
    if version == '1.0.0':
        sys.exit(77)
    try:
        with operation('fixture.composer'):
            if version == '0.4.7':
                subprocess.run([sys.executable, '-c', 'raise SystemExit(47)'], check=True)
            if version == '0.4.1':
                child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
                (run / 'child.pid').write_text(str(child.pid))
                while not (run / 'release').exists():
                    time.sleep(0.05)
                child.terminate()
                child.wait()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
    finally:
        damage = os.environ.get("DAMAGE_FIXTURE_JOURNAL")
        if damage == "corrupt-row":
            with Path(os.environ["UXOR_LIFECYCLE_EVENTS"]).open("ab") as journal:
                journal.write(b"private invalid row\\n")
        if damage == "drop-completion":
            path = Path(os.environ["UXOR_LIFECYCLE_EVENTS"])
            path.write_bytes(b"".join(path.read_bytes().splitlines(keepends=True)[:-1]))
"""


@contextmanager
def open_pty_client(script, run, env):
    master, slave = pty.openpty()
    try:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))

        def control_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        client = subprocess.Popen([sys.executable, str(script), "attach", str(run)],
                                  stdin=slave, stdout=slave, stderr=slave, preexec_fn=control_terminal,
                                  env=dict(env, TERM="xterm", TMUX="outer,1,0"))
        try:
            yield client, master
        finally:
            if client.poll() is None:
                client.kill()
            client.wait()
    finally:
        os.close(slave)
        os.close(master)


class LifecycleHarnessTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.base = Path(directory.name).resolve()
        self.checkout = self.base / "checkout with 'spaces'$(printf foo)"
        self.script = self.checkout / "packages/uxor/dev/lifecycle-tmux.py"
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(HARNESS, self.script)
        shutil.copyfile(HARNESS.with_name("lifecycle_events.py"), self.script.with_name("lifecycle_events.py"))
        suite = self.checkout / "packages/uxor/tools/check-package.py"
        suite.parent.mkdir()
        suite.write_text(SHORT_SUITE)
        (self.checkout / "candidate.txt").write_text("0.4.7")
        self.env = dict(os.environ, TMPDIR=str(self.base))
        self.git("init", "--quiet")
        self.commit()
        self.revision = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.checkout, text=True)

    def commit(self):
        self.git("-c", "user.name=UXor tests", "-c", "user.email=tests@example.invalid",
                 "commit", "--allow-empty", "--quiet", "-m", "fixture")

    def cli(self, *args, code=0, stderr_contains=()):
        result = subprocess.run([sys.executable, str(self.script), *map(str, args)], env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(code, result.returncode, result.stderr)
        for fragment in stderr_contains:
            self.assertIn(fragment, result.stderr)
        return result.stdout

    def worker(self, story, target, timeout=10):
        run = Path(tempfile.mkdtemp(dir=self.base, prefix="uxor-lifecycle-"))
        record = {"checkout": str(self.checkout), "revision": self.revision, "story": story,
                  "target_version": target, "timeout_seconds": timeout, "started": time.time()}
        (run / "run.json").write_text(json.dumps(record))
        return run

    def evidence(self, run):
        return json.loads(self.cli("collect", run))

    def unavailable_tmux(self):
        tmux = self.base / "tmux"
        tmux.write_text("#!/bin/sh\nexit 1\n")
        tmux.chmod(0o700)
        self.env["PATH"] = str(self.base) + os.pathsep + self.env["PATH"]

    def assert_quiet_progress(self, run):
        # The suite writes child.pid after its start event and blocks on an explicit release.
        deadline = time.monotonic() + 8
        while not (run / "child.pid").exists():
            self.assertLess(time.monotonic(), deadline, "the quiet operation never started")
            time.sleep(0.05)
        initial = json.loads(self.cli("status", run))
        self.assertEqual("running", initial["state"])
        operation = initial["current_operation"]
        self.assertEqual("fixture.composer", operation["name"])
        self.assertEqual("running", operation["state"])
        self.assertEqual("fixture.prepare", initial["last_successful_operation"]["name"])
        log = (run / "output.log").read_bytes()
        self.assertNotIn("timeline", initial)
        while True:
            observed = self.evidence(run)
            current = observed["current_operation"]
            self.assertEqual(operation["operation_id"], current["operation_id"])
            if current["elapsed_seconds"] > operation["elapsed_seconds"]:
                break
            self.assertLess(time.monotonic(), deadline, "elapsed time stayed fixed during a silent command")
            time.sleep(0.05)
        self.assertEqual(log, (run / "output.log").read_bytes())
        self.assertEqual(["succeeded", "running"], [row["state"] for row in observed["timeline"]])

    def assert_interrupted_operation(self, run, state):
        evidence = self.evidence(run)
        self.assertEqual(state, evidence["state"])
        self.assertEqual("fixture.prepare", evidence["last_successful_operation"]["name"])
        operation = evidence["current_operation"]
        self.assertEqual(("fixture.composer", "interrupted"), (operation["name"], operation["state"]))
        self.assertEqual(["succeeded", "interrupted"], [row["state"] for row in evidence["timeline"]])
        self.assertEqual(operation, json.loads(self.cli("status", run))["current_operation"])

    def assert_terminal_shows_operation(self, terminal):
        deadline = time.monotonic() + 8
        output = bytearray()
        while b"fixture.composer" not in output:
            remaining = deadline - time.monotonic()
            self.assertGreater(remaining, 0, "the terminal never showed the quiet operation")
            if select.select([terminal], [], [], remaining)[0]:
                output.extend(os.read(terminal, 16384))

    def test_worker_and_watch_preserve_log_arguments_and_suite_exit_codes(self):
        for target, state, code in [("dev-candidate", "passed", 0), ("0.4.7", "failed", 47), ("1.0.0", "skipped", 77)]:
            with self.subTest(target=target):
                story = "lifecycle" if code == 0 else "release-upgrade"
                run = self.worker(story, target)
                output = self.cli("_run", run, code=code)
                diagnostics = ("2 lifecycle operations recorded", "last success: fixture.prepare",
                               "failed: fixture.composer") if code == 47 else ()
                self.assertEqual(output, self.cli("watch", run, code=code, stderr_contains=diagnostics))
                args = ["--consumer" if code == 0 else "--release-upgrade", "--revision", self.revision,
                        "--target-version", target]
                self.assertEqual(args, json.loads(output))
                evidence = self.evidence(run)
                self.assertEqual(state, evidence["state"])
                expected_states = ["succeeded"] if code == 77 else ["succeeded", "failed" if code else "succeeded"]
                self.assertEqual(expected_states, [row["state"] for row in evidence["timeline"]])
                self.assertIsNone(evidence["current_operation"])
                self.assertEqual("fixture.prepare" if code else "fixture.composer",
                                 evidence["last_successful_operation"]["name"])
                self.assertEqual(code, json.loads((run / "result.json").read_text())["exit_code"])

    def test_timeout_terminates_suite_children_and_retains_evidence(self):
        run = self.worker("lifecycle", "0.4.1", timeout=1)
        self.cli("_run", run, code=124)
        self.assert_interrupted_operation(run, "timed_out")
        pid = (run / "child.pid").read_text()
        state = subprocess.run(["ps", "-o", "stat=", "-p", pid], capture_output=True, text=True)
        self.assertTrue(not state.stdout.strip() or state.stdout.strip().startswith("Z"), state.stdout)
        self.assertIn("--consumer", (run / "output.log").read_text())

    def test_lost_tmux_server_waits_for_a_live_worker_then_persists_interruption(self):
        run = self.worker("lifecycle", "dev-candidate")
        (run / "output.log").touch()
        self.unavailable_tmux()
        with (run / "run.json").open() as owner:
            fcntl.flock(owner, fcntl.LOCK_EX)
            self.assertEqual("running", json.loads(self.cli("status", run))["state"])
        self.cli("wait", run, code=125)
        result = json.loads((run / "result.json").read_text())
        self.assertEqual(("interrupted", 125), (result["state"], result["exit_code"]))
        self.assertEqual([], self.evidence(run)["timeline"], "existing runs without events remain inspectable")

    def test_delayed_observation_of_a_lost_worker_reports_only_proven_duration(self):
        run = self.worker("lifecycle", "dev-candidate")
        self.unavailable_tmux()
        # The writer exits during an operation. These clocks make recovery occur long after its last observation.
        writer = """
import os
from unittest.mock import patch
from lifecycle_events import operation
with patch('lifecycle_events.time.monotonic', side_effect=[10.0, 12.0, 15.0]):
    with patch('lifecycle_events.time.time', side_effect=[110.0, 112.0, 115.0]):
        with operation('composer.update'):
            with operation('mate.inspect'):
                pass
            os._exit(19)
"""
        result = subprocess.run([sys.executable, "-c", writer], cwd=self.script.parent,
                                env=dict(self.env, UXOR_LIFECYCLE_EVENTS=str(run / "events.jsonl")))
        self.assertEqual(19, result.returncode)
        evidence = self.evidence(run)
        self.assertEqual(("interrupted", 125), (evidence["state"], evidence["exit_code"]))
        self.assertIsNone(evidence["finished"])
        self.assertGreater(evidence["observed_at"], 115)
        current = evidence["current_operation"]
        self.assertEqual(("composer.update", "interrupted"), (current["name"], current["state"]))
        self.assertIsNone(current["elapsed_seconds"])
        self.assertEqual((5.0, "last_event"), (current["elapsed_at_least_seconds"], current["elapsed_basis"]))

    def test_corrupt_telemetry_preserves_the_actual_suite_verdict(self):
        for damage in ("corrupt-row", "drop-completion"):
            self.env["DAMAGE_FIXTURE_JOURNAL"] = damage
            for target, state, code in [("dev-candidate", "passed", 0), ("0.4.7", "failed", 47)]:
                with self.subTest(state=state, damage=damage):
                    run = self.worker("lifecycle", target)
                    self.cli("_run", run, code=code)
                    self.cli("watch", run, code=code)
                    evidence = self.evidence(run)
                    self.assertEqual((state, code), (evidence["state"], evidence["exit_code"]))
                    self.assertTrue(evidence["telemetry_error"])
                    self.assertNotIn("private invalid row", evidence["telemetry_error"])
                    self.assertEqual(2, len(evidence["timeline"]))
                    if damage == "drop-completion":
                        last = evidence["timeline"][-1]
                        self.assertEqual("incomplete", last["state"])
                        self.assertIsNone(last["elapsed_seconds"])

    def test_status_and_collect_observe_a_quiet_worker_then_its_success(self):
        run = self.worker("release-upgrade", "0.4.1", timeout=20)
        # No server or Unix socket is needed: ownership is the real worker's file lock.
        self.unavailable_tmux()
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        self.addCleanup(os.close, slave)
        worker = subprocess.Popen([sys.executable, str(self.script), "_run", str(run)], env=self.env,
                                  stdout=slave)
        try:
            self.assert_quiet_progress(run)
            self.assert_terminal_shows_operation(master)
        finally:
            (run / "release").touch()
            worker.wait(timeout=8)
        self.assertEqual(0, worker.returncode)
        self.assertEqual("fixture.composer", self.evidence(run)["last_successful_operation"]["name"])

    def test_existing_run_observer_preserves_suite_failures_and_requires_live_proof(self):
        observer = self.script.parent / "tests/test_live_consumer.py"
        observer.parent.mkdir()
        shutil.copyfile(HARNESS.parent / "tests/test_live_consumer.py", observer)
        for target, suite_code, observer_code in [("0.4.7", 47, 47), ("dev-candidate", 0, 1)]:
            with self.subTest(target=target):
                run = self.worker("release-upgrade", target)
                self.cli("_run", run, code=suite_code)
                result = subprocess.run([sys.executable, str(observer), "--observe", str(run)],
                                        env=self.env, capture_output=True, text=True, timeout=15)
                self.assertEqual(observer_code, result.returncode, result.stderr)
                self.assertEqual(suite_code, self.evidence(run)["exit_code"])

    @unittest.skipUnless(os.environ.get("UXOR_TEST_TMUX") == "1", "Set UXOR_TEST_TMUX=1 to exercise real tmux")
    def test_tmux_sessions_are_independent_and_repeat_pins_the_original_archive(self):
        def start(command, *options):
            run = Path(self.cli(command, *options).strip())
            # On a failed assertion, terminate only this test's private server.
            self.addCleanup(subprocess.run, ["tmux", "-S", str(run / "tmux.sock"), "kill-server"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return run

        live = start("start", "--story", "release-upgrade", "--target-version", "0.4.1", "--timeout", "25")
        other = start("start", "--target-version", "0.4.1", "--timeout", "25")
        self.assertEqual("running", json.loads(self.cli("status", live))["state"])
        with open_pty_client(self.script, live, self.env) as (client, terminal):
            for _ in range(50):
                clients = subprocess.check_output(["tmux", "-S", str(live / "tmux.sock"), "list-clients"])
                if clients:
                    break
                time.sleep(0.1)
            self.assertTrue(clients, "attach did not establish a tmux client")
            # An attached terminal and a JSON observer share the same live run.
            self.assert_quiet_progress(live)
            self.assert_terminal_shows_operation(terminal)
            os.write(terminal, b"\x02d")  # default tmux prefix, then detach
            self.assertEqual(0, client.wait(timeout=5))
        self.cli("stop", live, code=130)
        self.assert_interrupted_operation(live, "stopped")
        self.assertEqual("running", json.loads(self.cli("status", other))["state"])
        self.cli("stop", other, code=130)

        failed = start("start", "--story", "release-upgrade")
        output = self.cli("watch", failed, code=47)
        self.commit()
        (self.checkout / "candidate.txt").write_text("dev-candidate")
        self.assertNotEqual(self.revision, self.git("rev-parse", "HEAD").strip())
        repeated = start("repeat", failed)
        self.assertNotEqual(failed, repeated)
        self.assertEqual(output, self.cli("watch", repeated, code=47))
        for run in [failed, repeated]:
            self.assertEqual(self.revision, self.evidence(run)["revision"])
            self.assertEqual("release-upgrade", self.evidence(run)["story"])
            self.assertEqual("0.4.7", self.evidence(run)["target_version"])
            self.assertEqual(output, (run / "output.log").read_text())
            timeline = self.evidence(run)["timeline"]
            self.assertEqual(["succeeded", "failed"], [row["state"] for row in timeline])
        self.assertNotEqual(self.evidence(failed)["events"], self.evidence(repeated)["events"])


if __name__ == "__main__":
    unittest.main()
