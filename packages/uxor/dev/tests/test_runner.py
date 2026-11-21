"""Exercise checkout ownership, isolated stacks and image selection without Docker."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("uxor_development", Path(__file__).parents[1] / "run.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class DevelopmentRunnerTest(unittest.TestCase):
    def test_repository_package_and_application_roots_agree(self):
        """The repository root is the package; Composer, Compose and Caddy reach it and the nested consumer."""
        self.assertEqual("xormania/uxor", json.loads((runner.ROOT / "composer.json").read_text())["name"])
        application = runner.APP.relative_to(runner.ROOT).as_posix()
        self.assertEqual("packages/uxor/dev/app", application)
        manifest = json.loads((runner.APP / "composer.json").read_text())
        self.assertIn("xormania/uxor", manifest["require-dev"])
        paths = [repository["url"] for repository in manifest["repositories"] if repository["type"] == "path"]
        self.assertEqual([runner.ROOT], [(runner.APP / url).resolve() for url in paths])
        compose = (runner.DEV / "compose.yaml").read_text()
        self.assertIn("      - ../../..:/workspace\n", compose)
        self.assertEqual(runner.ROOT, (runner.DEV / "../../..").resolve())
        self.assertIn("working_dir: /workspace/" + application + "\n", compose)
        self.assertIn("root * /workspace/" + application + "/public\n", (runner.DEV / "Caddyfile").read_text())

    def test_docker_commands_run_in_the_nested_application(self):
        with patch.object(runner, "compose") as compose:
            runner.execute(["php", "bin/console", "about"], {}, False)
        self.assertEqual(["exec", "--no-TTY", "--workdir", "/workspace/packages/uxor/dev/app", "php", "php", "bin/console", "about"],
                         compose.call_args.args[0])

    def test_consumer_builds_its_local_recipe_and_runs_as_the_checkout_owner(self):
        compose = (runner.DEV / "compose.yaml").read_text()
        self.assertIn("context: ./images/php", compose)
        self.assertIn('user: "${UXOR_DEV_UID:-1000}:${UXOR_DEV_GID:-1000}"', compose)
        self.assertIn("pull_policy: never", compose)
        recipe = (runner.DEV / "images/php/Dockerfile").read_text()
        self.assertRegex(recipe, r"(?m)^FROM composer:[0-9.]+@sha256:[0-9a-f]{64} AS composer$")
        self.assertRegex(recipe, r"(?m)^FROM dunglas/frankenphp:[0-9.]+-php8\.5\.[0-9]+-trixie@sha256:[0-9a-f]{64}$")
        with patch.object(runner, "require_docker"), patch.object(runner, "compose") as build:
            env = runner.environment()
            runner.prepare_image(env)
            build.assert_called_once_with(["build", "php"], env)

    def test_recipe_changes_select_a_new_local_image(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, "DEV", Path(temporary)), \
                patch.dict(runner.os.environ, clear=True):
            directory = Path(temporary) / "images/php"
            directory.mkdir(parents=True)
            recipe = directory / "Dockerfile"
            recipe.write_text("first")
            first = runner.environment()["UXOR_DEV_PHP_IMAGE"]
            recipe.write_text("second")
            self.assertNotEqual(first, runner.environment()["UXOR_DEV_PHP_IMAGE"])
            self.assertNotIn("UXOR_DEV_PHP_IMAGE", runner.environment(True))

    def test_worktrees_have_separate_stack_names_and_default_ports(self):
        first = runner.workspace_identity(Path("/work/one"))
        second = runner.workspace_identity(Path("/work/two"))
        self.assertNotEqual(first, second)
        self.assertEqual(first, runner.workspace_identity(Path("/work/one")))
        self.assertTrue(20000 <= first[1] < 30000)

    def test_native_php_and_composer_overrides_keep_arguments_literal(self):
        with patch.dict(runner.os.environ, {"PHP_BIN": "/tools/php", "COMPOSER_BIN": "/tools/composer.phar"}):
            self.assertEqual(["/tools/php", "/tools/composer.phar", "install"], runner.native_command(["composer", "install"]))
            self.assertEqual(["/tools/php", "bin/console", "name;echo secret"], runner.native_command(["bin/console", "name;echo secret"]))

    def test_an_explicit_port_is_bounded(self):
        with patch.dict(runner.os.environ, {"UXOR_DEV_HTTP_PORT": "1"}):
            with self.assertRaisesRegex(ValueError, "between"):
                runner.environment(True)

    def test_secret_is_private_and_repeated_prepare_preserves_it(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, "APP", Path(temporary)):
            runner.ensure_secret()
            secret = (Path(temporary) / ".env.local").read_bytes()
            runner.ensure_secret()
            self.assertEqual(secret, (Path(temporary) / ".env.local").read_bytes())
            self.assertEqual(0o600, (Path(temporary) / ".env.local").stat().st_mode & 0o777)

    def test_check_and_exec_only_run_commands_against_the_selected_image(self):
        for args in (["check"], ["exec", "php", "--version"]):
            for active in ("sha256:old", "sha256:selected"):
                with self.subTest(args=args, active=active), patch.object(runner, "require_docker"), \
                        patch.object(runner, "compose", return_value=Mock(stdout="container-id\n")), \
                        patch.object(runner, "run", side_effect=[Mock(stdout="sha256:selected\n"), Mock(stdout=active)]), \
                        patch.object(runner, "execute") as execute:
                    if active == "sha256:selected":
                        self.assertEqual(0, runner.main(args))
                        execute.assert_called()
                    else:
                        with self.assertRaisesRegex(ValueError, "run .* up"):
                            runner.main(args)
                        execute.assert_not_called()

    def test_serena_forwards_the_selected_flags_to_the_checkout_launcher(self):
        for flags in ([], ["--prepare"], ["--write"]):
            with self.subTest(flags=flags), patch.object(runner.os, "execvpe") as launch:
                self.assertEqual(0, runner.main(["serena", *flags]))
                binary, command, _ = launch.call_args.args
                self.assertEqual(runner.sys.executable, binary)
                self.assertEqual([binary, str(runner.DEV / "serena.py"), *flags], command)

    def test_native_prepare_never_uses_docker_and_preserves_local_ownership(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, "APP", Path(temporary)), \
                patch.object(runner, "prepare_image") as image, patch.object(runner, "execute") as execute:
            runner.prepare(runner.environment(True), True, assets=False)
            image.assert_not_called()
            self.assertTrue((Path(temporary) / ".env.local").is_file())
            self.assertTrue(all(call.args[2] is True for call in execute.call_args_list))
            self.assertFalse(any("importmap:install" in call.args[0] for call in execute.call_args_list))

    def test_wrong_application_response_fails_readiness(self):
        response = Mock()
        response.status = 200
        response.read.return_value = b"an unrelated server"
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(runner.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(ValueError, "not valid"):
                runner.readiness({"UXOR_DEV_HTTP_PORT": "21080"})


if __name__ == "__main__":
    unittest.main()
