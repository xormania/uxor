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
                    if code.startswith("s.edit.replace_content"):
                        scratch.write_text("after-probe")
                        return {"ok": False, "result": "RuntimeError: uxor-deliberate-failure"}
                    value = "DevelopmentController" if "find_symbol('DevelopmentController'" in code else ""
                    if "uxor_probe =" in code:
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
                result = check.exercise(Client, ["external-provider"], scratch, protected, 30)
            finally:
                check.ROOT = original_root
            self.assertEqual("passed", result["status"])
            self.assertEqual(5, len(result["checks"]))
            self.assertEqual(2, len(instances))
            self.assertTrue(all(instance.closed for instance in instances))
            self.assertEqual("protected source", protected.read_text())
