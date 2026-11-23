"""Exercise the installed Mago command with a recording Docker executable."""
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

WRAPPER = Path(__file__).resolve().parents[2] / "bin" / "uxor-mago"
REPOSITORY = WRAPPER.parents[3]
IMAGE = "local/uxor-mago:trial"
DIGEST = "sha256:" + "a" * 64
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
inspect = sys.argv[1:3] == ["image", "inspect"]
with open(os.environ["DOCKER_CALLS"], "a") as log:
    print(json.dumps({"args": sys.argv[1:], "stdin": "" if inspect else sys.stdin.read()}), file=log)
if inspect:
    print(os.environ.get("DOCKER_IMAGE_ID", "sha256:" + "a" * 64))
    sys.exit(int(os.environ.get("DOCKER_INSPECT_STATUS", "0")))
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
        if len(calls) == 2:
            self.assertEqual(["image", "inspect"], calls[0]["args"][:2])
            self.assertEqual("run", calls[1]["args"][0])
        else:
            self.assertEqual(1, len(calls), calls)
        return calls[-1]

    def assert_container(self, args, *, writable=False):
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
        self.assertIn("--read-only", options)
        self.assertIn(("--cap-drop", "ALL"), pairs)
        self.assertIn(("--security-opt", "no-new-privileges"), pairs)
        self.assertTrue(any(option in ("-w", "--workdir") and value == "/app" for option, value in pairs), args)
        for option, value in pairs:
            if option == "--mount":
                fields = set(next(csv.reader([value])))
                if ("type=bind" in fields
                    and fields.intersection((f"source={self.project}", f"src={self.project}"))
                    and fields.intersection(("dst=/app", "target=/app", "destination=/app"))):
                    self.assertEqual(not writable, bool(fields.intersection(("ro", "readonly"))))
                    return
        self.fail(f"No correctly scoped application mount at /app in {args}")


    def test_project_commands_require_execution_trust_before_any_docker_invocation(self):
        commands = ("check", "format", "lint", "analyze", "guard", "cst", "fix", "twig:fmt", "twig:lint", "serena")
        for command in commands:
            with self.subTest(command=command):
                result = self.invoke(command)
                self.assertEqual(2, result.returncode, result.stderr)
                self.assertIn("--trust-project-code", result.stderr)
                self.assertFalse(self.log.exists())

    def test_write_and_indirect_configuration_do_not_grant_execution_trust(self):
        inherited = self.project / "inherited.toml"
        inherited.write_text('[extension-hosts.project]\ncommand = ["php", "worker.php"]\n')
        for configuration in (
            'version = "1.60.2"\n[extension-hosts.project]\ncommand = ["php", "worker.php"]\n',
            'version = "1.60.2"\nextends = "inherited.toml"\n',
        ):
            (self.project / "mago.toml").write_text(configuration)
            for arguments in (
                ("analyze",), ("analyze", "--config", "inherited.toml"),
                ("--write", "analyze"), ("--write", "serena"),
                ("serena", "--trust-project-code"), ("analyze", "--trust-project-code"),
                ("--trust-project", "serena"), ("--trust-project-code=true", "analyze"),
            ):
                with self.subTest(configuration=configuration, arguments=arguments):
                    result = self.invoke(*arguments)
                    self.assertEqual(2, result.returncode, result.stderr)
                    self.assertFalse(self.log.exists())

    def test_explicit_trust_does_not_grant_source_write_access(self):
        for arguments in (("analyze", "src/Example.php"), ("serena",)):
            with self.subTest(arguments=arguments):
                result = self.invoke("--trust-project-code", *arguments, UXOR_MAGO_IMAGE=IMAGE)
                self.assertEqual(0, result.returncode, result.stderr)
                call = self.docker_call()["args"]
                selected = DIGEST if arguments[0] == "serena" else IMAGE
                self.assert_container(call[:call.index(selected)])
                if arguments[0] == "serena":
                    self.assertEqual(["python", "/opt/provider/start.py", "--trust-project-code"],
                                     call[call.index(selected) + 1:])

    def test_default_cli_uses_the_release_image_and_reports_the_installed_version(self):
        selected = self.invoke("image", cwd=self.directory)
        self.assertEqual(0, selected.returncode, selected.stderr)
        image = selected.stdout.strip()
        self.assertFalse(self.log.exists())
        result = self.invoke("pull", "cli", cwd=self.directory)
        self.assertEqual(0, result.returncode, result.stderr)
        build = self.docker_call()
        self.assertEqual(["build", "--tag", image, "-"], build["args"])
        self.assertRegex(build["stdin"], r"MAGO_RELEASE=ghcr.io/carthage-software/mago:1\.60\.2@sha256:[0-9a-f]{64}\n")
        stages = re.findall(r"(?im)^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", build["stdin"])
        self.assertTrue(stages, "The CLI Dockerfile has no FROM instruction")
        self.assertRegex(
            stages[-1], r"^(?:docker\.io/)?(?:library/)?php:8\.4\.[0-9]+-cli(?:-[a-z0-9.-]+)?@sha256:[0-9a-f]{64}$"
        )
        result = self.invoke("version", cwd=self.directory)
        self.assertEqual(0, result.returncode, result.stderr)
        arguments = self.docker_call()["args"]
        self.assertIn("--network", arguments)
        self.assertIn("none", arguments)
        self.assertEqual(["--entrypoint", "mago", image, "--version"], arguments[-4:])

    def test_serena_build_uses_the_recipe_shipped_with_the_launcher(self):
        result = self.invoke("pull", "serena", cwd=self.directory)
        self.assertEqual(0, result.returncode, result.stderr)
        args = self.docker_call()["args"]
        self.assertEqual(["buildx", "build", "--load", "--tag"], args[:4])
        context = Path(args[-1]).resolve()
        self.assertEqual(WRAPPER.parents[1] / "resources" / "mago" / "serena", context)
        self.assertTrue((context / "Dockerfile").is_file())
        self.assertTrue((context / "uv.lock").is_file())
        image = self.invoke("image", "serena").stdout.strip()
        self.assertEqual(image, args[4])
        self.assertNotEqual(self.invoke("image").stdout.strip(), image)
        result = self.invoke("version", "serena")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(["mago", image, "--version"], self.docker_call()["args"][-3:])

    def test_single_checks_use_the_selected_image_and_preserve_native_arguments(self):
        for command in ("format", "lint", "analyze", "guard", "cst", "twig:fmt", "twig:lint"):
            with self.subTest(command=command):
                native = ["test files/example.php"]
                if command in ("lint", "analyze"):
                    native = ["--reporting-format", "json", *native]
                result = self.invoke("--trust-project-code", "--project-root", self.project.name, command, *native,
                                     cwd=self.directory, UXOR_MAGO_IMAGE=IMAGE)
                self.assertEqual(0, result.returncode, result.stderr)
                args = self.docker_call()["args"]
                self.assert_container(args[:args.index(IMAGE)])
                self.assertIn(command, args[args.index(IMAGE) + 1:])
                self.assertEqual(native, args[-len(native):])
                if command in ("format", "twig:fmt"):
                    self.assertIn("--check", args[args.index(IMAGE) + 1:])

    def aggregate(self, **env):
        self.native_calls.unlink(missing_ok=True)
        result = self.invoke("--trust-project-code", "check", UXOR_MAGO_IMAGE=IMAGE, NATIVE_CALLS=str(self.native_calls), **env)
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
        result = self.invoke("--trust-project-code", "serena", stdin=message, DOCKER_STATUS="37")
        self.assertEqual(37, result.returncode, result.stderr)
        call = self.docker_call()
        self.assertEqual(message, call["stdin"])
        self.assertTrue(any(arg in ("-i", "--interactive") for arg in call["args"]), call)
        self.assert_container(call["args"])
        self.assertIn(DIGEST, call["args"])
        self.assertEqual(["python", "/opt/provider/start.py", "--trust-project-code"], call["args"][call["args"].index(DIGEST) + 1:])

    def test_each_command_requires_the_project_configuration_before_docker(self):
        (self.project / "mago.toml").unlink()
        for command in ("check", "format", "lint", "analyze", "serena"):
            with self.subTest(command=command):
                result = self.invoke("--trust-project-code", command)
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
                result = self.invoke("--trust-project-code", *arguments, cwd=cwd)
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

    def test_mutating_native_modes_require_write_before_starting_docker(self):
        for arguments in [
            ("fix",), ("lint", "--fix"), ("analyze", "--fix"),
            ("guard", "--generate-baseline"), ("lint", "--remove-outdated-baseline-entries"),
            ("analyze", "--backup-baseline"), ("format", "--staged"), ("twig:lint", "--fix"),
        ]:
            with self.subTest(arguments=arguments):
                result = self.invoke("--trust-project-code", *arguments)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("--write", result.stderr)
                self.assertFalse(self.log.exists())

    def test_write_mode_is_explicit_and_preserves_native_arguments(self):
        for arguments in [
            ("format", "src/Example.php"), ("lint", "--fix", "src/Example.php"),
            ("analyze", "--fix", "src/Example.php"), ("guard", "--generate-baseline"),
            ("fix", "src/Example.php"), ("twig:fmt", "templates/example.html.twig"),
            ("twig:lint", "--fix", "templates/example.html.twig"),
        ]:
            with self.subTest(arguments=arguments):
                result = self.invoke("--trust-project-code", "--write", "--project-root", str(self.project), *arguments, UXOR_MAGO_IMAGE=IMAGE)
                self.assertEqual(0, result.returncode, result.stderr)
                call = self.docker_call()["args"]
                self.assert_container(call[:call.index(IMAGE)], writable=True)
                self.assertEqual(["mago", *arguments], call[call.index(IMAGE) + 1:])

    def test_read_only_previews_are_forwarded_without_conflicting_check_flag(self):
        for arguments in [
            ("format", "--diff", "src/Example.php"),
            ("twig:fmt", "--dry-run", "templates/example.html.twig"),
            ("lint", "--fix", "--dry-run", "src/Example.php"),
        ]:
            with self.subTest(arguments=arguments):
                result = self.invoke("--trust-project-code", *arguments, UXOR_MAGO_IMAGE=IMAGE)
                self.assertEqual(0, result.returncode, result.stderr)
                call = self.docker_call()["args"]
                self.assert_container(call[:call.index(IMAGE)])
                self.assertEqual(["mago", *arguments], call[call.index(IMAGE) + 1:])

    def test_write_is_not_accepted_for_provider_management_or_read_only_aggregate(self):
        for command in ("pull", "image", "version", "check", "cst"):
            with self.subTest(command=command):
                result = self.invoke("--trust-project-code", "--write", command)
                self.assertNotEqual(0, result.returncode)
                self.assertFalse(self.log.exists())

    def state_volume(self, call):
        mounts = [next(csv.reader([value])) for option, value in zip(call, call[1:]) if option == "--mount"]
        state = [fields for fields in mounts if "type=volume" in fields and "target=/state" in fields]
        self.assertEqual(1, len(state), mounts)
        name = next(field.split("=", 1)[1] for field in state[0] if field.startswith("source="))
        self.assertRegex(name, r"^uxor-mago-serena-[0-9a-f]{64}$")
        return name

    def test_serena_reuses_existing_volume_with_only_shasum_on_path(self):
        for command in ("id", "sed"):
            (self.directory / command).symlink_to(shutil.which(command))
        shasum = self.directory / "shasum"
        shasum.write_text(f"#!{sys.executable}\n" + """
import argparse, hashlib, sys
parser = argparse.ArgumentParser()
parser.add_argument("-a", "--algorithm", default="1")
algorithm = parser.parse_args().algorithm
print(hashlib.new("sha" + algorithm, sys.stdin.buffer.read()).hexdigest(), " -")
""")
        shasum.chmod(0o755)

        result = self.invoke("--trust-project-code", "serena", PATH=str(self.directory))
        self.assertEqual(0, result.returncode, result.stderr)
        identity = b"\0".join((os.fsencode(self.project), f"{os.getuid()}:{os.getgid()}".encode(),
                               DIGEST.encode(), b""))
        expected = "uxor-mago-serena-" + hashlib.sha256(identity).hexdigest()
        self.assertEqual(expected, self.state_volume(self.docker_call()["args"]))

    def test_serena_reuses_state_for_canonical_root_and_separates_images_and_projects(self):
        self.invoke("--trust-project-code", "serena", UXOR_MAGO_IMAGE=IMAGE)
        first = self.docker_call()["args"]
        self.assertIn(DIGEST, first)
        original = self.state_volume(first)
        alias = self.directory / "same-project"
        alias.symlink_to(self.project, target_is_directory=True)
        self.invoke("--trust-project-code", "--project-root", str(alias), "serena", UXOR_MAGO_IMAGE=IMAGE)
        self.assertEqual(original, self.state_volume(self.docker_call()["args"]))
        self.invoke("--trust-project-code", "--project-root", str(self.project), "--write", "serena", UXOR_MAGO_IMAGE=IMAGE)
        writable = self.docker_call()["args"]
        self.assertEqual(original, self.state_volume(writable))
        self.assert_container(writable[:writable.index(DIGEST)], writable=True)
        self.assertEqual(["python", "/opt/provider/start.py", "--trust-project-code", "--write"], writable[writable.index(DIGEST) + 1:])

        changed_image = "sha256:" + "b" * 64
        self.invoke("--trust-project-code", "serena", UXOR_MAGO_IMAGE=IMAGE, DOCKER_IMAGE_ID=changed_image)
        changed = self.docker_call()["args"]
        self.assertIn(changed_image, changed)
        self.assertNotEqual(original, self.state_volume(changed))
        other = self.directory / "other-project"
        other.mkdir()
        (other / "composer.json").write_text("{}\n")
        (other / "mago.toml").write_text((self.project / "mago.toml").read_text())
        self.invoke("--trust-project-code", "--project-root", str(other), "serena", UXOR_MAGO_IMAGE=IMAGE)
        self.assertNotEqual(original, self.state_volume(self.docker_call()["args"]))

    def test_serena_requires_a_real_prepared_image_identity_before_mounting_the_project(self):
        for environment in [
            {"DOCKER_INSPECT_STATUS": "1"}, {"DOCKER_IMAGE_ID": ""},
            {"DOCKER_IMAGE_ID": "local/tag:latest"}, {"DOCKER_IMAGE_ID": "sha256:" + "z" * 64},
            {"DOCKER_IMAGE_ID": "sha256:" + "a" * 63},
        ]:
            with self.subTest(environment=environment):
                result = self.invoke("--trust-project-code", "serena", **environment)
                self.assertNotEqual(0, result.returncode)
                calls = [json.loads(line) for line in self.log.read_text().splitlines()]
                self.assertEqual(1, len(calls))
                self.assertEqual(["image", "inspect"], calls[0]["args"][:2])


    def check_repository_client(self, server):
        subprocess.run(["git", "init", "--quiet", str(self.project)], check=True)
        for relative in ("tools/mago", WRAPPER.relative_to(REPOSITORY)):
            target = self.project / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPOSITORY / relative, target)
        self.assertNotIn("--trust-project-code", " ".join(server["args"]))
        result = self.invoke(*server["args"], executable=server["command"], cwd=self.project / "src",
                             UXOR_MAGO_IMAGE=IMAGE, stdin="MCP input")
        self.assertEqual(2, result.returncode, result.stderr)
        self.assertIn("--trust-project-code", result.stderr)
        self.assertFalse(self.log.exists())

        # A user's explicitly authorized local binding still resolves this checkout.
        # Change only this in-memory invocation; the committed binding stays untrusted.
        authorized_args = list(server["args"])
        self.assertEqual("sh", server["command"])
        self.assertEqual("-c", authorized_args[0])
        self.assertTrue(authorized_args[1].endswith(" serena"), authorized_args)
        authorized_args[1] = authorized_args[1][:-len(" serena")] + " --trust-project-code serena"
        result = self.invoke(*authorized_args, executable=server["command"], cwd=self.project / "src",
                             UXOR_MAGO_IMAGE=IMAGE, stdin="MCP input")
        self.assertEqual(0, result.returncode, result.stderr)
        call = self.docker_call()
        self.assert_container(call["args"][:call["args"].index(DIGEST)])
        self.assertEqual(["python", "/opt/provider/start.py", "--trust-project-code"], call["args"][call["args"].index(DIGEST) + 1:])
        self.assertEqual("MCP input", call["stdin"])

    def test_claude_server_requires_local_trust_and_mounts_the_relocated_checkout(self):
        servers = json.loads((REPOSITORY / ".mcp.json").read_text())["mcpServers"]
        self.check_repository_client(servers["uxor-mago"])

    @unittest.skipIf(sys.version_info < (3, 11), "Reading the Codex TOML needs Python 3.11")
    def test_codex_server_requires_local_trust_and_mounts_the_relocated_checkout(self):
        import tomllib
        servers = tomllib.loads((REPOSITORY / ".codex/config.toml").read_text())["mcp_servers"]
        self.check_repository_client(servers["uxor-mago"])

    def test_repository_pull_uses_a_pinned_default_and_accepts_a_local_override(self):
        launcher = REPOSITORY / "tools/mago"
        for command in (["image"], ["pull", "cli"], ["pull", "serena"]):
            with self.subTest(command=command):
                result = self.invoke(*command, executable=launcher)
                self.assertEqual(0, result.returncode, result.stderr)
                arguments = self.docker_call()["args"] if self.log.exists() else None
                package = self.invoke(*command)
                self.assertEqual(0, package.returncode, package.stderr)
                self.assertEqual(package.stdout, result.stdout)
                self.assertEqual(self.docker_call()["args"] if self.log.exists() else None, arguments)
        result = self.invoke("pull", executable=launcher, UXOR_MAGO_IMAGE=IMAGE)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(["pull", IMAGE], self.docker_call()["args"])


if __name__ == "__main__":
    unittest.main()
