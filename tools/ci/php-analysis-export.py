#!/usr/bin/env python3
"""Export one JSON line per PHP analysis workflow attempt through the GitHub REST API."""

import argparse
import io
import json
import re
import subprocess
import sys
from itertools import islice
import zipfile
from urllib.parse import urlencode

WORKFLOW = ".github/workflows/php-analysis-comparison.yml"
JEV_WORKFLOW = ".github/workflows/jev.yml"
MAX_ZIP = 32 * 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024


def api(endpoint):
    return subprocess.check_output(["gh", "api", endpoint])


def get(endpoint):
    return json.loads(api(endpoint))


def pages(endpoint, key, params=None):
    page = 1
    while True:
        query = urlencode({**(params or {}), "per_page": 100, "page": page})
        batch = get(f"{endpoint}?{query}")[key]
        yield from batch
        if len(batch) < 100:
            return
        page += 1


def reports(base, artifact, names):
    if artifact["expired"]:
        return {"availability": "expired"}
    if artifact["size_in_bytes"] > MAX_ZIP:
        raise ValueError(f"artifact {artifact['id']} exceeds the download limit")
    data = api(f"{base}/actions/artifacts/{artifact['id']}/zip")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        result = {"availability": "available"}
        for name in names:
            if name not in archive.namelist():
                continue
            member = archive.getinfo(name)
            if member.file_size > MAX_REPORT:
                raise ValueError(f"oversized {name} in artifact {artifact['id']}")
            result[name.removesuffix(".json")] = json.loads(archive.read(member))
        return result


def identity(report):
    return (report.get("commit"), str(report.get("run_id")), str(report.get("run_attempt")))


def jev_report(base, run, attempt):
    name = f"php-analysis-jev-{run['id']}-{attempt}"
    for artifact in pages(f"{base}/actions/artifacts", "artifacts", {"name": name}):
        if artifact["name"] != name:
            continue
        consumer = get(f"{base}/actions/runs/{artifact['workflow_run']['id']}")
        if consumer["path"] != JEV_WORKFLOW or consumer["event"] != "workflow_run":
            continue
        result = reports(base, artifact, ["assessment.json"])
        assessment = result.get("assessment")
        if assessment is not None:
            source = assessment["source"]
            if (source.get("repository"), str(source.get("run_id")), str(source.get("run_attempt")), source.get("sha")) != (
                base.removeprefix("repos/"), str(run["id"]), str(attempt), run["head_sha"]
            ):
                continue
        return result
    return {"availability": "not_published"}


def export_run(base, repo, run, include_jev):
    if run["path"] != WORKFLOW:
        raise ValueError(f"run {run['id']} belongs to {run['path']}")
    artifacts = {a["name"]: a for a in pages(f"{base}/actions/runs/{run['id']}/artifacts", "artifacts")}
    for attempt in range(1, run["run_attempt"] + 1):
        name = f"php-analysis-comparison-{run['id']}-{attempt}"
        artifact = artifacts.get(name)
        row = {
            "schema_version": 1, "repository": repo, "run_id": run["id"], "run_attempt": attempt,
            "commit": run["head_sha"], "branch": run["head_branch"], "run_created_at": run["created_at"],
            "artifact_id": artifact["id"] if artifact else None,
        }
        data = (reports(base, artifact, ["run.json", "summary.json", "evaluation.json"])
                if artifact else {"availability": "not_published"})
        if data["availability"] == "available":
            manifest = data.get("run", {})
            measured = data.get("summary")
            expected = (run["head_sha"], str(run["id"]), str(attempt))
            if (manifest.get("repository") != repo or identity(manifest) != expected
                    or measured is not None and identity(measured) != expected):
                data = {"availability": "invalid_provenance"}
        row.update(data)
        if include_jev:
            row["jev"] = jev_report(base, run, attempt)
        print(json.dumps(row, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="xormania/uxor")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--run", type=int, help="one workflow run, including its retries")
    selection.add_argument("--branch", help="filter recent runs by branch")
    parser.add_argument("--limit", type=int, default=20, help="number of recent runs (default 20)")
    parser.add_argument("--with-jev", action="store_true", help="join the trusted advisory assessment when published")
    args = parser.parse_args()
    if args.limit < 1 or not re.fullmatch(r"[\w.-]+/[\w.-]+", args.repo):
        parser.error("supply a positive run limit and an owner/repository name")
    base = f"repos/{args.repo}"
    if args.run is not None:
        runs = [get(f"{base}/actions/runs/{args.run}")]
    else:
        params = {"branch": args.branch} if args.branch else {}
        runs = pages(f"{base}/actions/workflows/php-analysis-comparison.yml/runs", "workflow_runs", params)
    for run in islice(runs, args.limit):
        export_run(base, args.repo, run, args.with_jev)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
