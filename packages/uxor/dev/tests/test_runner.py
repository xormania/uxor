"""Exercise ownership, isolation and provider-check ordering without Docker."""
import importlib.util
import contextlib
import json
from pathlib import Path
import tempfile
import subprocess
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

    def test_provider_rejects_an_untracked_import_before_loading_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            subprocess.run(["git", "init", "--quiet", str(checkout)], check=True)
            (checkout / "scripts").mkdir()
            (checkout / "scripts/provider.py").write_text("PINNED = True\n")
            subprocess.run(["git", "-C", str(checkout), "add", "scripts/provider.py"], check=True)
            subprocess.run(["git", "-C", str(checkout), "-c", "user.name=xormania", "-c",
                            "user.email=xormania@users.noreply.github.com", "commit", "--quiet", "-m", "provider fixture"], check=True)
            revision = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
            with patch.dict(runner.os.environ, {"XORDER_DIR": str(checkout)}), patch.object(runner, "XORDER_REVISION", revision):
                self.assertEqual(checkout, runner.xorder_source())
                (checkout / "scripts/subprocess.py").write_text("raise RuntimeError('unreviewed import executed')\n")
                with self.assertRaisesRegex(ValueError, "untracked modifications"):
                    runner.xorder_source()

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

    def test_support_precheck_happens_before_pull_and_observation_after(self):
        events = []
        module = Mock()
        module.runner_precheck.side_effect = lambda *args: events.append("policy") or {"prepared": True}
        module.runner_check.side_effect = lambda *args, **kwargs: events.append("observed")
        with patch.object(runner, "require_docker"), patch.object(runner, "xorder_source", return_value=Path("/provider")), \
                patch.object(runner, "support_module", return_value=module), \
                patch.object(runner, "current_support", side_effect=lambda module, env: contextlib.nullcontext(env)), \
                patch.object(runner, "run", side_effect=lambda *args, **kwargs: events.append("pull")):
            runner.prepare_image(runner.environment())
        self.assertEqual(["policy", "pull", "observed"], events)

    def test_failed_support_precheck_never_pulls(self):
        module = Mock()
        module.runner_precheck.side_effect = ValueError("expired")
        with patch.object(runner, "require_docker"), patch.object(runner, "xorder_source", return_value=Path("/provider")), \
                patch.object(runner, "support_module", return_value=module), \
                patch.object(runner, "current_support", side_effect=lambda module, env: contextlib.nullcontext(env)), \
                patch.object(runner, "run") as command:
            with self.assertRaisesRegex(ValueError, "expired"):
                runner.prepare_image(runner.environment())
            command.assert_not_called()

    def test_completed_support_receipt_is_private_and_scoped_to_one_check(self):
        module = Mock(DEFAULT_POLICY_URL="https://canonical.example/policy")
        module.fetch_cli.side_effect = lambda args: args.output.write_text('{"policy": {}, "receipt": {}}')
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, "DEV", Path(temporary)):
            with runner.current_support(module, {"XORDER_SUPPORT_POLICY_URL": module.DEFAULT_POLICY_URL}) as env:
                snapshot = Path(env["XORDER_SUPPORT_POLICY_FILE"])
                self.assertTrue(snapshot.is_file())
                self.assertEqual(0o600, snapshot.stat().st_mode & 0o777)
                self.assertEqual(0o700, snapshot.parent.stat().st_mode & 0o777)
                self.assertNotIn("XORDER_SUPPORT_POLICY_URL", env)
                self.assertEqual(module.DEFAULT_POLICY_URL, module.fetch_cli.call_args.args[0].policy_url)
                module.fetch_cli.assert_called_once()
            self.assertFalse(snapshot.exists())

    def test_explicit_offline_receipt_is_checked_without_refresh_or_removal(self):
        module = Mock()
        env = {"XORDER_SUPPORT_POLICY_FILE": "/owned/policy.json"}
        with runner.current_support(module, env) as selected:
            self.assertEqual(env, selected)
        module.fetch_cli.assert_not_called()

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
