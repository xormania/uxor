"""The development editor uses the prepared local image and explicit write access."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

DEV = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("uxor_editor", DEV / "serena.py")
editor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(editor)


class SerenaLaunchTest(unittest.TestCase):
    def test_runtime_is_offline_and_source_is_read_only_until_requested(self):
        for write in (False, True):
            args = editor.command("sha256:prepared", "uxor-serena-test", write)
            self.assertIn("--network=none", args)
            self.assertIn("--pull=never", args)
            self.assertIn("--read-only", args)
            self.assertIn("--cap-drop=ALL", args)
            mount = next(arg for arg in args if "target=/workspace" in arg)
            self.assertEqual(not write, "readonly" in mount)
            self.assertEqual(write, "--write" in args)

    def test_cache_mount_has_no_host_path(self):
        args = editor.command("sha256:prepared", "uxor-serena-test", False)
        cache = next(arg for arg in args if "target=/cache" in arg)
        self.assertEqual("type=volume,source=uxor-serena-test,target=/cache", cache)

    def test_image_tag_tracks_its_build_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = Path(temporary) / "build"
            shutil.copytree(editor.CONTEXT, context)
            with patch.object(editor, "CONTEXT", context):
                original = editor.image_tag()
                self.assertRegex(original, r"^uxor-dev-serena:[a-f0-9]{16,}$")
                for path in (item for item in context.iterdir() if item.is_file()):
                    with self.subTest(path=path.name):
                        previous = path.read_bytes()
                        path.write_bytes(previous + b"\n")
                        self.assertNotEqual(original, editor.image_tag())
                        path.write_bytes(previous)
