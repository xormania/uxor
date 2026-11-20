"""Exercise the comparison collector without PHPStan or Docker."""

import json
from pathlib import Path
import runpy
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
COLLECTOR = runpy.run_path(str(ROOT / "tools/ci/php-analysis-comparison.py"))
RECIPE_FILE = "-recipe/src/Example.php"
DEMO_FILE = "demo/src/Demo/Table.php"
TEST_FILE = "demo/tests/TableTest.php"


def issue(path=RECIPE_FILE, line=0, kind="Primary", level="Error", message="Unexpected type."):
    return {
        "level": level,
        "code": "invalid-argument",
        "message": message,
        "annotations": [{"kind": kind, "span": {"file_id": {"name": path}, "start": {"line": line}}}],
    }


class ComparisonTest(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        for path in (
            "-recipe/manifest.json", RECIPE_FILE, DEMO_FILE, TEST_FILE,
            "demo/vendor/autoload.php", "demo/var/cache/test/App_KernelTestDebugContainer.xml",
        ):
            self.touch(path)

    def touch(self, name):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()

    def analyze(self, tool, paths):
        return COLLECTOR["run_analysis"](tool, paths, "phpstan", root=self.root)

    def mago_report(self, report, status=0, paths=(RECIPE_FILE,)):
        with patch("subprocess.run", return_value=CompletedProcess([], status, json.dumps(report), "")):
            return self.analyze("mago-analyze", paths)

    def test_mago_uses_primary_location_and_converts_line_to_one_based(self):
        entry = issue(f"/app/{RECIPE_FILE}", level="Warning",
                      message=f"Received input from {self.root}/{RECIPE_FILE} via '/tmp/worker.php'.")
        entry["annotations"][:0] = issue("/app/demo/secondary.php", 40, "Secondary")["annotations"]
        result, rows = self.mago_report({"issues": [entry]})

        self.assertEqual("findings", result["outcome"])
        self.assertEqual(0, result["exit_code"])
        self.assertEqual({"warning": 1}, result["by_severity"])
        self.assertEqual([{
            "tool": "mago-analyze", "file": RECIPE_FILE, "line": 1, "rule": "invalid-argument",
            "severity": "warning", "message": f"Received input from {RECIPE_FILE} via '<path>'.",
        }], rows)

    def test_mago_keeps_one_finding_for_multiple_distinct_in_scope_primaries(self):
        entry = issue("/app/demo/vendor/dependency.php", 9)
        entry["annotations"].extend(
            issue(path, line)["annotations"][0]
            for path, line in ((RECIPE_FILE, 0), (DEMO_FILE, 6), (f"/app/{DEMO_FILE}", 6))
        )
        result, rows = self.mago_report({"issues": [entry]}, status=1, paths=[RECIPE_FILE, DEMO_FILE])

        self.assertEqual("findings", result["outcome"])
        self.assertEqual(1, result["findings_count"])
        self.assertEqual({"error": 1}, result["by_severity"])
        self.assertEqual([{
            "tool": "mago-analyze", "file": RECIPE_FILE, "line": 1, "rule": "invalid-argument",
            "severity": "error", "message": "Unexpected type.",
            "locations": [{"file": RECIPE_FILE, "line": 1}, {"file": DEMO_FILE, "line": 7}],
        }], rows)

    def test_mago_rejects_invalid_and_out_of_scope_locations(self):
        for entry in (issue(line=-1), issue(kind="Secondary"), issue(path=DEMO_FILE),
                      issue(path="/outside/Example.php"), issue(path="../Example.php")):
            with self.subTest(entry=entry):
                result, rows = self.mago_report({"issues": [issue(), entry]}, status=1)
                self.assertEqual("malformed_report", result["outcome"])
                self.assertIsNone(result["findings_count"])
                self.assertEqual([], rows)

    def test_invalid_input_paths_never_start_a_tool(self):
        link = self.root / "-recipe/src/Alias.php"
        link.symlink_to(self.root / RECIPE_FILE)
        for path in (str(self.root / RECIPE_FILE), "../Outside.php", "demo/tests/missing.php",
                     "-recipe/manifest.json", link.relative_to(self.root)):
            with self.subTest(path=path), patch("subprocess.run") as process:
                result, rows = self.analyze("mago-analyze", [path])
                process.assert_not_called()
                self.assertEqual("tool_error", result["outcome"])
                self.assertIsNone(result["exit_code"])
                self.assertEqual([], rows)

    def test_both_analyzers_receive_the_same_explicit_kit_php_files(self):
        for path in ("other/src/Unrelated.php", "-recipe/src/notes.txt", "demo/src/Controller/Excluded.php"):
            self.touch(path)
        paths = COLLECTOR["scope_files"](self.root)
        expected = [RECIPE_FILE, DEMO_FILE, TEST_FILE]
        self.assertEqual(expected, paths)
        reports = (
            CompletedProcess([], 0, '{"totals":{"errors":0,"file_errors":0},"files":{},"errors":[]}', ""),
            CompletedProcess([], 0, '{"issues":[]}', ""),
        )
        with patch("subprocess.run", side_effect=reports) as processes:
            for tool in ("phpstan", "mago-analyze"):
                result, _ = self.analyze(tool, [*reversed(paths), RECIPE_FILE])
                self.assertEqual("clean", result["outcome"])
        self.assertEqual(2, processes.call_count)
        phpstan, mago = [process.args[0] for process in processes.call_args_list]
        self.assertEqual([str(self.root / "phpstan"), "analyse"], phpstan[:2])
        self.assertEqual(["tools/mago", "analyze"], mago[:2])
        for command in (phpstan, mago):
            self.assertEqual(expected, command[command.index("--") + 1:])

    def test_clean_mago_report_requires_a_valid_empty_issue_list_and_success(self):
        for report, status, expected, count in (
            ({"issues": []}, 0, "clean", 0),
            ({"issues": []}, 1, "malformed_report", None),
            ({"issues": {}}, 0, "malformed_report", None),
        ):
            with self.subTest(report=report, status=status):
                result, rows = self.mago_report(report, status)
                self.assertEqual(expected, result["outcome"])
                self.assertEqual(count, result["findings_count"])
                self.assertEqual([], rows)

    def test_overlap_counts_unique_located_errors_from_both_analyzers(self):
        findings = [
            {"tool": tool, "file": RECIPE_FILE, "line": line, "severity": severity}
            for tool, line, severity in (
                ("phpstan", 1, "error"), ("phpstan", 2, "error"), ("phpstan", 4, "error"),
                ("phpstan", None, "error"),
                ("mago-analyze", 1, "error"), ("mago-analyze", 1, "error"),
                ("mago-analyze", 2, "warning"), ("mago-lint", 2, "error"),
            )
        ]
        findings.extend([
            {"tool": "mago-analyze", "file": DEMO_FILE, "line": 2, "severity": "error"},
            {"tool": "mago-analyze", "file": RECIPE_FILE, "line": 3, "severity": "error",
             "locations": [{"file": RECIPE_FILE, "line": 3}, {"file": RECIPE_FILE, "line": 4}]},
        ])
        outcomes = {"phpstan": {"outcome": "findings"}, "mago-analyze": {"outcome": "findings"}}
        compare = COLLECTOR["report_overlap"]
        self.assertEqual({
            "severity": "error", "shared_locations": 2,
            "phpstan_only_locations": 1, "mago_only_locations": 2,
        }, compare(outcomes, findings))
        for tool in outcomes:
            with self.subTest(tool=tool):
                self.assertIsNone(compare(outcomes | {tool: {"outcome": "malformed_report"}}, findings))


if __name__ == "__main__":
    unittest.main()
