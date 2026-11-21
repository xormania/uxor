"""Check provider state ownership and freshness decisions independently of a live LSP."""
from __future__ import annotations

from contextlib import redirect_stderr
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


HELPER = Path(__file__).resolve().parents[2] / "resources/mago/serena/start.py"


def load_helper():
    spec = importlib.util.spec_from_file_location("uxor_serena_provider_acceptance", HELPER)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


class SerenaProviderStateTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = self.root / "app"
        self.project.mkdir()
        self.state = self.root / "state"
        self.state.mkdir()
        self.helper = load_helper()
        previous_mask = os.umask(0o077)
        os.umask(previous_mask)
        self.addCleanup(os.umask, previous_mask)

    def worker(self):
        directory = self.project / ".uxor/mago"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "worker.php").write_text("<?php // protocol fixture\n")
        return directory

    def response(self, data, status=0):
        return subprocess.CompletedProcess(["php"], status, json.dumps(data), "")


    def test_untrusted_worker_and_autoload_canary_do_not_execute(self):
        self.assertIsNotNone(shutil.which("php"), "The execution canary requires the Package job's PHP runtime")
        directory = self.worker()
        vendor = self.project / "vendor"
        vendor.mkdir()
        (vendor / "autoload.php").write_text(
            "<?php file_put_contents(dirname(__DIR__).'/autoload-canary', 'executed');\n")
        (directory / "worker.php").write_text(
            "<?php\n"
            "require dirname(__DIR__, 2).'/vendor/autoload.php';\n"
            "file_put_contents(dirname(__DIR__, 2).'/worker-canary', 'executed');\n"
            "echo json_encode(['enabled' => false]);\n")
        refused = None
        try:
            # Intentionally use the existing default API: the regression must
            # fail on actual execution, not on an unsupported new argument.
            self.helper.preparation_generation(self.project)
        except RuntimeError as error:
            refused = str(error)
        executed = [name for name in ("autoload-canary", "worker-canary") if (self.project / name).exists()]
        self.assertEqual([], executed, "UNTRUSTED_PROJECT_CODE_EXECUTED: " + ", ".join(executed))
        self.assertIsNotNone(refused, "Untrusted preparation must require explicit execution consent")
        self.assertIn("--trust-project-code", refused)

    def test_native_graph_is_available_without_a_prepared_extension(self):
        self.assertIsNone(self.helper.preparation_generation(self.project))
        self.worker()
        with patch.object(self.helper.subprocess, "run", return_value=self.response({"enabled": False})) as run:
            self.assertIsNone(self.helper.preparation_generation(self.project))
        self.assertEqual(["php", str(self.project / ".uxor/mago/worker.php"), "--check"], run.call_args.args[0])
        self.assertEqual(self.project, run.call_args.kwargs["cwd"])

    def test_active_extension_with_missing_worker_fails_instead_of_claiming_native_graph(self):
        directory = self.project / ".uxor/mago"
        directory.mkdir(parents=True)
        (directory / "config.toml").write_text("[extension-hosts.uxor-symfony]\n")
        with self.assertRaisesRegex(RuntimeError, "preparation"):
            self.helper.preparation_generation(self.project)

    def test_fresh_preparation_has_a_bounded_valid_identity(self):
        self.worker()
        generation = "1a" * 16
        with patch.object(self.helper.subprocess, "run", return_value=self.response({
            "enabled": True, "fresh": True, "preparationId": generation,
        })):
            self.assertEqual(generation, self.helper.preparation_generation(self.project))
        for document in [
            None, [], {}, {"enabled": "yes"},
            {"enabled": True, "fresh": False, "preparationId": generation},
            {"enabled": True, "fresh": True, "preparationId": ""},
            {"enabled": True, "fresh": True, "preparationId": "wrong"},
            {"enabled": True, "fresh": True, "preparationId": "g" * 32},
        ]:
            with self.subTest(document=document):
                with patch.object(self.helper.subprocess, "run", return_value=self.response(document)):
                    with self.assertRaises(RuntimeError):
                        self.helper.preparation_generation(self.project)
        for stdout in ("{broken", " " * 4097):
            with patch.object(self.helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout, "")):
                with self.assertRaises(RuntimeError):
                    self.helper.preparation_generation(self.project)

    def test_failed_or_unavailable_preparation_check_never_returns_a_generation(self):
        self.worker()
        for failure in (OSError("missing PHP"), subprocess.TimeoutExpired(["php"], 60)):
            with self.subTest(failure=type(failure).__name__):
                with patch.object(self.helper.subprocess, "run", side_effect=failure):
                    with self.assertRaises(RuntimeError):
                        self.helper.preparation_generation(self.project)
        with patch.object(self.helper.subprocess, "run", return_value=self.response({
            "enabled": True, "fresh": True, "preparationId": "a" * 32,
        }, status=3)):
            with self.assertRaisesRegex(RuntimeError, "stale|unavailable"):
                self.helper.preparation_generation(self.project)

    def lsp_modules(self):
        class LspApi:
            def __init__(self):
                self.restarts = 0
                self.queries = []

            def restart_language_server(self):
                self.restarts += 1

            def get_symbol_references(self, relative_path, symbol, member=""):
                self.queries.append((relative_path, symbol, member))
                return {"source": {"symbol": symbol, "member": member}, "references": []}

        modules = {}
        for name in ("serena", "serena.repl", "serena.repl.api", "serena.repl.api.lsp_api"):
            modules[name] = types.ModuleType(name)
            modules[name].__path__ = []
        modules["serena.repl.api.lsp_api"].LspApi = LspApi
        return modules, LspApi

    def test_graph_restarts_once_per_changed_preparation_and_forwards_the_exact_query(self):
        modules, api_type = self.lsp_modules()
        with patch.dict(sys.modules, modules):
            self.helper.install_graph_guard()
        api = api_type()
        first, second = "a" * 32, "b" * 32
        with patch.object(self.helper, "preparation_generation", side_effect=[first, first, first, first, second, second]):
            for expected_restarts in (1, 1, 2):
                result = api.get_symbol_references("src/Consumer.php", "App\\Consumer", "__construct")
                self.assertEqual(expected_restarts, api.restarts)
                self.assertEqual({"symbol": "App\\Consumer", "member": "__construct"}, result["source"])
        self.assertEqual([("src/Consumer.php", "App\\Consumer", "__construct")] * 3, api.queries)

    def test_stale_preparation_stops_before_query_and_mid_query_change_rejects_result(self):
        modules, api_type = self.lsp_modules()
        with patch.dict(sys.modules, modules):
            self.helper.install_graph_guard()
        api = api_type()
        with patch.object(self.helper, "preparation_generation", side_effect=RuntimeError("stale")):
            with self.assertRaisesRegex(RuntimeError, "stale"):
                api.get_symbol_references("src/Consumer.php", "App\\Consumer")
        self.assertEqual([], api.queries)
        with patch.object(self.helper, "preparation_generation", side_effect=["a" * 32, "b" * 32]):
            with self.assertRaisesRegex(RuntimeError, "changed"):
                api.get_symbol_references("src/Consumer.php", "App\\Consumer")
        self.assertEqual(1, len(api.queries))

    def test_busy_session_fails_without_replacing_existing_configuration(self):
        home = self.state / "serena"
        home.mkdir()
        configuration = home / "serena_config.yml"
        configuration.write_text("keep-existing-session\n")
        with (self.state / "session.lock").open("a") as owner:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(self.helper, "STATE", self.state), patch.object(self.helper, "PROJECT", self.project), \
                 patch.dict(os.environ, {"SERENA_HOME": str(home)}), patch.object(sys, "argv", ["start.py"]), \
                 patch.object(self.helper, "install_graph_guard") as install, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as stopped:
                    self.helper.main()
                self.assertEqual(2, stopped.exception.code)
                install.assert_not_called()
        self.assertEqual("keep-existing-session\n", configuration.read_text())

    def test_session_configuration_switches_edit_access_without_touching_application_settings(self):
        settings = self.project / ".serena/project.yml"
        settings.parent.mkdir()
        settings.write_text("project_name: consumer-owned\n")
        cli = types.ModuleType("serena.cli")
        calls = []
        cli.top_level = lambda **kwargs: calls.append(kwargs)
        home = self.state / "serena"
        for arguments, expected in (([], True), (["--write"], False), ([], True)):
            with self.subTest(arguments=arguments):
                with patch.object(self.helper, "STATE", self.state), patch.object(self.helper, "PROJECT", self.project), \
                     patch.dict(os.environ, {"SERENA_HOME": str(home)}), patch.object(sys, "argv", ["start.py", *arguments]), \
                     patch.object(self.helper, "install_graph_guard"), patch.dict(sys.modules, {"serena.cli": cli}):
                    previous_mask = os.umask(0o077)
                    try:
                        self.helper.main()
                    finally:
                        os.umask(previous_mask)
                config = json.loads((self.state / "project/project.yml").read_text())
                self.assertEqual(expected, config["read_only"])
                self.assertIn("mago", config["language_servers"])
                self.assertIn("lsp.get_symbol_references", config["included_apis"])
                self.assertEqual("project_name: consumer-owned\n", settings.read_text())
                self.assertIn(str(self.project), calls[-1]["args"])
        self.assertEqual(3, len(calls))


if __name__ == "__main__":
    unittest.main()
