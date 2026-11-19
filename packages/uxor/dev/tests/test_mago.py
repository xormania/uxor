"""Exercise the installed Mago command with a recording Docker executable."""
import csv
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

WRAPPER = Path(__file__).resolve().parents[2] / "bin" / "uxor-mago"
REPOSITORY = WRAPPER.parents[3]
IMAGE = "local/uxor-mago:trial"
SCOPES = ["formatter", "linter", "analyzer"]
CHECKS = [["format", "--check"], ["lint"], ["analyze"]]


class MagoCommandTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        self.project = self.directory / 'project, with "quotes"'
        self.project.mkdir()
        (self.project / "composer.json").write_text("{}\n")
        (self.project / "mago.toml").write_text('version = "1"\n[source]\npaths = ["src"]\n')
        (self.project / "src").mkdir()
        (self.project / "src/Example.php").write_text("<?php\n")
        self.native_calls = self.directory / "mago.jsonl"
        self.log = self.directory / "docker.jsonl"
        docker = self.directory / "docker"
        docker.write_text(f"#!{sys.executable}\n" + """
import json, os, sys
with open(os.environ["DOCKER_CALLS"], "a") as log:
    print(json.dumps({"args": sys.argv[1:], "stdin": sys.stdin.read()}), file=log)
if "NATIVE_CALLS" in os.environ:
    command = sys.argv[sys.argv.index(os.environ["UXOR_MAGO_IMAGE"]) + 1:]
    os.execvp(command[0], command)
sys.exit(int(os.environ.get("DOCKER_STATUS", "0")))
""")
        docker.chmod(0o755)
        mago = self.directory / "mago"
        mago.write_text(f"#!{sys.executable}\n" + """
import json, os, sys
with open(os.environ["NATIVE_CALLS"], "a") as log:
    print(json.dumps(sys.argv[1:]), file=log)
if sys.argv[1] == "list-files":
    if sys.argv[2:3] != ["--command"] or len(sys.argv) != 4:
        sys.exit(2)
    if sys.argv[3] != os.environ.get("EMPTY_SCOPE"):
        print("src/Example.php")
sys.exit(23 if sys.argv[1] == os.environ.get("FAIL_STEP") else 0)
""")
        mago.chmod(0o755)

    def invoke(self, *arguments, cwd=None, stdin="", executable=WRAPPER, **env):
        self.log.unlink(missing_ok=True)
        return subprocess.run(
            [str(executable), *arguments], cwd=cwd or self.project, input=stdin,
            capture_output=True, text=True, timeout=10,
            env={"PATH": os.pathsep.join((str(self.directory), os.defpath)),
                 "DOCKER_CALLS": str(self.log), **env},
        )

    def docker_call(self):
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(1, len(calls), calls)
        return calls[0]

    def assert_container(self, args):
        self.assertEqual("run", args[0])
        # Docker accepts --option=value as well as --option value.
        options = []
        for arg in args:
            options.extend(arg.split("=", 1) if arg.startswith("--") and "=" in arg else [arg])
        pairs = list(zip(options, options[1:]))
        self.assertIn(("--user", f"{os.getuid()}:{os.getgid()}"), pairs)
        expected_groups = {str(group) for group in os.getgroups() if group != os.getgid()}
        self.assertEqual(expected_groups, {value for option, value in pairs if option == "--group-add"})
        self.assertIn(("--pull", "never"), pairs)
        self.assertIn(("--network", "none"), pairs)
        self.assertTrue(any(option in ("-w", "--workdir") and value == "/app" for option, value in pairs), args)
        for option, value in pairs:
            if option in ("-v", "--volume") and value == f"{self.project}:/app:ro":
                return
            if option == "--mount":
                fields = set(next(csv.reader([value])))
                if ("type=bind" in fields and fields.intersection(("ro", "readonly"))
                    and fields.intersection((f"source={self.project}", f"src={self.project}"))
                    and fields.intersection(("dst=/app", "target=/app", "destination=/app"))):
                    return
        self.fail(f"No read-only mount of the requested project at /app in {args}")

    def test_single_checks_use_the_selected_image_and_preserve_native_arguments(self):
        for command in ("format", "lint", "analyze"):
            with self.subTest(command=command):
                native = ["test files/example.php"]
                if command in ("lint", "analyze"):
                    native = ["--reporting-format", "json", *native]
                result = self.invoke("--project-root", self.project.name, command, *native,
                                     cwd=self.directory, UXOR_MAGO_IMAGE=IMAGE)
                self.assertEqual(0, result.returncode, result.stderr)
                args = self.docker_call()["args"]
                self.assert_container(args[:args.index(IMAGE)])
                self.assertIn(command, args[args.index(IMAGE) + 1:])
                self.assertEqual(native, args[-len(native):])
                if command == "format":
                    self.assertIn("--check", args[args.index(IMAGE) + 1:])

    def aggregate(self, **env):
        self.native_calls.unlink(missing_ok=True)
        result = self.invoke("check", UXOR_MAGO_IMAGE=IMAGE, NATIVE_CALLS=str(self.native_calls), **env)
        calls = [json.loads(line) for line in self.native_calls.read_text().splitlines()]
        scopes = [args[2] for args in calls if args[0] == "list-files"]
        checks = [args for args in calls if args[0] != "list-files"]
        return result, scopes, checks

    def test_check_validates_each_scope_then_runs_the_checks_in_order(self):
        result, scopes, checks = self.aggregate()
        self.assertEqual(0, result.returncode, result.stderr)
        args = self.docker_call()["args"]
        self.assert_container(args[:args.index(IMAGE)])
        self.assertCountEqual(SCOPES, scopes)
        self.assertEqual(CHECKS, checks)

    def test_check_stops_when_a_source_scope_is_empty(self):
        for scope in SCOPES:
            with self.subTest(scope=scope):
                result, scopes, checks = self.aggregate(EMPTY_SCOPE=scope)
                self.assertNotEqual(0, result.returncode)
                self.assertIn(scope, scopes)
                self.assertEqual([], checks)

    def test_check_propagates_the_first_failed_checks_status(self):
        for index, command in enumerate(CHECKS):
            with self.subTest(command=command):
                result, scopes, checks = self.aggregate(FAIL_STEP=command[0])
                self.assertEqual(23, result.returncode, result.stderr)
                self.assertCountEqual(SCOPES, scopes)
                self.assertEqual(CHECKS[:index + 1], checks)

    def test_serena_keeps_standard_input_and_propagates_the_container_status(self):
        message = '{"jsonrpc":"2.0","method":"initialize","id":1}\n'
        result = self.invoke("serena", stdin=message, DOCKER_STATUS="37")
        self.assertEqual(37, result.returncode, result.stderr)
        call = self.docker_call()
        self.assertEqual(message, call["stdin"])
        self.assertTrue(any(arg in ("-i", "--interactive") for arg in call["args"]), call)
        self.assert_container(call["args"])
        command = " ".join(call["args"])
        self.assertIn("serena start-mcp-server", command)
        self.assertIn("--project /app", command)
        self.assertIn("--transport stdio", command)

    def test_each_command_requires_the_project_configuration_before_docker(self):
        (self.project / "mago.toml").unlink()
        for command in ("check", "format", "lint", "analyze", "serena"):
            with self.subTest(command=command):
                result = self.invoke(command)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("mago.toml", result.stderr)
                self.assertFalse(self.log.exists())

    def test_bad_requests_stop_before_docker(self):
        for arguments, cwd in [
            ([], self.project),
            (["unknown"], self.project),
            (["check", "file.php"], self.project),
            (["serena", "file.php"], self.project),
            (["--project-root"], self.project),
            (["--project-root", "missing", "check"], self.directory),
            (["check"], self.directory),
        ]:
            with self.subTest(arguments=arguments, cwd=cwd):
                result = self.invoke(*arguments, cwd=cwd)
                self.assertNotEqual(0, result.returncode)
                self.assertTrue((result.stdout + result.stderr).strip())
                self.assertFalse(self.log.exists())

    def test_help_works_outside_a_project_without_docker(self):
        result = self.invoke("--help", cwd=self.directory)
        self.assertEqual(0, result.returncode, result.stderr)
        help_text = result.stdout + result.stderr
        for command in ("check", "format", "lint", "analyze", "serena"):
            self.assertRegex(help_text, rf"\b{command}\b")
        self.assertFalse(self.log.exists())

    def check_repository_client(self, server):
        subprocess.run(["git", "init", "--quiet", str(self.project)], check=True)
        for relative in ("tools/mago", WRAPPER.relative_to(REPOSITORY)):
            target = self.project / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPOSITORY / relative, target)
        result = self.invoke(*server["args"], executable=server["command"], cwd=self.project / "src",
                             UXOR_MAGO_IMAGE=IMAGE, stdin="MCP input")
        self.assertEqual(0, result.returncode, result.stderr)
        call = self.docker_call()
        self.assert_container(call["args"][:call["args"].index(IMAGE)])
        self.assertIn("serena start-mcp-server", " ".join(call["args"]))
        self.assertEqual("MCP input", call["stdin"])

    def test_claude_server_mounts_the_relocated_checkout_from_a_subdirectory(self):
        servers = json.loads((REPOSITORY / ".mcp.json").read_text())["mcpServers"]
        self.check_repository_client(servers["uxor-mago"])

    @unittest.skipIf(sys.version_info < (3, 11), "Reading the Codex TOML needs Python 3.11")
    def test_codex_server_mounts_the_relocated_checkout_from_a_subdirectory(self):
        import tomllib
        servers = tomllib.loads((REPOSITORY / ".codex/config.toml").read_text())["mcp_servers"]
        self.check_repository_client(servers["uxor-mago"])

    def test_repository_pull_uses_a_pinned_default_and_accepts_a_local_override(self):
        launcher = REPOSITORY / "tools/mago"
        result = self.invoke("pull", executable=launcher)
        self.assertEqual(0, result.returncode, result.stderr)
        verb, image = self.docker_call()["args"]
        self.assertEqual("pull", verb)
        self.assertRegex(image, r"@sha256:[0-9a-f]{64}$")
        result = self.invoke("pull", executable=launcher, UXOR_MAGO_IMAGE=IMAGE)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(["pull", IMAGE], self.docker_call()["args"])


if __name__ == "__main__":
    unittest.main()
