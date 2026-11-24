"""Install UXor's development stack in an application configured by Symfony Flex recipes."""
from __future__ import annotations

from collections.abc import Callable
import json
import os
from pathlib import Path
import secrets
import shutil

from environment_acceptance import install_kbd, operation, run
from lifecycle_events import operation as observe


@observe("consumer.flex-debug-pack")
def check(root: Path, php: str, composer: list[str], candidate: dict, operation_result: Callable) -> None:
    root.mkdir()
    manifest = {
        "name": "consumer/flex-debug", "type": "project",
        "require": {"php": ">=8.4", "symfony/flex": "^2", "symfony/console": "8.1.*",
                    "symfony/dotenv": "8.1.*", "symfony/framework-bundle": "8.1.*",
                    "symfony/runtime": "8.1.*", "symfony/yaml": "8.1.*"},
        "minimum-stability": "beta", "prefer-stable": True,
        "repositories": [candidate], "autoload": {"psr-4": {"App\\": "src/"}},
        "config": {"allow-plugins": {"symfony/flex": True, "symfony/runtime": True,
                                     "symfony/ai-mate-composer-plugin": True, "xormania/uxor": True}},
        "extra": {"symfony": {"require": "8.1.*"}},
        "scripts": {
            "auto-scripts": {}, "post-install-cmd": ["@auto-scripts"], "post-update-cmd": ["@auto-scripts"],
            "pre-update-cmd": "@php -r \"file_put_contents('composer-updates', '+', FILE_APPEND);\"",
        },
    }
    (root / "composer.json").write_text(json.dumps(manifest, indent=4) + "\n")
    run("composer.install-flex", [*composer, "install", "--prefer-dist", "--no-interaction", "--no-progress"],
        root, timeout=600)
    package = "xormania/uxor"
    components = {"symfony/debug-bundle", "symfony/monolog-bundle", "symfony/web-profiler-bundle", "symfony/stopwatch"}
    extension = "symfony/ai-monolog-mate-extension"
    tools = components | {package, extension, "symfony/maker-bundle", "symfony/ux-toolkit", "symfony/http-client", "symfony/ai-mate",
                          "symfony/ai-mate-composer-plugin", "symfony/ai-symfony-mate-extension",
                          "carthage-software/mago", "byte-kitsune/mago-symfony-wiring"}

    def installed_packages() -> dict[str, str]:
        rows = json.loads((root / "vendor/composer/installed.json").read_text())["packages"]
        return {row["name"]: row["version"] for row in rows}

    if tools & installed_packages().keys():
        raise RuntimeError("The fresh Flex application already has UXor development tools")
    # A valid application file at an upcoming recipe's destination belongs to the application.
    owned = root / "config/packages/twig.yaml"
    owned_contents = b"parameters:\n    app.consumer_policy: 'owned by this application'\n"
    owned.write_bytes(owned_contents)
    updates = root / "composer-updates"
    baseline_updates = updates.read_bytes()
    run("composer.require-uxor", [*composer, "require", "--dev", package + ":" + candidate["package"]["version"],
        "--prefer-dist", "--no-interaction", "--no-progress"], root, timeout=600)

    # No UXor setup, Mate init or discovery between Composer and the agent's first real task.
    call = run("mate.first-catalog", [php, "vendor/bin/mate", "tools:call", "uxor_catalog",
               "--query=kbd", "--format=json"], root)
    catalog = operation_result(call.stdout, "catalog")
    if not catalog or catalog["status"] != "completed" or not any(
            item["name"] == "kbd" for item in catalog["data"]["items"]):
        raise RuntimeError("Requiring UXor did not make the installed Kbd recipe callable through Mate")
    install_kbd(root, php)
    if updates.read_bytes() != baseline_updates + b"+":
        raise RuntimeError("The first UXor install and tool calls ran additional Composer updates")
    installed = installed_packages()
    if missing := tools - installed.keys():
        raise RuntimeError("Requiring UXor left development tools missing: " + ", ".join(sorted(missing)))
    if not installed["symfony/ai-mate"].lstrip("v").startswith("1."):
        raise RuntimeError(f"The installed Mate version is outside the 1.x line: {installed['symfony/ai-mate']}")
    after = json.loads((root / "composer.json").read_text())
    if (set(after["require-dev"]) != {package} or after["require"] != manifest["require"]
            or after["minimum-stability"] != "beta" or not after["prefer-stable"]):
        raise RuntimeError("Installing UXor changed the application's runtime requirements, development roots or stability policy")
    if not (root / "mate/config.php").is_file():
        raise RuntimeError("Requiring UXor did not initialize the application's Mate configuration")
    run("composer.validate-flex-lock", [*composer, "validate", "--check-lock", "--no-check-publish", "--no-plugins", "--no-scripts"], root)
    check_pack_manifests(root)
    recipes = json.loads((root / "symfony.lock").read_text())
    for bundle in ("symfony/debug-bundle", "symfony/monolog-bundle", "symfony/web-profiler-bundle"):
        recipe = recipes.get(bundle, {}).get("recipe", {})
        if not recipe.get("ref") or recipe.get("repo") != "github.com/symfony/recipes":
            raise RuntimeError(f"Flex did not apply the official {bundle} recipe")

    check_production_install(root, php, composer, tools, "production")

    state_files = [root / name for name in ("composer.json", "composer.lock", "symfony.lock", "composer-updates")]
    before = [path.read_bytes() for path in state_files]
    environment = operation(root, php, "environment", allowed=(0, 2))["data"]
    repeated = operation(root, php, "setup", "--apply")
    if repeated["status"] != "completed":
        raise RuntimeError(f"Flex setup after installing UXor did not complete: {repeated['summary']}")
    if repeated["data"]["executions"] or [path.read_bytes() for path in state_files] != before:
        raise RuntimeError("Applying configuration spawned a child process or changed the installed manifest or locks")
    for result in (environment, repeated["data"]):
        incompatible = [row["package"] for row in result["dependencies"] if not row["compatible"]]
        if incompatible:
            raise RuntimeError("UXor did not recognize Composer's installed dependencies: " + ", ".join(incompatible))
    if not environment["capabilities"]["profiler"]["installed"] or not environment["capabilities"]["monolog"]["installed"]:
        raise RuntimeError(f"Environment failed to recognize profiler or Monolog: {environment['capabilities']}")
    live = operation(root, php, "environment", "--probe", "--trust-project-code", allowed=(0, 2))["data"]["capabilities"]
    if live["debug"]["observed"] != "command_available" or live["profiler"]["observed"] != "service_available":
        raise RuntimeError(f"The installed console failed to observe the Flex debug command or profiler service: {live}")
    check_debug_capture(root, php)
    check_monolog_ownership(root, php, composer, tools)
    if owned.read_bytes() != owned_contents:
        raise RuntimeError("Flex changed the application's existing config/packages/twig.yaml")
    check_pending_requirement_preserved(root, php, composer)
    run("composer.remove-flex-uxor", [*composer, "remove", "--dev", package, "--no-interaction", "--no-progress"], root, timeout=600)
    if not owned.is_file() or owned.read_bytes() != owned_contents:
        raise RuntimeError("Removing UXor deleted or changed the application-owned config/packages/twig.yaml")
    print("Flex consumer: Composer made the Mate catalog and Toolkit Kbd installation available immediately. "
          "The same request produced a profiler dump and a Mate-searchable log. A cold production deployment booted.")


def check_pack_manifests(root: Path) -> None:
    lock = json.loads((root / "composer.lock").read_text())
    resolved = {p["name"]: p for p in lock["packages"] + lock["packages-dev"]}
    resources = root / "vendor/xormania/uxor/packages/uxor/resources/symfony/packs"
    for name in ("symfony/debug-pack", "symfony/profiler-pack"):
        package = resolved[name]
        manifest = json.loads((resources / name.split("/")[1] / "composer.json").read_text())
        for field in ("name", "type", "require", "require-dev"):
            if manifest.get(field) != package.get(field):
                source = package["source"]
                raise RuntimeError(f"UXor’s {name} manifest differs from resolved {package['version']} in {field}. "
                                   f"Refresh the manifest from {source['url']} at {source['reference']}.")


def check_production_install(root: Path, php: str, composer: list[str], excluded: set[str], name: str) -> Path:
    production = root.with_name(root.name + "-" + name)
    shutil.copytree(root, production, ignore=shutil.ignore_patterns("vendor", "var"))
    run("composer.install-flex-no-dev", [*composer, "install", "--no-dev", "--prefer-dist", "--no-interaction", "--no-progress"],
        production, timeout=600, env={**os.environ, "APP_ENV": "prod", "APP_DEBUG": "0"})
    installed = json.loads((production / "vendor/composer/installed.json").read_text())["packages"]
    if unexpected := excluded & {package["name"] for package in installed}:
        raise RuntimeError("A cold production deployment installed development tools: " + ", ".join(sorted(unexpected)))
    run("symfony.flex-production-boot", [php, "bin/console", "about", "--env=prod", "--no-debug", "--no-interaction"], production)
    return production


def check_monolog_ownership(root: Path, php: str, composer: list[str], tools: set[str]) -> None:
    package = "symfony/monolog-bundle"

    def recipe_config() -> Path:
        recipe = json.loads((root / "symfony.lock").read_text())[package]
        for path in recipe["files"]:
            source = root / path
            if source.is_file() and source.read_bytes().startswith(b"monolog:\n"):
                return source
        raise RuntimeError("The Flex receipt does not identify the installed Monolog configuration")

    original = recipe_config()
    customized = original.read_bytes() + b"\n# Keep the application's logging configuration.\n"
    original.write_bytes(customized)
    run("composer.promote-monolog", [*composer, "require", package, "--prefer-dist", "--no-interaction", "--no-progress"], root, timeout=600)
    if recipe_config().read_bytes() != customized:
        raise RuntimeError("Adopting Monolog as an application dependency lost its customized Flex configuration")
    lock = json.loads((root / "composer.lock").read_text())
    if package not in {row["name"] for row in lock["packages"]}:
        raise RuntimeError("Composer did not promote Monolog into the runtime dependency graph")
    production = check_production_install(root, php, composer, tools - {package}, "with-monolog")
    native = run("symfony.promoted-monolog", [php, "bin/console", "debug:config", "monolog", "--format=json", "--env=prod", "--no-debug"], production)
    if not json.loads(native.stdout)["monolog"]["handlers"]:
        raise RuntimeError("The production kernel lost the Monolog handlers from the application's Flex recipe")

    # The package remains a development dependency through UXor after the root requirement is removed.
    run("composer.drop-monolog-requirement", [*composer, "remove", "--no-update", "--no-interaction", package], root)
    run("composer.demote-monolog", [*composer, "update", package, "--prefer-dist", "--no-interaction", "--no-progress"], root, timeout=600)
    lock = json.loads((root / "composer.lock").read_text())
    if package not in {row["name"] for row in lock["packages-dev"]} or recipe_config().read_bytes() != customized:
        raise RuntimeError("Returning Monolog to development lost its package or customized recipe")
    check_production_install(root, php, composer, tools, "after-demotion")


def check_pending_requirement_preserved(root: Path, php: str, composer: list[str]) -> None:
    manifest_path = root / "composer.json"
    manifest = json.loads(manifest_path.read_text())
    # A subsequent configuration run must leave resolution of an application-authored edit to Composer.
    manifest["require"]["php"] = ">=8.4.1"
    manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
    paths = [manifest_path, root / "composer.lock"]
    before = [path.read_bytes() for path in paths]
    result = operation(root, php, "setup", "--apply", "--install", "--trust-project-code", allowed=(0, 2))
    if result["data"]["executions"] or [path.read_bytes() for path in paths] != before:
        raise RuntimeError("Setup resolved or modified the application's pending Composer requirement")

    # Even when a Composer autoload refresh really reinitializes Mate, it cannot mark a pending requirement resolved.
    del manifest["extra"]["ai-mate"]
    manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
    config = root / "mate/config.php"
    config.unlink()
    run("composer.reinitialize-flex-mate", [*composer, "dump-autoload", "--no-interaction"], root)
    refreshed = json.loads(manifest_path.read_text())
    if (not config.is_file() or "ai-mate" not in refreshed["extra"] or refreshed["require"] != manifest["require"]
            or (root / "composer.lock").read_bytes() != before[1]):
        raise RuntimeError("Mate reinitialization changed the pending application requirement or its existing lock")


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
