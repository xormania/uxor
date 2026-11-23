"""Test the live controller with short processes. CI also drives the real Composer suite."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import pty
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
run = Path(os.environ['TMPDIR'])
if '--print-target' in sys.argv:
    if '--target-version' in sys.argv:
        print(sys.argv[sys.argv.index('--target-version') + 1])
    else:
        print(Path('candidate.txt').read_text())
    sys.exit(0)
print(json.dumps(sys.argv[1:]), flush=True)
if '--target-version' in sys.argv:
    version = sys.argv[sys.argv.index('--target-version') + 1]
    if version == '0.4.7':
        sys.exit(47)
    if version == '1.0.0':
        sys.exit(77)
    if version == '0.4.1':
        child = subprocess.Popen([sys.executable, '-c', "import time; time.sleep(30)"])
        (run / 'child.pid').write_text(str(child.pid))
        time.sleep(30)
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

    def cli(self, *args, code=0):
        result = subprocess.run([sys.executable, str(self.script), *map(str, args)], env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(code, result.returncode, result.stderr)
        return result.stdout

    def worker(self, story, target, timeout=10):
        run = Path(tempfile.mkdtemp(dir=self.base, prefix="uxor-lifecycle-"))
        record = {"checkout": str(self.checkout), "revision": self.revision, "story": story,
                  "target_version": target, "timeout_seconds": timeout, "started": time.time()}
        (run / "run.json").write_text(json.dumps(record))
        return run

    def evidence(self, run):
        return json.loads(self.cli("collect", run))

    def test_worker_and_watch_preserve_log_arguments_and_suite_exit_codes(self):
        for target, state, code in [("dev-candidate", "passed", 0), ("0.4.7", "failed", 47), ("1.0.0", "skipped", 77)]:
            with self.subTest(target=target):
                story = "lifecycle" if code == 0 else "release-upgrade"
                run = self.worker(story, target)
                output = self.cli("_run", run, code=code)
                self.assertEqual(output, self.cli("watch", run, code=code))
                args = ["--consumer" if code == 0 else "--release-upgrade", "--revision", self.revision,
                        "--target-version", target]
                self.assertEqual(args, json.loads(output))
                self.assertEqual(state, self.evidence(run)["state"])
                self.assertEqual(code, json.loads((run / "result.json").read_text())["exit_code"])

    def test_timeout_terminates_suite_children_and_retains_evidence(self):
        run = self.worker("lifecycle", "0.4.1", timeout=1)
        self.cli("_run", run, code=124)
        self.assertEqual("timed_out", self.evidence(run)["state"])
        pid = (run / "child.pid").read_text()
        state = subprocess.run(["ps", "-o", "stat=", "-p", pid], capture_output=True, text=True)
        self.assertTrue(not state.stdout.strip() or state.stdout.strip().startswith("Z"), state.stdout)
        self.assertIn("--consumer", (run / "output.log").read_text())

    def test_lost_tmux_server_waits_for_a_live_worker_then_persists_interruption(self):
        run = self.worker("lifecycle", "dev-candidate")
        (run / "output.log").touch()
        tmux = self.base / "tmux"
        tmux.write_text("#!/bin/sh\nexit 1\n")
        tmux.chmod(0o700)
        self.env["PATH"] = str(self.base) + os.pathsep + self.env["PATH"]
        with (run / "run.json").open() as owner:
            fcntl.flock(owner, fcntl.LOCK_EX)
            self.assertEqual("running", json.loads(self.cli("status", run))["state"])
        self.cli("wait", run, code=125)
        result = json.loads((run / "result.json").read_text())
        self.assertEqual(("interrupted", 125), (result["state"], result["exit_code"]))

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
            os.write(terminal, b"\x02d")  # default tmux prefix, then detach
            self.assertEqual(0, client.wait(timeout=5))
        self.cli("stop", live, code=130)
        self.assertEqual("stopped", self.evidence(live)["state"])
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


if __name__ == "__main__":
    unittest.main()
