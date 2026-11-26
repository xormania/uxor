"""Check how concurrent readers interpret the package lifecycle's operation journal."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lifecycle_events import operation, progress


class LifecycleEventsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "events.jsonl"
        environment = patch.dict(os.environ, UXOR_LIFECYCLE_EVENTS=str(self.path))
        environment.start()
        self.addCleanup(environment.stop)

    def test_nested_operations_and_failure_keep_their_order_and_safe_names(self):
        with self.assertRaisesRegex(ValueError, "private test detail"):
            with operation("upgrade"):
                with operation("composer.install"):
                    pass
                with operation("mate.discover"):
                    live = progress(self.path, timeline=True)
                    self.assertEqual("mate.discover", live["current_operation"]["name"])
                    self.assertEqual("composer.install", live["last_successful_operation"]["name"])
                    self.assertEqual(["upgrade", "mate.discover"], [row["name"] for row in live["active_operations"]])
                    scope = live["timeline"][0]
                    self.assertEqual(scope["operation_id"], live["current_operation"]["parent_id"])
                    raise ValueError("private test detail")
        rows = progress(self.path, timeline=True)["timeline"]
        self.assertEqual(["upgrade", "composer.install", "mate.discover"], [row["name"] for row in rows])
        self.assertEqual(["failed", "succeeded", "failed"], [row["state"] for row in rows])
        raw = self.path.read_text()
        self.assertNotIn("private test detail", raw)
        events = [json.loads(line) for line in raw.splitlines()]
        self.assertEqual(list(range(1, len(events) + 1)), [event["seq"] for event in events])

    def test_read_during_append_and_after_damage_preserves_the_completed_prefix(self):
        with operation("composer.install"):
            pass
        with operation("mate.discover"):
            pass
        prefix, suffix = self.path.read_bytes().rsplit(b"\n", maxsplit=2)[:2]
        # Split the second completion record, as observed by a racing reader.
        cut = len(suffix) // 2
        self.path.write_bytes(prefix + b"\n" + suffix[:cut])
        incomplete = progress(self.path)
        self.assertFalse(incomplete.get("telemetry_error"))
        self.assertEqual("composer.install", incomplete["last_successful_operation"]["name"])
        self.assertEqual("mate.discover", incomplete["current_operation"]["name"])
        with self.path.open("ab") as stream:
            stream.write(suffix[cut:] + b"\n")
        completed = progress(self.path)
        self.assertEqual("mate.discover", completed["last_successful_operation"]["name"])
        self.assertIsNone(completed["current_operation"])
        with self.path.open("ab") as stream:
            stream.write(b"private corrupt test data\n")
        damaged = progress(self.path, timeline=True)
        self.assertTrue(damaged["telemetry_error"])
        self.assertNotIn("private corrupt test data", damaged["telemetry_error"])
        self.assertEqual(["succeeded", "succeeded"], [row["state"] for row in damaged["timeline"]])
