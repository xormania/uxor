"""Check task binding and targeted recovery; actual provider proof runs in CI."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("composition", Path(__file__).parents[1] / "composition.py")
composition = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(composition)


class CompositionTest(unittest.TestCase):
    def test_the_bound_application_is_the_nested_consumer_of_this_repository(self):
        repository = Path(__file__).resolve().parents[4]
        self.assertTrue((repository / composition.APPLICATION / "composer.json").is_file())
        self.assertEqual(Path(__file__).resolve().parents[1] / "app", repository / composition.APPLICATION)
        self.assertEqual("/workspace/packages/uxor/dev/app", composition.WORKSPACE_APPLICATION)

    def test_wrong_application_binding_is_rejected_before_recording_success(self):
        def cell(client, code):
            return json.dumps({"exit_code": 0, "cwd": "/some/other/application", "data": {}})

        task = composition.CompositionTask(cell, Path("/workspace"))
        with self.assertRaisesRegex(RuntimeError, "intended application"):
            task.command(None, "inspection", ["php", "vendor/bin/uxor", "inspect", "--format=json"])
        self.assertEqual([], task.trace)

    def test_recovery_targets_the_partial_change_and_preserves_customization(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / composition.APPLICATION / "src/Probe.php"
            scratch.parent.mkdir(parents=True)
            scratch.write_text("after-probe keep-this-project-value")

            def cell(client, code):
                if code.startswith("s.lsp.find_symbol"):
                    return scratch.read_text()
                if code.startswith("s.edit.replace_content"):
                    scratch.write_text(scratch.read_text().replace("after-probe", "recovered-probe"))
                    return "None"
                return json.dumps({"exit_code": 0, "cwd": composition.WORKSPACE_APPLICATION,
                                   "data": {"state": "recovered-probe", "customization": "keep-this-project-value"}})

            task = composition.CompositionTask(cell, root)
            checks = task.recover(None, scratch)
            self.assertIn("inspect-then-recover-without-replay", checks)
            self.assertEqual("recovered-probe keep-this-project-value", scratch.read_text())
            self.assertEqual(["inspect-failed-cell-before-retry", "verify-recovered-customized-source"],
                             [step["step"] for step in task.trace])
