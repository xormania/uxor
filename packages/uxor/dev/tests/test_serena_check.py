"""Check the consumer evidence harness; real provider behavior belongs to CI."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

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
        self.exercise_probe()

    def test_exercise_rejects_an_editor_reporting_a_successful_read_only_edit(self):
        self.exercise_probe(edit_succeeds=True, error="failure was not reported as expected")

    def test_exercise_rejects_incorrect_results_for_each_navigation_check(self):
        for operation, error in (
            ("s.lsp.find_symbol(", "fixture controller was not returned"),
            ("s.lsp.find_referencing_symbols(", "did not find the controller's reference"),
            ("s.lsp.get_symbols_overview(", "did not return the Stimulus action"),
        ):
            with self.subTest(operation=operation):
                self.exercise_probe(wrong_symbol=operation, error=error)

    def exercise_probe(self, *, edit_succeeds=False, wrong_symbol=None, error=None):
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
                    self.write = "--write" in argv
                    self.closed = False
                    instances.append(self)

                def repl(self, code):
                    if wrong_symbol and code.startswith(wrong_symbol):
                        return {"ok": True, "result": "UnrelatedSymbol"}
                    if "forbidden-write" in code:
                        if self.write or edit_succeeds:
                            return {"ok": True, "result": ""}
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
                if error:
                    with self.assertRaisesRegex(RuntimeError, error):
                        check.exercise(Client, ["editor"], scratch, protected, 30)
                else:
                    result = check.exercise(Client, ["editor"], scratch, protected, 30)
                    self.assertEqual("passed", result["status"])
                    self.assertIn("read-only-session-denies-source-edit", result["checks"])
                    self.assertEqual(8, len(result["checks"]))
            finally:
                check.ROOT = original_root
            self.assertEqual([True] if wrong_symbol else [True, False], [instance.write for instance in instances])
            self.assertTrue(all(instance.closed for instance in instances))
            self.assertEqual("protected source", protected.read_text())

    def test_check_publishes_current_evidence_on_success_and_removes_it_on_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dev = root / "packages/uxor/dev"
            controller = root / check.APPLICATION / "src/Controller/DevelopmentController.php"
            controller.parent.mkdir(parents=True)
            controller.write_text("protected controller")
            receipt = dev / ".state/serena-evidence.json"
            editor = Mock()
            editor.prepare.return_value = "sha256:prepared"
            editor.image_tag.return_value = "uxor-dev-serena:test"
            outcomes = [{"status": "passed", "checks": ["probe"]}, RuntimeError("probe failed")]
            output = io.StringIO()
            with patch.object(check, "ROOT", root), patch.object(check, "DEV", dev), \
                    patch.object(check, "load_module", return_value=editor), patch.object(check, "exercise", side_effect=outcomes), \
                    redirect_stdout(output):
                self.assertEqual(0, check.main([]))
                self.assertTrue(receipt.is_file(), "verification passed without publishing its receipt")
                stored = json.loads(receipt.read_text())
                self.assertEqual(json.loads(output.getvalue()), stored)
                self.assertEqual("passed", stored["status"])
                self.assertEqual(["probe"], stored["checks"])
                self.assertEqual("sha256:prepared", stored["image"])
                with self.assertRaisesRegex(RuntimeError, "probe failed"):
                    check.main([])
                self.assertFalse(receipt.exists())
            self.assertEqual([], list(controller.parent.parent.glob("SerenaRecoveryProbe*.php")))

    def test_contending_verifier_cannot_clear_evidence_until_the_lock_is_released(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / ".state"
            receipt = state / "serena-evidence.json"
            with check.verification_state(state):
                receipt.write_text("first verifier is still finishing")
                with self.assertRaisesRegex(RuntimeError, "Another Serena verification"), check.verification_state(state):
                    self.fail("a second verifier acquired the same lock")
                self.assertEqual("first verifier is still finishing", receipt.read_text())
            with check.verification_state(state):
                self.assertFalse(receipt.exists())

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
