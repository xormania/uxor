"""The development editor uses the prepared local image and explicit write access."""
from contextlib import redirect_stderr
import importlib.util
import io
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

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

    def test_prepare_cli_builds_and_inspects_the_same_tag_without_starting_mcp(self):
        tag = editor.image_tag()
        output = io.StringIO()
        with patch.object(editor.sys, "argv", ["serena.py", "--prepare"]), redirect_stderr(output), \
                patch.object(editor.subprocess, "run", side_effect=[None, Mock(returncode=0, stdout="sha256:built\n")]) as docker, \
                patch.object(editor.os, "execvp") as start:
            editor.main()
        self.assertEqual([
            ["docker", "build", "--tag", tag, str(editor.CONTEXT)],
            ["docker", "image", "inspect", "--format", "{{.Id}}", tag],
        ], [call.args[0] for call in docker.call_args_list])
        self.assertTrue(docker.call_args_list[0].kwargs["check"])
        self.assertEqual("sha256:built", output.getvalue().strip())
        start.assert_not_called()

    def test_launch_reuses_the_index_only_for_the_same_checkout_user_and_image(self):
        def launch(root="one", uid=1000, gid=1000, image="sha256:first"):
            with patch.object(editor.sys, "argv", ["serena.py"]), patch.object(editor, "ROOT", Path(root)), \
                    patch.object(editor.os, "getuid", return_value=uid), patch.object(editor.os, "getgid", return_value=gid), \
                    patch.object(editor, "image_id", return_value=image), patch.object(editor.os, "execvp") as start:
                editor.main()
            command = start.call_args.args[1]
            self.assertEqual(image, command[-1])
            return next(arg for arg in command if "target=/cache" in arg)

        original = launch()
        self.assertEqual(original, launch())
        for change in ({"root": "two"}, {"uid": 1001}, {"gid": 1001}, {"image": "sha256:second"}):
            with self.subTest(change=change):
                self.assertNotEqual(original, launch(**change))

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
