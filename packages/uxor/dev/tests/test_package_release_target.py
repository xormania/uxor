"""The lifecycle migration follows the repository's release train and its inclusive historical window."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("check_package", Path(__file__).resolve().parents[2] / "tools/check-package.py")
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class ReleaseTargetTest(unittest.TestCase):
    def target(self, heading, published, requested=None):
        changelog = f"## [Unreleased]\n\n- A subsequent change\n\n## [{heading}] - 2026-11-21\n"
        with patch.object(package, "published_commit", return_value=published):
            return package.release_target(changelog, "checkout", requested)

    def test_the_unshipped_number_is_used_even_with_unreleased_entries(self):
        self.assertEqual(("0.3.5", True), self.target("0.3.5", None))
        self.assertEqual(("0.3.5", True), self.target("0.3.5", "checkout"))
        self.assertEqual(("dev-candidate", True), self.target("0.3.5", "older-tag"))

    def test_a_shallow_checkout_recognizes_peeled_tags_and_distinguishes_lookup_failure(self):
        missing = subprocess.CompletedProcess([], 1, "")
        tag = "refs/tags/0.3.5"
        for output, expected in (("", None), (f"commit\t{tag}\n", "commit"),
                                 (f"tag-object\t{tag}\ncommit\t{tag}^{{}}\n", "commit")):
            found = subprocess.CompletedProcess([], 0, output)
            with self.subTest(output=output), patch.object(package.subprocess, "run", side_effect=[missing, found]):
                self.assertEqual(expected, package.published_commit("0.3.5"))
        with patch.object(package.subprocess, "run", side_effect=[missing, missing]), self.assertRaisesRegex(RuntimeError, "Cannot check"):
            package.published_commit("0.3.5")

    def test_release_numbers_can_skip_and_the_horizon_includes_the_named_release(self):
        self.assertEqual(("0.9.9", True), self.target("0.3.5", "older-tag", "0.9.9"))
        self.assertEqual(("0.9.9", True), self.target("0.9.9", None))
        self.assertEqual(("0.9.9", True), self.target("0.9.9", "checkout"))
        self.assertEqual(("dev-candidate", False), self.target("0.9.9", "older-tag"))
        self.assertEqual(("0.10.0", False), self.target("0.10.0", None))

    def test_replay_preserves_the_original_identity_after_a_release_is_tagged(self):
        for frozen, applies in (("0.3.5", True), ("dev-candidate", True), ("0.9.9", True), ("0.10.0", False)):
            with patch.object(package, "published_commit", side_effect=AssertionError("replay looked up the tag")):
                self.assertEqual((frozen, applies), package.release_target("## [0.3.5] - 2026-11-21", "checkout", frozen))

    def test_rejects_invalid_or_contradictory_versions(self):
        for value in ("0.3.5-rc.1", "v0.3.5", "00.3.5", "0.3.4"):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "--target-version"):
                self.target("0.3.5", "older-tag", value)
        with self.assertRaisesRegex(RuntimeError, "must follow its baseline"):
            self.target("0.3.2", "older-tag", "0.3.2")
        with self.assertRaisesRegex(RuntimeError, "no dated"):
            package.release_target("## [Unreleased]", "checkout", None)
