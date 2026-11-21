import contextlib
import importlib.util
import io
import json
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


source = Path(__file__).resolve().parents[1] / "ci/php-analysis-export.py"
spec = importlib.util.spec_from_file_location("php_analysis_export", source)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTest(unittest.TestCase):
    def test_retries_keep_expired_and_missing_samples_distinct_from_zero_findings(self):
        run = dict(id=42, run_attempt=3, path=exporter.WORKFLOW, head_sha="abc", head_branch="dev", created_at="today")
        artifacts = [
            dict(id=10, name="php-analysis-comparison-42-1", expired=True),
            dict(id=12, name="php-analysis-comparison-42-3", expired=False, size_in_bytes=1024),
        ]
        data = io.BytesIO()
        with zipfile.ZipFile(data, mode="w") as archive:
            source_ids = {"repository": "a/b", "commit": "abc", "run_id": 42, "run_attempt": 3}
            archive.writestr("run.json", json.dumps(source_ids))
            archive.writestr("summary.json", json.dumps({**source_ids, "schema_version": 1, "tools": {}}))
            archive.writestr("findings.jsonl", 'raw findings are downloaded separately')
        buf = io.StringIO()
        with patch.object(exporter, "pages", return_value=artifacts), patch.object(exporter, "api", return_value=data.getvalue()):
            with contextlib.redirect_stdout(buf):
                exporter.export_run("repos/a/b", "a/b", run, False)
        rows = [json.loads(line) for line in buf.getvalue().splitlines()]
        self.assertEqual(["expired", "not_published", "available"], [row["availability"] for row in rows])
        self.assertEqual([1, 2, 3], [row["run_attempt"] for row in rows])
        self.assertNotIn("summary", rows[0])
        self.assertNotIn("evaluation", rows[2])
        self.assertNotIn("findings", rows[2])

    def test_mismatched_source_measurements_are_not_exported(self):
        run = dict(id=42, run_attempt=1, path=exporter.WORKFLOW, head_sha="abc", head_branch="dev", created_at="today")
        artifact = dict(id=10, name="php-analysis-comparison-42-1", expired=False)
        wrong = {"availability": "available", "run": {"repository": "a/b", "commit": "wrong", "run_id": 42, "run_attempt": 1}}
        buf = io.StringIO()
        with patch.object(exporter, "pages", return_value=[artifact]), patch.object(exporter, "reports", return_value=wrong):
            with contextlib.redirect_stdout(buf):
                exporter.export_run("repos/a/b", "a/b", run, False)
        row = json.loads(buf.getvalue())
        self.assertEqual("invalid_provenance", row["availability"])
        self.assertNotIn("run", row)

    def test_jev_join_checks_producer_and_source_attempt(self):
        name = "php-analysis-jev-42-1"
        artifacts = [dict(name=name, workflow_run={"id": i}) for i in (1, 2, 3)]
        consumers = [
            {"path": "other.yml", "event": "workflow_run"},
            {"path": exporter.JEV_WORKFLOW, "event": "workflow_run"},
            {"path": exporter.JEV_WORKFLOW, "event": "workflow_run"},
        ]
        def receipt(attempt):
            return {"assessment": {"source": {"repository": "a/b", "run_id": 42, "run_attempt": attempt, "sha": "abc"}}}
        with patch.object(exporter, "pages", return_value=artifacts), patch.object(exporter, "get", side_effect=consumers):
            with patch.object(exporter, "reports", side_effect=[receipt(2), receipt(1)]) as reads:
                result = exporter.jev_report("repos/a/b", {"id": 42, "head_sha": "abc"}, 1)
        self.assertEqual(receipt(1), result)
        self.assertEqual(2, reads.call_count)
