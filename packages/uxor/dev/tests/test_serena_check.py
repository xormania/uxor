"""Check the consumer evidence harness; real provider behavior belongs to CI."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("serena_check", Path(__file__).parents[1] / "check-serena.py")
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


class SerenaEvidenceTest(unittest.TestCase):
    def test_failed_repl_result_cannot_be_reported_as_success(self):
        class Client:
            def repl(self, code):
                return {"ok": False, "result": "RuntimeError: broken"}

            def content(self, result):
                return result

        with self.assertRaisesRegex(RuntimeError, "operation failed"):
            check.cell(Client(), "example")
        self.assertIn("broken", check.cell(Client(), "example", expected_error="broken"))

    def test_exercise_closes_both_sessions_and_checks_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            protected = root / "Controller.php"
            protected.write_text("protected source")
            scratch = root / "Probe.php"
            scratch.write_text("before-probe")
            instances = []

            class Client:
                def __init__(self, argv, timeout):
                    self.session = "session-" + str(len(instances))
                    self.closed = False
                    instances.append(self)

                def repl(self, code):
                    if "forbidden-write" in code:
                        return {"ok": False, "result": "AttributeError: has no attribute 'edit'"}
                    if code.startswith("s.edit.replace_content"):
                        scratch.write_text("after-probe")
                        return {"ok": False, "result": "RuntimeError: uxor-deliberate-failure"}
                    value = "DevelopmentController" if "find_symbol('DevelopmentController'" in code else ""
                    if "find_referencing_symbols" in code:
                        value = "CustomerController/edit"
                    elif "get_symbols_overview" in code:
                        value = "increment"
                    elif "uxor_probe =" in code:
                        value = "41"
                    elif "uxor_probe +" in code:
                        value = "42"
                    elif "globals()" in code:
                        value = "False"
                    return {"ok": True, "result": value}

                def content(self, value):
                    return value

                def close(self):
                    self.closed = True

            original_root = check.ROOT
            try:
                check.ROOT = root
                result = check.exercise(Client, ["editor"], scratch, protected, 30)
            finally:
                check.ROOT = original_root
            self.assertEqual("passed", result["status"])
            self.assertEqual(8, len(result["checks"]))
            self.assertEqual(2, len(instances))
            self.assertTrue(all(instance.closed for instance in instances))
            self.assertEqual("protected source", protected.read_text())

    def test_state_directory_and_lock_symlinks_cannot_redirect_evidence_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.mkdir()
            state = root / ".state"
            state.symlink_to(target, target_is_directory=True)
            with self.assertRaises(OSError), check.verification_state(state):
                self.fail("followed the state directory symlink")
            state.unlink()
            state.mkdir()
            sentinel = target / "sentinel"
            sentinel.write_text("unchanged")
            (state / "serena-check.lock").symlink_to(sentinel)
            with self.assertRaises(OSError), check.verification_state(state):
                self.fail("followed the lock symlink")
            self.assertEqual("unchanged", sentinel.read_text())
            self.assertEqual([sentinel], list(target.iterdir()))
