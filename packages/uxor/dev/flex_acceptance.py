"""Install UXor's development stack in an application configured by Symfony Flex recipes."""
from __future__ import annotations

import json
from pathlib import Path
import secrets

from environment_acceptance import operation, run
from lifecycle_events import operation as observe


@observe("consumer.flex-debug-pack")
def check(root: Path, php: str, composer: list[str], candidate: dict, mate: dict[str, str]) -> None:
    root.mkdir()
    manifest = {
        "name": "consumer/flex-debug", "type": "project",
        "require": {"php": ">=8.4", "symfony/flex": "^2", "symfony/console": "8.1.*",
                    "symfony/dotenv": "8.1.*", "symfony/framework-bundle": "8.1.*",
                    "symfony/runtime": "8.1.*", "symfony/yaml": "8.1.*"},
        "require-dev": {"xormania/uxor": candidate["package"]["version"], **mate},
        "repositories": [candidate], "autoload": {"psr-4": {"App\\": "src/"}},
        "config": {"allow-plugins": {"symfony/flex": True, "symfony/runtime": True,
                                     "symfony/ai-mate-composer-plugin": True}},
        "extra": {"symfony": {"require": "8.1.*"}},
        # Composer writes the solver lock before Flex's post-update-cmd unpacks the two packs.
        "scripts": {
            "pre-update-cmd": "@php -r \"file_put_contents('composer-updates', '+', FILE_APPEND);\"",
            "post-autoload-dump": [
                "@php -r \"if ([] === array_diff(['symfony/debug-pack', 'symfony/profiler-pack'], "
                "array_column(json_decode(file_get_contents('composer.lock'), true)['packages-dev'], 'name'))) "
                "copy('composer.lock', 'resolved-before-flex.lock');\""
            ],
        },
    }
    (root / "composer.json").write_text(json.dumps(manifest, indent=4) + "\n")
    run("composer.install-flex", [*composer, "install", "--prefer-dist", "--no-interaction", "--no-progress"],
        root, timeout=600)
    packs = {"symfony/debug-pack", "symfony/profiler-pack"}
    components = {"symfony/debug-bundle", "symfony/monolog-bundle", "symfony/web-profiler-bundle", "symfony/stopwatch"}
    extension = "symfony/ai-monolog-mate-extension"

    def installed_packages() -> set[str]:
        return {p["name"] for p in json.loads((root / "vendor/composer/installed.json").read_text())["packages"]}

    if installed_packages() & (packs | components | {"monolog/monolog", extension}):
        raise RuntimeError("The fresh Flex consumer already has debug tooling before UXor setup")
    install = ("--apply", "--install", "--trust-project-code")
    first = operation(root, php, "setup", *install, timeout=600)
    if first["status"] != "completed":
        raise RuntimeError(f"Fresh Flex setup did not complete: {first['summary']}")
    run("composer.validate-flex-lock", [*composer, "validate", "--check-lock", "--no-check-publish", "--no-plugins", "--no-scripts"], root)
    transactions = [e["argv"] for e in first["data"]["executions"] if e["argv"][1:2] in (["require"], ["update"])]
    if len(transactions) != 1 or transactions[0][1] != "require":
        raise RuntimeError(f"Fresh setup must resolve development dependencies in one Composer require: {transactions}")
    if not {"symfony/debug-pack", extension} <= {arg.split(":", 1)[0] for arg in transactions[0]}:
        raise RuntimeError(f"First trusted setup must request the debug pack and Monolog Mate extension together: {transactions[0]}")
    installed = installed_packages()
    dev = json.loads((root / "composer.json").read_text())["require-dev"]
    if (installed | dev.keys()) & packs or not components.issubset(dev) or not (components | {extension}).issubset(installed):
        raise RuntimeError(f"Flex did not unpack the debug pack and its nested profiler pack, or setup omitted {extension}: {sorted(dev)}")
    check_pack_manifests(root, packs)
    recipes = json.loads((root / "symfony.lock").read_text())
    for bundle in ("symfony/debug-bundle", "symfony/monolog-bundle", "symfony/web-profiler-bundle"):
        recipe = recipes.get(bundle, {}).get("recipe", {})
        if not recipe.get("ref") or recipe.get("repo") != "github.com/symfony/recipes":
            raise RuntimeError(f"Flex did not apply the official {bundle} recipe")

    state_files = [root / name for name in ("composer.json", "composer.lock", "symfony.lock", "composer-updates")]
    before = [path.read_bytes() for path in state_files]
    repeated = operation(root, php, "setup", *install, timeout=600)
    if repeated["status"] != "completed":
        raise RuntimeError(f"Repeated Flex setup did not complete: {repeated['summary']}")
    if any(e["argv"][1:2] == ["require"] for e in repeated["data"]["executions"]):
        raise RuntimeError(f"Repeated trusted setup re-ran Composer require: {repeated['data']['executions']}")
    if [path.read_bytes() for path in state_files] != before:
        raise RuntimeError("Repeated trusted setup invoked Composer's resolver or changed the manifest, Composer lock, or recipe lock")
    environment = operation(root, php, "environment")["data"]
    for result in (first["data"], repeated["data"], environment):
        dependencies = {row["package"]: row for row in result["dependencies"]}
        for pack in packs:
            row = dependencies[pack]
            if not row["compatible"] or row["installed_version"] is not None or row["satisfied_by"] != "installed_components":
                raise RuntimeError(f"UXor misreported the unpacked {pack}: {row}")
        if not dependencies[extension]["compatible"]:
            raise RuntimeError(f"UXor failed to recognize the installed Monolog Mate extension: {dependencies[extension]}")
    if not environment["capabilities"]["profiler"]["installed"] or not environment["capabilities"]["monolog"]["installed"]:
        raise RuntimeError(f"Environment failed to recognize profiler or Monolog: {environment['capabilities']}")
    live = operation(root, php, "environment", "--probe", "--trust-project-code", allowed=(0, 2))["data"]["capabilities"]
    if live["debug"]["observed"] != "command_available" or live["profiler"]["observed"] != "service_available":
        raise RuntimeError(f"The installed console failed to observe the Flex debug command or profiler service: {live}")
    check_debug_capture(root, php)
    check_mate_init_with_stale_lock(root, php, install)
    print("Flex consumer: setup installed and unpacked the debug packs, repeated without Composer require, and the same request produced a profiler dump and a Mate-searchable application log.")


def check_mate_init_with_stale_lock(root: Path, php: str, install: tuple[str, ...]) -> None:
    manifest_path = root / "composer.json"
    manifest = json.loads(manifest_path.read_text())
    del manifest["extra"]["ai-mate"]
    # The application has all its development tools, but this new requirement has not been resolved.
    manifest["require"]["php"] = ">=8.4.1"
    manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
    (root / "mate/config.php").unlink()
    lock = root / "composer.lock"
    previous_lock = lock.read_bytes()
    operation(root, php, "setup", *install, timeout=600)
    result = json.loads(manifest_path.read_text())
    if "ai-mate" not in result["extra"] or not (root / "mate/config.php").is_file():
        raise RuntimeError("Setup did not restore the missing Mate configuration")
    if result["require"]["php"] != manifest["require"]["php"] or lock.read_bytes() != previous_lock:
        raise RuntimeError("Mate initialization changed the application's pending requirement or its existing stale lock")


def check_pack_manifests(root: Path, packs: set[str]) -> None:
    lock = json.loads((root / "resolved-before-flex.lock").read_text())
    resolved = {p["name"]: p for p in lock["packages"] + lock["packages-dev"] if p["name"] in packs}
    if resolved.keys() != packs:
        raise RuntimeError(f"Composer's pre-unpack lock is missing {sorted(packs - resolved.keys())}")
    resources = root / "vendor/xormania/uxor/packages/uxor/resources/symfony/packs"
    for name, package in resolved.items():
        manifest = json.loads((resources / name.split("/")[1] / "composer.json").read_text())
        for field in ("name", "type", "require", "require-dev"):
            if manifest.get(field) != package.get(field):
                source = package["source"]
                raise RuntimeError(f"UXor’s {name} manifest differs from resolved {package['version']} in {field}. "
                                   f"Refresh the manifest from {source['url']} at {source['reference']}.")


def check_debug_capture(root: Path, php: str) -> None:
    controller = root / "src/Controller/DebugProbe.php"
    controller.parent.mkdir(parents=True, exist_ok=True)
    controller.write_text(r"""<?php
namespace App\Controller;

use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class DebugProbe
{
    #[Route('/debug-probe/{marker}', methods: ['GET'])]
    public function __invoke(string $marker, LoggerInterface $logger): Response
    {
        dump($marker);
        $logger->info('Flex debug probe '.$marker, ['probe_id' => $marker]);
        return new Response($marker);
    }
}
""")
    probe = r"""
require 'vendor/autoload.php';
(new Symfony\Component\Dotenv\Dotenv())->bootEnv('.env');
$kernel = new App\Kernel('dev', true);
$marker = $argv[1];
$request = Symfony\Component\HttpFoundation\Request::create('/debug-probe/'.$marker);
$response = $kernel->handle($request);
$kernel->terminate($request, $response);
$token = $response->headers->get('X-Debug-Token');
$profile = $kernel->getContainer()->get('profiler')->loadProfileFromResponse($response);
if (200 !== $response->getStatusCode() || $marker !== $response->getContent() || !$token
    || $profile?->getToken() !== $token || $profile->getUrl() !== $request->getUri()) {
    throw new RuntimeException('The Flex application did not persist the profile for this request.');
}
foreach ($profile->getCollector('dump')->getDumps('html') as $dump) {
    if (str_contains($dump['data'], $marker)) {
        exit(0);
    }
}
throw new RuntimeException('The response profile has no matching DebugBundle dump.');
"""
    marker = "probe-" + secrets.token_hex(8)
    run("symfony.flex-debug-profile", [php, "-r", probe, marker], root)
    search = run("mate.flex-monolog-search", [php, "vendor/bin/mate", "tools:call", "monolog-search", "--term=" + marker,
                 "--environment=dev", "--channel=app", "--level=INFO", "--format=json"], root)
    entries = json.loads(search.stdout)["untrusted_data"]["entries"]
    if not any(entry["message"] == "Flex debug probe " + marker and entry["context"].get("probe_id") == marker
               for entry in entries):
        raise RuntimeError("Mate did not return the application log record for the profiled request")
