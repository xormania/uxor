#!/usr/bin/env python3
"""Score paired, executable PHP type examples separately from repository findings."""
import argparse
import json
from pathlib import Path
import runpy
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path("tools/tests/fixtures/php-analysis")
# Credit the diagnostic identifying the seeded mistake. For example, uncertainty
# about a Symfony service's type does not identify the argument it was passed.
CASES = {
    "return_type": ("Returning a string from a function declared to return int.",
                    "return.type", "invalid-return-statement"),
    "nullable_receiver": ("Calling a method on a possibly null date without a guard.",
                          "method.nonObject", "possible-method-access-on-null"),
    "symfony_argument": ("Passing a Response to the request_stack service's push(Request).",
                         "argument.type", "invalid-argument"),
    "phpunit_narrowing": ("Calling getStatusCode() after PHPUnit narrowed the object to Request.",
                          "method.notFound", "non-existent-method"),
}
COMPLETE_OUTCOMES = {"clean", "findings"}
SCORES = {"bad": {"pass": "true_positive", "miss": "miss", "tool-error": "tool_error_bad"},
          "good": {"pass": "true_negative", "false-positive": "false_positive", "tool-error": "tool_error_good"}}
RUNTIME_TESTS = {
    FIXTURES / "GroundTruthTest.php":
        ("UXor\\AnalysisEvaluation\\GroundTruthTest",
         ["testReturnType", "testNullableReceiver", "testSymfonyArgument", "testPhpunitNarrowing"]),
    Path("demo/tests/Editor/EditorTypeTest.php"):
        ("App\\Tests\\Editor\\EditorTypeTest", ["testMaxCharsCountsCharactersOfTextNotBytes"]),
    Path("demo/tests/Property/MarkupPropertyTest.php"):
        ("App\\Tests\\Property\\MarkupPropertyTest", ["testTheMarkdownRendererIsStableAndKeepsNothingUnsafe"]),
}


def evaluated_line(path):
    matches = [n for n, line in enumerate(path.read_text().splitlines(), 1) if line.endswith("// evaluated")]
    if len(matches) != 1:
        raise ValueError(f"{path} must mark exactly one evaluated expression")
    return matches[0]


def classify(variant, outcome, expected_rule, rules_on_line):
    if outcome not in COMPLETE_OUTCOMES:
        return "tool-error"
    if variant == "bad":
        return "pass" if expected_rule in rules_on_line else "miss"
    return "false-positive" if rules_on_line else "pass"


def observations_by_file(findings):
    observed = {}
    for finding in findings:
        locations = [finding, *finding.get("locations", [])]
        # The primary location on the row can also appear in its locations list.
        for file, line in dict.fromkeys((site["file"], site["line"]) for site in locations):
            observed.setdefault(file, []).append({"line": line, "rule": finding["rule"], "severity": finding["severity"]})
    return observed


def evaluate(run_analysis, phpstan):
    cases = []
    paths = []
    for name, (description, phpstan_rule, mago_rule) in CASES.items():
        case = {"id": name, "fault": description, "expected_rules": {"phpstan": phpstan_rule, "mago": mago_rule}}
        for variant in ("bad", "good"):
            path = (FIXTURES / name / f"{variant}.php").as_posix()
            paths.append(path)
            case[variant] = {"file": path, "line": evaluated_line(ROOT / path),
                             "expected": "fault" if variant == "bad" else "clean", "tools": {}}
        cases.append(case)
    report = {
        "schema_version": 1,
        "scoring": "At the marked line, a bad example requires the expected rule at error severity. "
                   "A good example passes with no error at that line. All file diagnostics remain in observed.",
        "cases": cases, "runs": {}, "totals": {},
    }
    for name, command in (("phpstan", "phpstan"), ("mago", "mago-analyze")):
        run, findings = run_analysis(command, paths, phpstan, root=ROOT)
        report["runs"][name] = run
        by_file = observations_by_file(findings)
        totals = dict.fromkeys((score for scores in SCORES.values() for score in scores.values()), 0)
        for case in cases:
            for variant in ("bad", "good"):
                target = case[variant]
                observed = by_file.get(target["file"], [])
                errors = {f["rule"] for f in observed if f["line"] == target["line"] and f["severity"] == "error"}
                status = classify(variant, run["outcome"], case["expected_rules"][name], errors)
                target["tools"][name] = {"status": status, "observed": observed}
                totals[SCORES[variant][status]] += 1
        report["totals"][name] = totals
    return report


def runtime_evidence():
    methods = [method for _, names in RUNTIME_TESTS.values() for method in names]
    expected = sorted(f"{cls}::{method}" for cls, names in RUNTIME_TESTS.values() for method in names)
    with tempfile.TemporaryDirectory() as temporary:
        junit = Path(temporary) / "runtime.xml"
        command = ["php", "demo/bin/phpunit", "-c", "demo/phpunit.dist.xml", "--no-progress", "--log-junit", str(junit),
                   "--filter", "::(" + "|".join(methods) + ")$", *map(str, RUNTIME_TESTS)]
        try:
            result = subprocess.run(command, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
        except (OSError, subprocess.TimeoutExpired):
            return {"outcome": "tool_error", "exit_code": None, "tests": [], "reason": "phpunit_process_unavailable"}
        try:
            cases = ET.parse(junit).findall(".//testcase")
        except (OSError, ET.ParseError):
            return {"outcome": "tool_error", "exit_code": result.returncode, "tests": [],
                    "reason": "phpunit_report_missing_or_invalid"}
        actual = sorted(f"{case.get('class')}::{case.get('name')}" for case in cases)
        if actual != expected:
            return {"outcome": "failed", "exit_code": result.returncode, "tests": sorted(set(expected) & set(actual)),
                    "reason": "unexpected_phpunit_test_selection"}
        if result.returncode != 0 or any(item.tag in ("failure", "error", "skipped") for case in cases for item in case):
            return {"outcome": "failed", "exit_code": result.returncode, "tests": actual,
                    "reason": "phpunit_test_failure_or_skip"}
        return {"outcome": "passed", "exit_code": 0, "tests": actual}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phpstan", required=True, help="PHPStan executable with the repository's extensions")
    parser.add_argument("--out", required=True, type=Path, help="directory for evaluation.json")
    args = parser.parse_args()
    run_analysis = runpy.run_path(str(Path(__file__).with_name("php-analysis-comparison.py")))["run_analysis"]
    report = evaluate(run_analysis, args.phpstan)
    report["runtime"] = runtime_evidence()
    report["complete"] = (all(run["outcome"] in COMPLETE_OUTCOMES for run in report["runs"].values())
                          and report["runtime"]["outcome"] == "passed")
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / "evaluation.json"
    with tempfile.NamedTemporaryFile(mode="w", dir=args.out, delete=False) as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    Path(output.name).replace(path)
    print(f"{path}: {json.dumps(report['totals'])}, runtime {report['runtime']['outcome']}")
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
