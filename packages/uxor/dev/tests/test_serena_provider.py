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
        self.php = shutil.which("php")
        self.assertIsNotNone(self.php, "The provider checks require the Package job's PHP runtime")
        self.provider_php_default = self.helper.PHP_BINARY
        php_runtime = patch.object(self.helper, "PHP_BINARY", self.php)
        php_runtime.start()
        self.addCleanup(php_runtime.stop)
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


    def producer(self, operation, vendor="vendor", preparation_id="a" * 32):
        """Use the real package producer's serialization, never application PHP."""
        code = r"""
require dirname($argv[1]).'/Preparation/ProjectPath.php';
require dirname($argv[1]).'/Preparation/PreparationSnapshot.php';
require $argv[1];
if ($argv[2] === 'files') {
    echo json_encode([
        'files' => \Xormania\UXor\SymfonyPreparation::configurationFiles($argv[4]),
        'active' => \Xormania\UXor\Preparation\PreparationSnapshot::ACTIVE_CONFIG,
    ], JSON_THROW_ON_ERROR);
    exit(0);
}
if ($argv[2] === 'status') {
    require dirname($argv[1]).'/ProjectInspector.php';
    echo json_encode((new \Xormania\UXor\SymfonyPreparation())->status($argv[3]), JSON_THROW_ON_ERROR);
    exit(0);
}
$snapshot = (new \Xormania\UXor\Preparation\PreparationSnapshot())->snapshot($argv[3], $argv[4]);
$manifest = [
    'schema' => 1, 'state' => 'ready', 'enabled' => true, 'preparation_id' => $argv[5],
    'prepared_at' => '2026-01-01T00:00:00+00:00', 'environment' => 'dev', 'debug' => true,
    'vendor_directory' => $argv[4], 'php_version' => PHP_VERSION,
    'dependencies' => \Xormania\UXor\SymfonyPreparation::REQUIREMENTS,
    'reference_sha256' => hash_file('sha256', $argv[3].'/.uxor/mago/container-reference.dev.json'),
    'inputs_sha256' => $snapshot['sha256'], 'input_files' => $snapshot['files'],
];
echo json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
"""
        result = subprocess.run(
            [self.php, "-n", "-r", code, str(HELPER.parents[3] / "src/SymfonyPreparation.php"),
             operation, str(self.project), vendor, preparation_id],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout

    def publish_manifest(self, vendor="vendor", preparation_id="a" * 32):
        # This is the application's existing fingerprint producer, not a copy
        # of the provider verifier. The live acceptance lane also prepares real
        # Symfony container exports before querying the installed provider.
        content = self.producer("manifest", vendor, preparation_id)
        (self.project / ".uxor/mago/preparation.json").write_text(content)
        return json.loads(content)

    def prepared(self, vendor="vendor"):
        self.php = shutil.which("php")
        self.assertIsNotNone(self.php, "Provider verification requires the Package job's PHP runtime")
        files = {
            "composer.json": json.dumps({
                "name": "fixture/consumer", "config": {"vendor-dir": vendor},
                "autoload": {"psr-4": {"App\\": "src/"}},
            }),
            "composer.lock": "{}\n",
            "bin/console": "<?php // never boot this fixture\n",
            "src/Consumer.php": "<?php namespace App; final class Consumer {}\n",
            "config/services.yaml": "services: {}\n",
            "mago.toml": 'extends = [".uxor/mago/config.toml"]\n',
            vendor + "/autoload.php": "<?php file_put_contents("
                + json.dumps(str(self.project / "autoload-canary")) + ", 'executed');\n",
            vendor + "/composer/installed.json": json.dumps({"packages": [
                {"name": "carthage-software/mago", "version": "1.60.2"},
                {"name": "byte-kitsune/mago-symfony-wiring", "version": "1.3.0"},
            ]}),
            vendor + "/carthage-software/mago/composer/src/Sdk/Worker.php": "<?php // SDK input\n",
            vendor + "/byte-kitsune/mago-symfony-wiring/src/Extension.php": "<?php // wiring input\n",
            vendor + "/byte-kitsune/mago-symfony-wiring/bin/create-container-reference.php": "<?php // exporter input\n",
        }
        for relative, content in files.items():
            path = self.project / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        configuration = json.loads(self.producer("files", vendor))
        for relative, content in configuration["files"].items():
            path = self.project / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        directory = self.project / ".uxor/mago"
        (directory / "config.toml").write_text(configuration["active"])
        (directory / "container-reference.dev.json").write_text('{"services":[]}\n')
        self.publish_manifest(vendor)
        self.assertTrue(json.loads(self.producer("status", vendor))["fresh"])
        self.assertFalse((self.project / "autoload-canary").exists())
        return directory

    def verify(self):
        with patch.object(self.helper, "PHP_BINARY", shutil.which("php")):
            return self.helper.preparation_generation(self.project, trust_project_code=True)


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


    def test_fabricated_worker_freshness_cannot_replace_missing_preparation_artifacts(self):
        self.assertIsNotNone(shutil.which("php"), "The freshness canary requires the Package job's PHP runtime")
        directory = self.worker()
        (directory / "config.toml").write_text("[extension-hosts.uxor-symfony]\n")
        (directory / "worker.php").write_text(
            "<?php\n"
            "file_put_contents(dirname(__DIR__, 2).'/freshness-canary', 'executed');\n"
            "echo json_encode(['enabled' => true, 'fresh' => true, 'preparationId' => str_repeat('a', 32)]);\n")
        self.assertFalse((directory / "preparation.json").exists())
        self.assertFalse((directory / "container-reference.dev.json").exists())
        refused = None
        generation = None
        try:
            # Existing API with explicit execution permission: the defect is
            # trusting project stdout as independent freshness evidence.
            generation = self.helper.preparation_generation(self.project, trust_project_code=True)
        except RuntimeError as error:
            refused = str(error)
        self.assertIsNotNone(refused, "FABRICATED_PREPARATION_ACCEPTED_WITHOUT_ARTIFACTS: " + str(generation))
        self.assertFalse((self.project / "freshness-canary").exists(),
                         "FRESHNESS_CHECK_EXECUTED_APPLICATION_CODE")


    def test_explicit_trust_does_not_execute_application_php_or_ini_hooks_during_verification(self):
        directory = self.prepared()
        ini = self.root / "php-config"
        ini.mkdir()
        (ini / "php.ini").write_text(
            'auto_prepend_file="' + str(self.project / "vendor/autoload.php") + '"\n')
        with patch.dict(os.environ, {"PHPRC": str(ini), "PHP_INI_SCAN_DIR": str(ini)}):
            self.assertRegex(self.verify(), r"^[0-9a-f]{64}$")
            (directory / "worker.php").write_text(
                "<?php\n"
                "require dirname(__DIR__, 2).'/vendor/autoload.php';\n"
                "file_put_contents(dirname(__DIR__, 2).'/worker-canary', 'executed');\n"
                "echo json_encode(['enabled' => false]);\n")
            with self.assertRaises(RuntimeError):
                self.verify()
        for name in ("autoload-canary", "worker-canary"):
            self.assertFalse((self.project / name).exists(), name)

    def test_graph_guard_requires_execution_trust_before_installation(self):
        modules, api_type = self.lsp_modules()
        original = api_type.get_symbol_references
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(RuntimeError, "--trust-project-code"):
                self.helper.install_graph_guard()
        self.assertIs(original, api_type.get_symbol_references)

    def test_direct_startup_without_trust_or_with_only_write_does_not_create_state_or_start_serena(self):
        home = self.state / "serena"
        cli = types.ModuleType("serena.cli")
        started = []
        cli.top_level = lambda **kwargs: started.append(kwargs)
        for arguments in ([], ["--write"], ["--trust-project"], ["--trust-project-code=true"]):
            with self.subTest(arguments=arguments):
                with patch.object(self.helper, "STATE", self.state), patch.object(self.helper, "PROJECT", self.project), \
                     patch.dict(os.environ, {"SERENA_HOME": str(home)}), patch.object(sys, "argv", ["start.py", *arguments]), \
                     patch.object(self.helper, "install_graph_guard") as install, \
                     patch.dict(sys.modules, {"serena.cli": cli}), redirect_stderr(io.StringIO()) as stderr:
                    with self.assertRaises(SystemExit) as stopped:
                        self.helper.main()
                self.assertEqual(2, stopped.exception.code)
                self.assertIn("--trust-project-code", stderr.getvalue())
                install.assert_not_called()
                self.assertEqual([], started)
                self.assertEqual([], list(self.state.iterdir()))

    def test_native_graph_is_available_without_preparation_or_with_exact_native_configuration(self):
        self.assertIsNone(self.verify())
        self.php = shutil.which("php")
        configuration = json.loads(self.producer("files"))
        directory = self.worker()
        (directory / "config.toml").write_text(configuration["files"][".uxor/mago/config.toml"])
        (directory / "worker.php").write_text(
            "<?php file_put_contents(dirname(__DIR__, 2).'/native-canary', 'executed');\n")
        self.assertIsNone(self.verify())
        self.assertFalse((self.project / "native-canary").exists())

    def test_partial_preparation_never_silently_downgrades_to_native_graph(self):
        directory = self.worker()
        with self.assertRaises(RuntimeError):
            self.verify()
        (directory / "config.toml").write_text("[extension-hosts.uxor-symfony]\n")
        (directory / "worker.php").unlink()
        with self.assertRaises(RuntimeError):
            self.verify()
        (directory / "config.toml").unlink()
        for name in ("preparation.json", "container-reference.dev.json"):
            with self.subTest(artifact=name):
                (directory / name).write_text("{}")
                with self.assertRaises(RuntimeError):
                    self.verify()
                (directory / name).unlink()

    def test_only_the_fixed_provider_verifier_supplies_the_generation(self):
        self.prepared()
        self.assertEqual("/usr/local/bin/php", self.provider_php_default)
        verifier = HELPER.with_name("verify-preparation.php").resolve()
        self.assertEqual(verifier, self.helper.PREPARATION_VERIFIER)
        real_run = subprocess.run
        with patch.object(self.helper.subprocess, "run", wraps=real_run) as run:
            generation = self.verify()
        self.assertRegex(generation, r"^[0-9a-f]{64}$")
        self.assertEqual(1, run.call_count)
        self.assertEqual([shutil.which("php"), "-n", str(verifier), str(self.project)], run.call_args.args[0])
        self.assertNotIn(str(self.project / ".uxor/mago/worker.php"), run.call_args.args[0])
        self.assertFalse((self.project / "autoload-canary").exists())

    def test_provider_response_requires_bounded_verified_generation(self):
        generation = "1a" * 32
        with patch.object(self.helper.subprocess, "run", return_value=self.response({
            "enabled": True, "fresh": True, "generation": generation,
        })):
            self.assertEqual(generation, self.verify())
        for document in [
            None, [], {}, {"enabled": "yes"},
            {"enabled": True, "fresh": False, "generation": generation},
            {"enabled": True, "fresh": True, "generation": ""},
            {"enabled": True, "fresh": True, "generation": "a" * 32},
            {"enabled": True, "fresh": True, "generation": "g" * 64},
            {"enabled": True, "fresh": True, "preparationId": "a" * 32},
        ]:
            with self.subTest(document=document):
                with patch.object(self.helper.subprocess, "run", return_value=self.response(document)):
                    with self.assertRaises(RuntimeError):
                        self.verify()
        for stdout in ("{broken", " " * 4097):
            with patch.object(self.helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout, "")):
                with self.assertRaises(RuntimeError):
                    self.verify()

    def test_failed_or_unavailable_provider_verifier_never_returns_a_generation(self):
        for failure in (OSError("missing PHP"), subprocess.TimeoutExpired(["php"], 60)):
            with self.subTest(failure=type(failure).__name__):
                with patch.object(self.helper.subprocess, "run", side_effect=failure):
                    with self.assertRaises(RuntimeError):
                        self.verify()
        with patch.object(self.helper.subprocess, "run", return_value=self.response({
            "enabled": True, "fresh": True, "generation": "a" * 64,
        }, status=3)):
            with self.assertRaisesRegex(RuntimeError, "stale|unavailable"):
                self.verify()

    def test_producer_preparation_is_stable_until_verified_artifacts_change(self):
        directory = self.prepared()
        first = self.verify()
        self.assertEqual(first, self.verify())
        manifest = json.loads((directory / "preparation.json").read_text())
        original_id = manifest["preparation_id"]
        (directory / "container-reference.dev.json").write_text('{"services":[{"id":"updated"}]}\n')
        with self.assertRaises(RuntimeError):
            self.verify()
        self.publish_manifest(preparation_id=original_id)
        second = self.verify()
        self.assertNotEqual(first, second, "Verified reference changes must invalidate the LSP generation")
        source = self.project / "src/Consumer.php"
        source.write_text(source.read_text() + "// updated input\n")
        with self.assertRaises(RuntimeError):
            self.verify()
        self.publish_manifest(preparation_id=original_id)
        self.assertNotEqual(second, self.verify(), "Reusing an application ID must not reuse stale LSP state")

    def test_required_preparation_artifacts_cannot_be_missing_or_modified(self):
        directory = self.prepared()
        generation = self.verify()
        for name in ("config.toml", "worker.php", "preparation.json", "container-reference.dev.json"):
            path = directory / name
            original = path.read_bytes()
            with self.subTest(artifact=name, mutation="missing"):
                path.unlink()
                with self.assertRaises(RuntimeError):
                    self.verify()
                path.write_bytes(original)
                self.assertEqual(generation, self.verify())
            with self.subTest(artifact=name, mutation="changed"):
                path.write_bytes(original + b"\nchanged")
                with self.assertRaises(RuntimeError):
                    self.verify()
                path.write_bytes(original)
                self.assertEqual(generation, self.verify())

    def test_tracked_application_and_dependency_changes_reject_preparation(self):
        self.prepared()
        generation = self.verify()
        for relative in (
            "src/Consumer.php", "config/services.yaml", "bin/console", "composer.json", "composer.lock",
            "mago.toml", "vendor/autoload.php", "vendor/composer/installed.json",
            "vendor/carthage-software/mago/composer/src/Sdk/Worker.php",
            "vendor/byte-kitsune/mago-symfony-wiring/src/Extension.php",
            "vendor/byte-kitsune/mago-symfony-wiring/bin/create-container-reference.php",
        ):
            with self.subTest(input=relative):
                path = self.project / relative
                original = path.read_bytes()
                path.write_bytes(original + b"\n")
                with self.assertRaises(RuntimeError):
                    self.verify()
                path.write_bytes(original)
                self.assertEqual(generation, self.verify())

    def test_added_and_deleted_input_paths_reject_preparation(self):
        self.prepared()
        generation = self.verify()
        for relative in ("src/New.php", "tests/NewTest.php", "config/empty-directory"):
            with self.subTest(input=relative):
                path = self.project / relative
                parent_existed = path.parent.exists()
                path.parent.mkdir(parents=True, exist_ok=True)
                if relative.endswith("directory"):
                    path.mkdir()
                else:
                    path.write_text("<?php // added input\n")
                with self.assertRaises(RuntimeError):
                    self.verify()
                if path.is_dir():
                    path.rmdir()
                else:
                    path.unlink()
                if not parent_existed:
                    path.parent.rmdir()
                self.assertEqual(generation, self.verify())
        source = self.project / "src/Consumer.php"
        original = source.read_bytes()
        source.unlink()
        with self.assertRaises(RuntimeError):
            self.verify()
        source.write_bytes(original)
        self.assertEqual(generation, self.verify())

    def test_custom_vendor_and_composer_autoload_paths_match_the_producer(self):
        directory = self.prepared("dependencies/vendor")
        composer_path = self.project / "composer.json"
        composer = json.loads(composer_path.read_text())
        composer["autoload"] = {
            "psr-4": {"App\\": ["src/", "domain/"]},
            "files": ["bootstrap.php"],
            "classmap": ["modules/*/"],
        }
        composer["autoload-dev"] = {"psr-0": {"Tests\\": "spec/"}}
        composer_path.write_text(json.dumps(composer))
        for relative in ("domain/Model.php", "bootstrap.php", "modules/one/Entry.php", "spec/Case.php"):
            path = self.project / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("<?php // scoped autoload input\n")
        self.publish_manifest("dependencies/vendor")
        self.assertTrue(json.loads(self.producer("status", "dependencies/vendor"))["fresh"])
        generation = self.verify()
        self.assertRegex(generation, r"^[0-9a-f]{64}$")
        for relative in ("domain/Model.php", "bootstrap.php", "modules/one/Entry.php", "spec/Case.php"):
            path = self.project / relative
            original = path.read_bytes()
            with self.subTest(input=relative):
                path.write_bytes(original + b"\n")
                with self.assertRaises(RuntimeError):
                    self.verify()
                path.write_bytes(original)
                self.assertEqual(generation, self.verify())
        added = self.project / "modules/two"
        added.mkdir()
        with self.assertRaises(RuntimeError):
            self.verify()
        added.rmdir()
        self.assertEqual(generation, self.verify())
        self.assertEqual("dependencies/vendor", json.loads((directory / "preparation.json").read_text())["vendor_directory"])

    def test_root_classmap_tracks_vendor_siblings_and_only_supported_vendor_inputs(self):
        vendor = "dependencies/vendor"
        self.prepared(vendor)
        composer_path = self.project / "composer.json"
        composer = json.loads(composer_path.read_text())
        composer["autoload"] = {"classmap": ["."]}
        composer_path.write_text(json.dumps(composer))
        application_source = self.project / "dependencies/ProjectService.php"
        application_source.write_text("<?php // application source\n")
        unrelated_vendor = self.project / vendor / "other/package/src/Dependency.php"
        unrelated_vendor.parent.mkdir(parents=True)
        unrelated_vendor.write_text("<?php // installed dependency\n")
        self.publish_manifest(vendor)
        generation = self.verify()

        unrelated_vendor.write_text("<?php // outside the tracked dependency inputs\n")
        self.assertEqual(generation, self.verify())
        self.assertTrue(json.loads(self.producer("status", vendor))["fresh"])

        worker = self.project / vendor / "carthage-software/mago/composer/src/Sdk/Worker.php"
        for path in (application_source, worker):
            original = path.read_bytes()
            path.write_bytes(original + b"// changed\n")
            with self.subTest(path=path.relative_to(self.project), reader="package"):
                self.assertFalse(json.loads(self.producer("status", vendor))["fresh"])
            with self.subTest(path=path.relative_to(self.project), reader="provider"), self.assertRaises(RuntimeError):
                self.verify()
            path.write_bytes(original)
            self.assertEqual(generation, self.verify())

    def test_root_autoload_excludes_runtime_state_and_environment_values(self):
        self.prepared()
        composer_path = self.project / "composer.json"
        composer = json.loads(composer_path.read_text())
        composer["autoload"] = {"classmap": [""], "files": [".env.local", "config/secrets/fixture.php"]}
        composer_path.write_text(json.dumps(composer))
        self.publish_manifest()
        self.assertTrue(json.loads(self.producer("status"))["fresh"])
        generation = self.verify()
        for relative in (
            ".env.local", "src/.env.test", "config/secrets/fixture.php",
            "var/cache/fixture", "public/assets/fixture", "node_modules/fixture",
            ".serena/fixture", ".agents/fixture", ".claude/fixture", ".git/fixture",
        ):
            path = self.project / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("disposable excluded fixture\n")
        self.assertEqual(generation, self.verify())
        self.assertTrue(json.loads(self.producer("status"))["fresh"])

    def test_manifest_identity_and_hash_fields_fail_closed(self):
        directory = self.prepared()
        path = directory / "preparation.json"
        original = path.read_text()
        mutations = [
            ("schema", 2), ("schema", "1"), ("state", "preparing"), ("state", "failed"),
            ("enabled", False), ("enabled", "true"), ("vendor_directory", "../vendor"),
            ("vendor_directory", "different"), ("environment", "prod"),
            ("preparation_id", ""), ("preparation_id", "a" * 31), ("preparation_id", "g" * 32),
            ("reference_sha256", "0" * 64), ("reference_sha256", None),
            ("inputs_sha256", "0" * 64), ("inputs_sha256", None),
        ]
        for name, value in mutations:
            with self.subTest(field=name, value=value):
                manifest = json.loads(original)
                manifest[name] = value
                path.write_text(json.dumps(manifest))
                with self.assertRaises(RuntimeError):
                    self.verify()
        path.write_text(original)
        self.assertRegex(self.verify(), r"^[0-9a-f]{64}$")

    def test_invalid_or_oversized_metadata_and_artifacts_are_rejected(self):
        directory = self.prepared()
        for relative in (".uxor/mago/preparation.json", "composer.json", "vendor/composer/installed.json"):
            path = self.project / relative
            original = path.read_bytes()
            for document in ("{broken", "null", '"not an object"', "[]"):
                with self.subTest(path=relative, document=document):
                    path.write_text(document)
                    with self.assertRaises(RuntimeError):
                        self.verify()
            path.write_bytes(original)
        for relative, maximum in (
            (".uxor/mago/preparation.json", 1024 * 1024),
            (".uxor/mago/container-reference.dev.json", 64 * 1024 * 1024),
            ("src/Consumer.php", 16 * 1024 * 1024),
        ):
            with self.subTest(oversized=relative):
                path = self.project / relative
                original = path.read_bytes()
                with path.open("wb") as stream:
                    stream.truncate(maximum + 1)
                with self.assertRaises(RuntimeError):
                    self.verify()
                path.write_bytes(original)
        self.assertRegex(self.verify(), r"^[0-9a-f]{64}$")

    def test_preparation_artifact_symlinks_are_rejected(self):
        directory = self.prepared()
        for name in ("config.toml", "worker.php", "preparation.json", "container-reference.dev.json"):
            with self.subTest(artifact=name):
                path = directory / name
                original = path.read_bytes()
                target = self.project / ("saved-" + name)
                target.write_bytes(original)
                path.unlink()
                path.symlink_to(target)
                with self.assertRaises(RuntimeError):
                    self.verify()
                path.unlink()
                path.write_bytes(original)
                target.unlink()
        self.assertRegex(self.verify(), r"^[0-9a-f]{64}$")

    def test_internal_input_symlinks_match_producer_and_external_links_are_rejected(self):
        self.prepared()
        alias = self.project / "src/Alias.php"
        alias.symlink_to(self.project / "src/Consumer.php")
        self.publish_manifest()
        self.assertTrue(json.loads(self.producer("status"))["fresh"])
        generation = self.verify()
        outside = self.root / "outside.php"
        outside.write_text("<?php // must not become a tracked project input\n")
        alias.unlink()
        alias.symlink_to(outside)
        with self.assertRaises(RuntimeError):
            self.verify()
        alias.unlink()
        alias.symlink_to(self.root / "missing.php")
        with self.assertRaises(RuntimeError):
            self.verify()
        alias.unlink()
        alias.symlink_to(self.project / "src/Consumer.php")
        self.assertEqual(generation, self.verify())

    def test_preparation_lock_blocks_reads_during_publication_without_creating_state(self):
        directory = self.prepared()
        generation = self.verify()
        lock_path = directory / ".prepare.lock"
        self.assertFalse(lock_path.exists(), "Verification must not create preparation state")
        with lock_path.open("w") as owner:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.subTest(reader="package"):
                self.assertFalse(json.loads(self.producer("status"))["fresh"],
                                 "The package reported ready during exclusive publication")
            with self.subTest(reader="provider"), self.assertRaises(RuntimeError):
                self.verify()
        self.assertTrue(json.loads(self.producer("status"))["fresh"])
        self.assertEqual(generation, self.verify())
        before = {str(path.relative_to(self.project)): path.read_bytes()
                  for path in self.project.rglob("*") if path.is_file()}
        self.assertEqual(generation, self.verify())
        after = {str(path.relative_to(self.project)): path.read_bytes()
                 for path in self.project.rglob("*") if path.is_file()}
        self.assertEqual(before, after)


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
            self.helper.install_graph_guard(trust_project_code=True)
        api = api_type()
        first, second = "a" * 64, "b" * 64
        with patch.object(self.helper, "preparation_generation", side_effect=[first, first, first, first, second, second]):
            for expected_restarts in (1, 1, 2):
                result = api.get_symbol_references("src/Consumer.php", "App\\Consumer", "__construct")
                self.assertEqual(expected_restarts, api.restarts)
                self.assertEqual({"symbol": "App\\Consumer", "member": "__construct"}, result["source"])
        self.assertEqual([("src/Consumer.php", "App\\Consumer", "__construct")] * 3, api.queries)

    def test_stale_preparation_stops_before_query_and_mid_query_change_rejects_result(self):
        modules, api_type = self.lsp_modules()
        with patch.dict(sys.modules, modules):
            self.helper.install_graph_guard(trust_project_code=True)
        api = api_type()
        with patch.object(self.helper, "preparation_generation", side_effect=RuntimeError("stale")):
            with self.assertRaisesRegex(RuntimeError, "stale"):
                api.get_symbol_references("src/Consumer.php", "App\\Consumer")
        self.assertEqual([], api.queries)
        with patch.object(self.helper, "preparation_generation", side_effect=["a" * 64, "b" * 64]):
            with self.assertRaisesRegex(RuntimeError, "changed"):
                api.get_symbol_references("src/Consumer.php", "App\\Consumer")
        self.assertEqual(1, len(api.queries))

    def test_first_native_query_and_prepared_to_native_transition_restart_the_language_server(self):
        modules, api_type = self.lsp_modules()
        with patch.dict(sys.modules, modules):
            self.helper.install_graph_guard(trust_project_code=True)
        api = api_type()
        prepared = "b" * 64
        with patch.object(self.helper, "preparation_generation",
                          side_effect=[None, None, None, None, prepared, prepared, None, None, None, None]):
            for expected_restarts in (1, 1, 2, 3, 3):
                api.get_symbol_references("src/Consumer.php", "App\\Consumer")
                self.assertEqual(expected_restarts, api.restarts)

    def test_explicit_restart_invalidates_verification_and_preserves_arguments_and_results(self):
        modules, api_type = self.lsp_modules()
        restarts = []
        response = object()

        def restart(api, *args, **kwargs):
            api.restarts += 1
            restarts.append((args, kwargs))
            if kwargs.get("fail"):
                raise RuntimeError("restart failed")
            return response

        api_type.restart_language_server = restart
        with patch.dict(sys.modules, modules):
            self.helper.install_graph_guard(trust_project_code=True)
        for generation in (None, "a" * 64):
            with self.subTest(generation=generation):
                api = api_type()
                with patch.object(self.helper, "preparation_generation", return_value=generation):
                    api.get_symbol_references("src/Consumer.php", "App\\Consumer")
                    self.assertEqual(1, api.restarts)
                    self.assertIs(response, api.restart_language_server("manual", clear_cache=True))
                    self.assertEqual((("manual",), {"clear_cache": True}), restarts[-1])
                    self.assertEqual(2, api.restarts)
                    api.get_symbol_references("src/Consumer.php", "App\\Consumer")
                    self.assertEqual(3, api.restarts)
                    api.get_symbol_references("src/Consumer.php", "App\\Consumer")
                    self.assertEqual(3, api.restarts)
                    with self.assertRaisesRegex(RuntimeError, "restart failed"):
                        api.restart_language_server(fail=True)
                    api.get_symbol_references("src/Consumer.php", "App\\Consumer")
                    self.assertEqual(5, api.restarts)


    def test_real_verification_rejects_changes_before_and_during_graph_queries(self):
        self.prepared()
        modules, api_type = self.lsp_modules()
        source = self.project / "src/Consumer.php"
        original_source = source.read_text()
        original_query = api_type.get_symbol_references

        def changing_query(api, relative_path, symbol, member=""):
            result = original_query(api, relative_path, symbol, member)
            source.write_text(original_source + "// changed during query\n")
            return result

        api_type.get_symbol_references = changing_query
        real_generation = self.helper.preparation_generation
        with patch.dict(sys.modules, modules):
            self.helper.install_graph_guard(trust_project_code=True)
        api = api_type()

        def verify_selected(*, trust_project_code=False):
            return real_generation(self.project, trust_project_code=trust_project_code)

        with patch.object(self.helper, "preparation_generation", side_effect=verify_selected):
            source.write_text(original_source + "// changed before query\n")
            with self.assertRaises(RuntimeError):
                api.get_symbol_references("src/Consumer.php", "App\\Consumer")
            self.assertEqual([], api.queries)
            source.write_text(original_source)
            with self.assertRaises(RuntimeError):
                api.get_symbol_references("src/Consumer.php", "App\\Consumer")
        self.assertEqual(1, len(api.queries))
        self.assertEqual(1, api.restarts)
        self.assertFalse((self.project / "autoload-canary").exists())


    def test_busy_session_fails_without_replacing_existing_configuration(self):
        home = self.state / "serena"
        home.mkdir()
        configuration = home / "serena_config.yml"
        configuration.write_text("keep-existing-session\n")
        with (self.state / "session.lock").open("a") as owner:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(self.helper, "STATE", self.state), patch.object(self.helper, "PROJECT", self.project), \
                 patch.dict(os.environ, {"SERENA_HOME": str(home)}), patch.object(sys, "argv", ["start.py", "--trust-project-code"]), \
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
                     patch.dict(os.environ, {"SERENA_HOME": str(home)}), patch.object(sys, "argv", ["start.py", "--trust-project-code", *arguments]), \
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
