"""Verify the controlled comparison's scores and failure handling."""
import contextlib
import io
import json
import runpy
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
CI = ROOT / "tools/ci"
evaluation = runpy.run_path(str(CI / "php-analysis-eval.py"))
FIXTURES = "tools/tests/fixtures/php-analysis"


def finding(path, line, rule):
    return {"file": path, "line": line, "rule": rule, "severity": "error"}


class EvaluationTest(unittest.TestCase):
    def test_only_the_expected_fault_at_its_location_counts_as_a_detection(self):
        source = f"{FIXTURES}/return_type/bad.php"
        marked = evaluation["evaluated_line"](ROOT / source)
        findings = [finding(source, marked, "unrelated"), finding(source, marked - 1, "return.type"),
                    finding(source.replace("bad.php", "good.php"), marked, "return.type")]
        analyzer = Mock(return_value=({"outcome": "findings"}, findings))
        report = evaluation["evaluate"](analyzer, "phpstan")
        case = next(c for c in report["cases"] if c["id"] == "return_type")
        self.assertEqual("miss", case["bad"]["tools"]["phpstan"]["status"])
        self.assertEqual("false-positive", case["good"]["tools"]["phpstan"]["status"])
        findings.append(finding(source, marked, "return.type"))
        report = evaluation["evaluate"](analyzer, "phpstan")
        self.assertEqual(1, report["totals"]["phpstan"]["true_positive"])
        self.assertEqual(3, report["totals"]["phpstan"]["true_negative"])
        self.assertEqual(0, report["totals"]["mago"]["true_positive"])

    def test_incomplete_runs_cannot_earn_passes_and_do_not_hide_the_other_tool(self):
        def run(tool, paths, phpstan, *, root):
            outcome = "malformed_report" if tool == "phpstan" else "clean"
            return {"outcome": outcome}, []
        report = evaluation["evaluate"](run, "phpstan")
        totals = report["totals"]
        self.assertEqual(4, totals["phpstan"]["tool_error_bad"])
        self.assertEqual(4, totals["phpstan"]["tool_error_good"])
        self.assertEqual(0, totals["phpstan"]["true_negative"])
        self.assertEqual(4, totals["mago"]["miss"])
        self.assertEqual(4, totals["mago"]["true_negative"])

    def test_one_mago_finding_can_mark_lines_in_two_files(self):
        bad = f"{FIXTURES}/return_type/bad.php"
        good = f"{FIXTURES}/return_type/good.php"
        marked = evaluation["evaluated_line"](ROOT / bad)
        item = finding(bad, marked - 1, "invalid-return-statement")
        item["locations"] = [{"file": bad, "line": marked - 1},
                             {"file": bad, "line": marked}, {"file": good, "line": marked}]
        run = Mock(return_value=({"outcome": "findings"}, [item]))
        report = evaluation["evaluate"](run, "phpstan")
        case = next(c for c in report["cases"] if c["id"] == "return_type")
        result = case["bad"]["tools"]["mago"]
        self.assertEqual("pass", result["status"])
        self.assertCountEqual([marked - 1, marked], [row["line"] for row in result["observed"]])
        self.assertEqual("false-positive", case["good"]["tools"]["mago"]["status"])
        self.assertEqual(1, report["totals"]["mago"]["true_positive"])

    def test_warnings_are_recorded_and_only_errors_are_scored(self):
        good = f"{FIXTURES}/symfony_argument/good.php"
        line = evaluation["evaluated_line"](ROOT / good)
        findings = [dict(finding(path, line, rule), severity="warning")
                    for path, rule in ((good, "ambiguous-object-method-access"),
                                       (good.replace("good.php", "bad.php"), "invalid-argument"))]
        run = Mock(return_value=({"outcome": "findings"}, findings))
        report = evaluation["evaluate"](run, "phpstan")
        case = next(c for c in report["cases"] if c["id"] == "symfony_argument")
        self.assertEqual("pass", case["good"]["tools"]["mago"]["status"])
        self.assertEqual("miss", case["bad"]["tools"]["mago"]["status"])
        self.assertEqual("warning", case["good"]["tools"]["mago"]["observed"][0]["severity"])

    def test_command_publishes_a_complete_report_only_if_both_analyzers_and_runtime_finished(self):
        main = evaluation["main"]
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            for phpstan, mago, runtime, expected in (
                ("clean", "findings", "passed", True),
                ("tool_error", "clean", "passed", False),
                ("clean", "missing_report", "passed", False),
                ("clean", "clean", "failed", False),
                ("findings", "findings", "tool_error", False),
            ):
                with self.subTest(phpstan=phpstan, mago=mago, runtime=runtime):
                    results = [({"outcome": outcome}, []) for outcome in (phpstan, mago)]
                    analyzer = Mock(side_effect=results)
                    with (patch("sys.argv", ["eval", "--phpstan", "phpstan", "--out", directory]),
                          patch("runpy.run_path", return_value={"run_analysis": analyzer}),
                          patch.dict(main.__globals__, {"runtime_evidence": lambda: {"outcome": runtime}}),
                          contextlib.redirect_stdout(io.StringIO())):
                        status = main()
                    report = json.loads((out / "evaluation.json").read_text())
                    self.assertIs(expected, report["complete"])
                    self.assertEqual(0 if expected else 1, status)

    def test_phpunit_evidence_requires_every_selected_test_to_run_and_pass(self):
        expected = [(cls, method) for cls, methods in evaluation["RUNTIME_TESTS"].values() for method in methods]
        for names, skipped, outcome in (
            (expected, False, "passed"),
            (expected[1:], False, "failed"),
            ([expected[0], *expected[:-1]], False, "failed"),
            (expected, True, "failed"),
        ):
            with self.subTest(names=names, skipped=skipped):
                def phpunit(command, **kwargs):
                    suite = ET.Element("testsuite")
                    for cls, method in names:
                        case = ET.SubElement(suite, "testcase", {"class": cls, "name": method})
                        if skipped and (cls, method) == names[0]:
                            ET.SubElement(case, "skipped")
                    ET.ElementTree(suite).write(command[command.index("--log-junit") + 1])
                    return subprocess.CompletedProcess(command, 0)
                with patch("subprocess.run", side_effect=phpunit):
                    self.assertEqual(outcome, evaluation["runtime_evidence"]()["outcome"])

    def test_missing_phpunit_report_never_publishes_process_output(self):
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 1, "", "private-output-marker")):
            runtime = evaluation["runtime_evidence"]()
        self.assertEqual("tool_error", runtime["outcome"])
        self.assertEqual(1, runtime["exit_code"])
        self.assertNotIn("private-output-marker", json.dumps(runtime))

    def test_collector_rejects_missing_malformed_and_crashed_phpstan_reports(self):
        collector = runpy.run_path(str(CI / "php-analysis-comparison.py"))["run_analysis"]
        paths = [f"{FIXTURES}/return_type/good.php"]
        empty = json.dumps({"totals": {"errors": 0, "file_errors": 0}, "files": {}, "errors": []})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for file in (*paths, "demo/vendor/autoload.php", "demo/var/cache/test/App_KernelTestDebugContainer.xml"):
                (root / file).parent.mkdir(parents=True, exist_ok=True)
                (root / file).touch()
            runs = [(None, None, "tool_error"), ("", 0, "missing_report"), ("{", 1, "malformed_report"),
                    (empty, 1, "malformed_report"), (empty, 2, "tool_error")]
            for index, (stdout, status, expected) in enumerate(runs):
                executable = root / f"phpstan-{index}"
                if status is not None:
                    executable.write_text(f"#!/usr/bin/env python3\nprint({stdout!r})\nraise SystemExit({status})\n")
                    executable.chmod(0o755)
                with self.subTest(status=status, output=stdout):
                    result, findings = collector("phpstan", paths, executable, root=root)
                    self.assertEqual(expected, result["outcome"], result)
                    self.assertEqual(status, result["exit_code"])
                    self.assertIsNone(result["findings_count"])
                    self.assertEqual([], findings)


if __name__ == "__main__":
    unittest.main()
