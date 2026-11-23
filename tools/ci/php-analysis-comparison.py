#!/usr/bin/env python3
"""Compare diagnostics on the Kit PHP scope without changing its PHPStan gate."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import time


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ("phpstan", "mago-analyze", "mago-lint", "mago-format")
COMPLETE = {"clean", "findings"}
DEMO_AUTOLOAD = "demo/vendor/autoload.php"
TEST_CONTAINER = "demo/var/cache/test/App_KernelTestDebugContainer.xml"
TOOL_TIMEOUT_SECONDS = 300
DIGEST = r"sha256:[0-9a-f]{64}"

# Strip absolute filesystem paths from messages as well as normalizing their
# file field. The JSON report never includes raw stdout/stderr or tool argv.
ABSOLUTE_PATH = re.compile(
    r"""(?<![\w./\\-])(?:file://)?(?:[A-Za-z]:[\\/]|/)[^\s"'<>:;,\x60()[\]{}]+"""
)
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


class ReportError(ValueError):
    def __init__(self, outcome: str, reason: str):
        super().__init__(reason)
        self.outcome = outcome
        self.reason = reason


def scope_files(root: Path) -> list[str]:
    # Match the directory discovery in the Kit PHP job, then pass the same
    # explicit list to each tool. Mago's wider default paths are not used.
    directories = [
        manifest.parent / "src"
        for manifest in root.glob("*/manifest.json")
        if not manifest.parent.name.startswith(".")
        and manifest.is_file()
        and (manifest.parent / "src").is_dir()
    ]
    directories.extend(root / path for path in ("demo/src/Demo", "demo/tests"))
    if any(not directory.is_dir() or directory.resolve() != directory for directory in directories):
        raise ReportError("tool_error", "scope_directories_unavailable")
    return sorted({
        path.relative_to(root).as_posix()
        for directory in directories
        for path in directory.rglob("*.php")
        if path.is_file()
    })


def run(command: list[str], root: Path, *, timeout: int = TOOL_TIMEOUT_SECONDS) -> subprocess.CompletedProcess:
    return subprocess.run(
        command, cwd=root, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )


def diagnostic_path(path: str, root: Path, scope: set[str], *, mago: bool) -> str | None:
    if not isinstance(path, str) or not path:
        raise ValueError
    candidate = PurePosixPath(path)
    if ".." in candidate.parts:
        raise ValueError
    if mago and candidate.is_relative_to("/app"):
        candidate = candidate.relative_to("/app")
    elif candidate.is_absolute():
        if not candidate.is_relative_to(root.as_posix()):
            return None
        candidate = candidate.relative_to(root.as_posix())
    return candidate.as_posix() if candidate.as_posix() in scope else None


def sanitize(message: str, root: Path) -> str:
    # Normalize the known mount and checkout first, including names with spaces.
    message = ANSI.sub("", message)
    pattern = re.compile(r"(?<![\w./\\-])(?:file://)?(?:" + re.escape(f"{root}/") + r"|/app/)")
    message = pattern.sub("", message)
    return ABSOLUTE_PATH.sub("<path>", message)


def diagnostic(tool: str, file: str, line: int | None, rule: str | None, severity: str,
               message: str, root: Path) -> dict:
    if line is not None and (type(line) is not int or line < 1):
        raise ValueError
    if rule is not None and (not isinstance(rule, str) or not re.fullmatch(r"[\w][\w./:-]*", rule)):
        raise ValueError
    if not isinstance(message, str) or not message.strip():
        raise ValueError
    return dict(tool=tool, file=file, line=line, rule=rule, severity=severity, message=sanitize(message, root))


def phpstan_findings(report: dict, root: Path, scope: set[str]) -> list[dict]:
    totals = report["totals"]
    errors = report["errors"]
    files = report["files"]
    if (not isinstance(files, dict) or not isinstance(errors, list)
            or type(totals["errors"]) is not int or totals["errors"] != len(errors)
            or type(totals["file_errors"]) is not int):
        raise ValueError
    if errors:
        # Global failures (such as internal errors) mean the analysis is
        # incomplete, even when the report also contains some file diagnostics.
        raise ReportError("tool_error", "phpstan_reported_global_errors")
    findings = []
    for path, entry in files.items():
        file = diagnostic_path(path, root, scope, mago=False)
        messages = entry["messages"]
        if (file is None or not isinstance(messages, list)
                or type(entry["errors"]) is not int or entry["errors"] != len(messages)):
            raise ValueError
        for row in messages:
            findings.append(diagnostic(
                "phpstan", file, row["line"], row.get("identifier"), "error", row["message"], root,
            ))
    if totals["file_errors"] != len(findings):
        raise ValueError
    return findings


def mago_findings(report: dict, tool: str, root: Path, scope: set[str]) -> list[dict]:
    findings = []
    issues = report["issues"]
    if not isinstance(issues, list):
        raise ValueError
    for issue in issues:
        severity = issue["level"].lower()
        primary = [note["span"] for note in issue["annotations"] if note["kind"] == "Primary"]
        if severity not in {"error", "warning", "help", "note"}:
            raise ValueError

        locations: dict[tuple[str, int], None] = {}
        for span in primary:
            file = diagnostic_path(span["file_id"]["name"], root, scope, mago=True)
            line = span["start"]["line"]
            if type(line) is not int or line < 0:
                raise ValueError
            if file is not None:
                locations[file, line + 1] = None
        # The other end of a diagnostic may refer to a dependency. Publish
        # only its in-scope primaries, using the first of those as the headline.
        if not locations:
            raise ValueError
        file, line = next(iter(locations))
        row = diagnostic(tool, file, line, issue["code"], severity, issue["message"], root)
        if len(locations) > 1:
            row["locations"] = [dict(file=file, line=line) for file, line in locations]
        findings.append(row)
    return findings


def format_count(process: subprocess.CompletedProcess, file_count: int) -> int:
    # The formatter reports a total on stderr for --check.
    report = ANSI.sub("", process.stderr)
    clean = report.count("All files are already formatted.")
    changes = re.findall(r"Found (\d+) file\(s\) need formatting\.", report)
    if not clean and not changes:
        raise ReportError("missing_report", "formatter_summary_missing")
    if process.returncode == 0 and clean == 1 and not changes:
        return 0
    if process.returncode == 1 and not clean and len(changes) == 1 and 0 < int(changes[0]) <= file_count:
        return int(changes[0])
    raise ValueError


def tool_result(start: float, process: subprocess.CompletedProcess | None, outcome: str,
                findings: list[dict] | None = None, reason: str | None = None) -> dict:
    return {
        "outcome": outcome,
        "exit_code": process.returncode if process is not None else None,
        "duration_ms": round((time.monotonic() - start) * 1000),
        "findings_count": len(findings) if findings is not None else None,
        "by_rule": dict(Counter(row["rule"] or "(unspecified)" for row in findings)) if findings is not None else None,
        "by_severity": dict(Counter(row["severity"] for row in findings)) if findings is not None else None,
        "reason": reason,
    }


def run_analysis(tool: str, paths: list[str | Path], phpstan: str | Path, *, root: Path = ROOT) -> tuple[dict, list[dict]]:
    """Run one tool on explicit relative PHP paths and return its result and findings."""
    if tool not in TOOLS:
        raise ValueError(f"Unknown comparison tool {tool!r}")
    root = root.resolve()
    start = time.monotonic()
    process = None
    try:
        scope = {Path(path).as_posix() for path in paths}
        if not scope:
            raise ReportError("tool_error", "empty_scope")
        for file in scope:
            path = root / file
            if (PurePosixPath(file).is_absolute() or ".." in Path(file).parts or path.suffix != ".php"
                    or path.resolve() != path or not path.is_file()):
                raise ReportError("tool_error", "invalid_scope_file")
        if tool.startswith("mago-") and os.environ.get("MAGO_SETUP", "success") != "success":
            raise ReportError("tool_error", "mago_setup_failed")
        if tool != "mago-format" and not (root / DEMO_AUTOLOAD).is_file():
            raise ReportError("tool_error", "demo_dependencies_missing")
        if tool == "phpstan" and not (root / TEST_CONTAINER).is_file():
            raise ReportError("tool_error", "phpstan_test_container_missing")

        if tool == "phpstan":
            command = [str(root / phpstan), "analyse", "--no-progress", "--no-ansi", "--error-format=json",
                       "--configuration=tools/phpstan.neon", f"--autoload-file={DEMO_AUTOLOAD}"]
        else:
            command = ["tools/mago", "--trust-project-code", tool.removeprefix("mago-")]
            if tool != "mago-format":
                command.extend(["--reporting-format", "json", "--reporting-target", "stdout"])
        process = run([*command, "--", *sorted(scope)], root)
        if process.returncode not in {0, 1}:
            raise ReportError("tool_error", "unexpected_exit_code")
        if tool.startswith("mago-") and "Failed to walk" in process.stderr:
            raise ReportError("tool_error", "mago_skipped_source_paths")
        if tool == "mago-format":
            count = format_count(process, len(scope))
            result = tool_result(start, process, "findings" if count else "clean")
            return result | {"needs_formatting_count": count}, []

        if not process.stdout.strip():
            raise ReportError("missing_report", "empty_json_output")
        report = json.loads(process.stdout)
        if tool == "phpstan":
            findings = phpstan_findings(report, root, scope)
            if process.returncode != int(bool(findings)):
                raise ValueError
        else:
            findings = mago_findings(report, tool, root, scope)
            if process.returncode != 0 and not findings:
                raise ValueError
        return tool_result(start, process, "findings" if findings else "clean", findings), findings
    except ReportError as error:
        outcome, reason = error.outcome, error.reason
    except subprocess.TimeoutExpired:
        outcome, reason = "tool_error", "timeout"
    except OSError:
        outcome, reason = "tool_error", "process_or_scope_unavailable"
    except (ValueError, TypeError, KeyError, AttributeError):
        outcome, reason = "malformed_report", "invalid_report"
    result = tool_result(start, process, outcome, reason=reason)
    if tool == "mago-format":
        result["needs_formatting_count"] = None
    return result, []


def probe(command: list[str], root: Path) -> str:
    try:
        process = run(command, root, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return process.stdout.strip() if process.returncode == 0 else ""


def version(command: list[str], pattern: str, root: Path) -> str | None:
    match = re.search(pattern, probe(command, root), re.M)
    return match[1] if match else None


def phpstan_extension_versions(phpstan: Path) -> dict[str, str | None]:
    installed = phpstan.parent.parent / "composer/installed.json"
    try:
        packages = json.loads(installed.read_text(encoding="utf-8"))["packages"]
        versions = {package["name"]: package["version"] for package in packages}
    except (OSError, ValueError, KeyError, TypeError):
        versions = {}
    return {f"phpstan_{extension}": versions.get(f"phpstan/phpstan-{extension}") for extension in ("symfony", "phpunit")}


def file_hash(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def mago_image(root: Path) -> tuple[dict, str | None]:
    reference = probe(["tools/mago", "image"], root)
    actual_version = version(["tools/mago", "version"], r"\Amago (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\Z", root)
    metadata: dict[str, str | None] = dict(reference=None, digest=None, id=None,
                                            upstream_reference=None, upstream_digest=None)
    image_name = r"[a-zA-Z0-9][\w./:-]*"
    if not re.fullmatch(image_name + rf"(?:@{DIGEST})?", reference):
        return metadata, actual_version
    metadata["reference"] = reference
    # Read just the image identity and the Mago release label. The locally built image has a distinct PHP base.
    template = ('{"id":{{json .Id}},"repo_digests":{{json .RepoDigests}},'
                '"upstream_reference":{{if .Config.Labels}}{{json (index .Config.Labels "io.uxor.mago.release-image")}}{{else}}null{{end}}}')
    try:
        details = json.loads(probe(["docker", "image", "inspect", "--format", template, reference], root))
    except ValueError:
        return metadata, actual_version
    if not isinstance(details, dict) or not isinstance(details.get("id"), str) or not re.fullmatch(DIGEST, details["id"]):
        return metadata, actual_version
    metadata["id"] = details["id"]
    digests = {ref.rsplit("@", 1)[1] for ref in details.get("repo_digests") or []
               if isinstance(ref, str) and re.fullmatch(image_name + "@" + DIGEST, ref)}
    if "@" in reference:
        metadata["digest"] = reference.rsplit("@", 1)[1]
    elif len(digests) == 1:
        metadata["digest"] = digests.pop()
    upstream = details.get("upstream_reference")
    if isinstance(upstream, str) and re.fullmatch(image_name + "@" + DIGEST, upstream):
        metadata["upstream_reference"], metadata["upstream_digest"] = upstream, upstream.rsplit("@", 1)[1]
    return metadata, actual_version


def error_locations(findings: list[dict], tool: str) -> set[tuple[str, int]]:
    return {
        (location["file"], location["line"])
        for row in findings if row["tool"] == tool and row["severity"] == "error"
        for location in (row, *row.get("locations", ()))
        if location["line"] is not None
    }


def report_overlap(results: dict, findings: list[dict]) -> dict | None:
    if any(results[tool]["outcome"] not in COMPLETE for tool in ("phpstan", "mago-analyze")):
        return None
    phpstan = error_locations(findings, "phpstan")
    mago = error_locations(findings, "mago-analyze")
    return dict(severity="error", shared_locations=len(phpstan & mago), phpstan_only_locations=len(phpstan - mago),
                mago_only_locations=len(mago - phpstan))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phpstan", type=Path, required=True, help="Path to the installed PHPStan executable")
    parser.add_argument("--out", type=Path, required=True, help="Directory for summary.json and findings.jsonl")
    args = parser.parse_args()
    phpstan = args.phpstan.resolve()
    image, mago_version = mago_image(ROOT)
    versions = {
        "php": version(["php", "--version"], r"^PHP (\S+)", ROOT),
        "phpstan": version([str(phpstan), "--version", "--no-ansi"], r"^PHPStan - PHP Static Analysis Tool (\S+)", ROOT),
        "mago": mago_version,
        **phpstan_extension_versions(phpstan),
    }
    provenance = {
        "phpstan_composer_lock_sha256": file_hash(ROOT / "tools/ci/phpstan/composer.lock"),
        "mago_toml_sha256": file_hash(ROOT / "mago.toml"),
    }
    results, findings = {}, []
    try:
        paths = scope_files(ROOT)
    except (ReportError, OSError):
        paths = None
    for tool in TOOLS:
        if paths is None:
            results[tool] = tool_result(time.monotonic(), None, "tool_error", reason="scope_unavailable")
            if tool == "mago-format":
                results[tool]["needs_formatting_count"] = None
            continue
        results[tool], rows = run_analysis(tool, paths, phpstan)
        findings.extend(rows)

    commit = version(["git", "rev-parse", "--verify", "HEAD"], r"^([0-9a-f]{40}|[0-9a-f]{64})$", ROOT)
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    summary = {
        "schema_version": 1,
        "commit": commit,
        "run_id": run_id if re.fullmatch(r"[0-9]+", run_id) else None,
        "run_attempt": int(attempt) if re.fullmatch(r"[0-9]+", attempt) else None,
        "scope": {
            "file_count": len(paths) if paths is not None else None,
            # Hash the sorted, NUL-terminated repository-relative path list.
            "sha256": hashlib.sha256(b"".join(os.fsencode(path) + b"\0" for path in paths)).hexdigest()
            if paths is not None else None,
        },
        "versions": versions,
        "provenance": provenance,
        "mago_image": image,
        "tools": results,
        "overlap": report_overlap(results, findings),
    }
    findings.sort(key=lambda row: (row["tool"], row["file"], row["line"] or 0, row["rule"] or "", row["message"]))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "findings.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in findings), encoding="utf-8",
    )
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return int(not commit or not all(versions.values()) or not all(provenance.values())
               or not image["id"] or not image["upstream_digest"]
               or any(row["outcome"] not in COMPLETE for row in results.values()))


if __name__ == "__main__":
    raise SystemExit(main())
