"""Installed-archive acceptance for consumer setup, preparation and request diagnosis."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from lifecycle_events import operation as observe

# This standalone application installs the Symfony pack without Flex unpacking it.
NON_FLEX_DEBUG_PACKAGES = {
    "symfony/debug-pack", "symfony/debug-bundle", "symfony/monolog-bundle", "monolog/monolog",
    "symfony/profiler-pack", "symfony/web-profiler-bundle", "symfony/stopwatch",
    "symfony/ai-monolog-mate-extension",
}


def run(event: str, arguments: list[str], root: Path, *, timeout: float = 120, allowed=(0,),
        env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    with observe(event):
        result = subprocess.run(arguments, cwd=root, text=True, capture_output=True, timeout=timeout, env=env)
        if result.returncode not in allowed:
            raise RuntimeError(f"Consumer command failed ({result.returncode}): {arguments[:4]!r}\n"
                               + result.stderr[-4000:] + result.stdout[-4000:])
        return result


def install_kbd(root: Path, php: str) -> Path:
    """Install the packaged recipe through Toolkit's local kit registry, without fetching another release."""
    dist = root / "vendor/xormania/uxor"
    kit = root / "vendor/symfony/ux-toolkit/kits/uxor-lifecycle"
    shutil.copytree(dist, kit)
    try:
        run("toolkit.install-kbd", [php, "bin/console", "ux:install", "kbd", "--kit=" + kit.name, "--no-interaction"], root)
    finally:
        shutil.rmtree(kit)
    component = Path("templates/components/Kbd.html.twig")
    installed = root / component
    if installed.read_bytes() != (dist / "kbd" / component).read_bytes():
        raise RuntimeError("Toolkit did not install the Kbd template from the Composer distribution")
    return installed


def operation(root: Path, php: str, name: str, *arguments: str, allowed=(0,), timeout=120) -> dict:
    result = run("uxor." + name, [php, "vendor/bin/uxor", name, "--project-root=.", "--format=json", *arguments],
                 root, timeout=timeout, allowed=allowed)
    document = json.loads(result.stdout)
    if document.get("operation") != name or document.get("status") == "failed":
        raise RuntimeError(f"Consumer {name} did not complete its public operation contract: {document}")
    return document


def snapshot(root: Path) -> dict[str, str]:
    result = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if relative.parts[0] in {"vendor", "var"}:
            continue
        if path.is_symlink():
            result[relative.as_posix()] = "link:" + os.readlink(path)
        elif path.is_file():
            result[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


@observe("consumer.setup")
def setup(root: Path, php: str) -> None:
    """Configure the installed stack and preserve the application’s existing decisions."""
    profiler_policy = root / "config/packages/dev/application.yaml"
    profiler_policy.parent.mkdir(parents=True, exist_ok=True)
    profiler_policy.write_text("parameters:\n    env(APP_CAPTURE_REQUESTS): '0'\n"
                              "framework:\n    profiler:\n        collect: '%env(bool:APP_CAPTURE_REQUESTS)%'\n")
    before = snapshot(root)
    planned = operation(root, php, "setup", allowed=(0, 2))
    if planned["changes"] or snapshot(root) != before:
        raise RuntimeError("Setup planning changed the independent consumer")
    instructions = (root / "AGENTS.md").read_bytes()
    composer_state = {name: (root / name).read_bytes() for name in ("composer.json", "composer.lock")}
    installed = operation(root, php, "setup", "--apply", allowed=(0, 2))
    if installed["data"]["executions"] or any((root / name).read_bytes() != content for name, content in composer_state.items()):
        raise RuntimeError("Applying UXor configuration changed the installed Composer dependencies or ran a subprocess")
    for name in ("mago.toml", ".uxor/mago/config.toml", ".uxor/mago/worker.php",
                 ".uxor/browser.mjs", ".uxor/mcp.json",
                 "mate/config.php", "mate/extensions.php"):
        if not (root / name).is_file():
            raise RuntimeError("Installed setup omitted " + name)
    # The application controls collection; set its choice opposite to the helper's switch.
    check_application_profiler(root, php, False, APP_CAPTURE_REQUESTS="0", PROFILER_COLLECT="1")
    check_application_profiler(root, php, True, APP_CAPTURE_REQUESTS="1", PROFILER_COLLECT="0")
    profiler_policy.unlink()
    # Exercise setup's fallback independently of the fixture's own env-backed profiler setting.
    framework = root / "config/packages/framework.yaml"
    framework_config = framework.read_text()
    try:
        without_policy, count = re.subn(r"^when@dev:\n    framework:\n        profiler:.*\n", "", framework_config, flags=re.M)
        if count != 1:
            raise RuntimeError("Expected one dev profiler setting in the independent consumer fixture")
        framework.write_text(without_policy)
        check_application_profiler(root, php, False)
        check_application_profiler(root, php, True, PROFILER_COLLECT="1")
    finally:
        framework.write_text(framework_config)
    binding = json.loads((root / ".uxor/mcp.json").read_text())["mcpServers"]["uxor-mago"]
    if "--trust-project-code" in binding["args"] or "--write" in binding["args"]:
        raise RuntimeError("Installation consent leaked into the saved Serena binding")
    if installed["data"]["mcp_binding"]["requested_saved_project_trust"] is not False:
        raise RuntimeError("Installation consent was reported as a saved execution choice")
    if b"[extension-hosts." in (root / ".uxor/mago/config.toml").read_bytes():
        raise RuntimeError("Setup activated Symfony enrichment before preparing its container reference")
    if not (root / "AGENTS.md").read_bytes().startswith(instructions):
        raise RuntimeError("Setup replaced existing application instructions")
    if (root / ".mcp.json").exists() or (root / ".codex/config.toml").exists():
        raise RuntimeError("Setup selected a client when none was requested")
    packages = {item["name"]: item["version"].removeprefix("v")
                for item in json.loads((root / "vendor/composer/installed.json").read_text())["packages"]}
    if "symfony/flex" in packages:
        raise RuntimeError("The independent non-Flex consumer unexpectedly installed Flex")
    missing = (NON_FLEX_DEBUG_PACKAGES | {"symfony/maker-bundle"}) - packages.keys()
    if missing:
        raise RuntimeError("Composer did not install the full development tools: " + ", ".join(sorted(missing)))
    incompatible = [item["package"] for item in installed["data"]["dependencies"] if not item["compatible"]]
    if incompatible:
        raise RuntimeError("Initial setup still reports missing development dependencies: " + ", ".join(incompatible))
    for name, version in {"carthage-software/mago": "1.60.2", "byte-kitsune/mago-symfony-wiring": "1.3.0"}.items():
        if packages.get(name) != version:
            raise RuntimeError(f"Composer installed {name} at {packages.get(name)}, expected {version}")
    manifest = json.loads((root / "composer.json").read_text())
    if manifest.get("minimum-stability") != "beta" or manifest.get("prefer-stable") is not True:
        raise RuntimeError("The application's selected Composer stability settings changed")
    print("Installed setup: Composer supplied every dev dependency and initialized Mate; explicit setup configured the application and preserved its instructions.")


def check_application_profiler(root: Path, php: str, expected: bool, **switches: str) -> None:
    probe = r"""
require 'vendor/autoload.php';
(new Symfony\Component\Dotenv\Dotenv())->bootEnv('.env');
$kernel = new App\Kernel('dev', true);
$request = Symfony\Component\HttpFoundation\Request::create('/health');
$response = $kernel->handle($request);
$kernel->terminate($request, $response);
if (200 !== $response->getStatusCode()) {
    throw new RuntimeException('Consumer health check failed: '.$response->getStatusCode());
}
echo $response->headers->has('X-Debug-Token') ? 'collected' : 'disabled';
$kernel->shutdown();
"""
    env = dict(os.environ)
    env.pop("PROFILER_COLLECT", None)
    env.update(switches)
    result = subprocess.run([php, "-r", probe], cwd=root, text=True, capture_output=True, check=True, timeout=30, env=env)
    expected_state = "collected" if expected else "disabled"
    if result.stdout != expected_state:
        raise RuntimeError(f"Application profiler policy expected {expected_state}, got {result.stdout!r}")



@observe("consumer.repeat-setup")
def repeat_setup(root: Path, php: str) -> None:
    """An already initialized application can run setup again with its own Mate configuration."""
    config = root / "mate/config.php"
    with config.open("a") as stream:
        stream.write("\n// Application-owned Mate configuration.\n")
    expected_config = config.read_bytes()
    current = snapshot(root)
    repeated = operation(root, php, "setup", "--apply", allowed=(0, 2))
    if repeated["changes"] or snapshot(root) != current:
        raise RuntimeError("Repeated setup changed the configured consumer")
    if repeated["data"].get("mode") != "apply" or config.read_bytes() != expected_config:
        raise RuntimeError("Repeated setup did not retain the application's Mate configuration")


def check_preparation_readers(root: Path, php: str, *, fresh: bool) -> str | None:
    """Read the same installed project through the CLI, active worker and isolated provider verifier."""
    status = operation(root, php, "environment")["data"]["capabilities"]["symfony_wiring"]
    expected_exit = (0,) if fresh else (3,)
    worker = run("mago.check-preparation", [php, ".uxor/mago/worker.php", "--check"], root, allowed=expected_exit)
    observed = json.loads(worker.stdout)
    if (status["fresh"] is not fresh or observed["fresh"] is not fresh
            or not status["enabled"] or not observed["enabled"]
            or status["preparation_id"] != observed["preparationId"]):
        raise RuntimeError(f"Preparation readers disagree with fresh={fresh}: {status['state']}, {observed}")
    if fresh and (status["state"] != "ready" or not re.fullmatch(r"[a-f0-9]{32}", status["preparation_id"] or "")):
        raise RuntimeError("The installed package did not identify the ready preparation")

    verifier = "vendor/xormania/uxor/packages/uxor/resources/mago/serena/verify-preparation.php"
    result = run("provider.check-preparation", [php, "-n", verifier, str(root)], root, allowed=expected_exit)
    if not fresh:
        return None
    proof = json.loads(result.stdout)
    if proof["enabled"] is not True or proof["fresh"] is not True or not re.fullmatch(r"[a-f0-9]{64}", proof["generation"]):
        raise RuntimeError("The installed provider did not verify the prepared project")
    return proof["generation"]


def verify_profile(response: dict, profile: dict) -> None:
    """An independent oracle: only the observed HTTP response establishes identity."""
    expected = (response["token"], "GET", response["url"], response["status"])
    actual = (profile.get("token"), profile.get("method"), profile.get("url"), profile.get("status_code"))
    if actual != expected:
        raise AssertionError(f"The profile does not identify the exact request: {actual!r} != {expected!r}")


@observe("consumer.diagnose-and-repair")
def exercise(root: Path, php: str) -> None:
    """Build a consumer feature, preserve recorded evidence, diagnose and repair it."""
    run("symfony.make-controller", [php, "bin/console", "make:controller", "UxorAcceptanceController", "--no-interaction"], root)
    controller = root / "src/Controller/UxorAcceptanceController.php"
    if not controller.is_file() or "UxorAcceptanceController" not in controller.read_text():
        raise RuntimeError("The application's native Maker did not generate the requested controller")
    controller.write_text("""<?php

namespace App\\Controller;

use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\Routing\\Attribute\\Route;

final class UxorAcceptanceController
{
    public const CUSTOMIZATION = 'keep-application-value';

    #[Route('/_uxor_probe/{marker}', name: 'uxor_acceptance_probe', methods: ['GET'])]
    public function __invoke(string $marker): JsonResponse
    {
        return new JsonResponse(['marker' => $marker, 'value' => 'broken', 'custom' => self::CUSTOMIZATION]);
    }
}
""")
    secret_before = (root / ".env.local").read_bytes()
    run("symfony.warm-dev-cache", [php, "bin/console", "cache:warmup", "--env=dev", "--no-interaction"], root)
    run("mate.discover", [php, "vendor/bin/mate", "discover", "--no-interaction"], root)
    service = json.loads(run("mate.service-detail", [php, "vendor/bin/mate", "tools:call", "symfony-service-detail",
                              "--id=App\\Controller\\UxorAcceptanceController", "--format=json"], root).stdout)["untrusted_data"]
    if service.get("class") != "App\\Controller\\UxorAcceptanceController":
        raise RuntimeError("Mate did not observe the real compiled generated controller")
    with socket.socket() as reserve:
        reserve.bind(("127.0.0.1", 0))
        port = reserve.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    environment = dict(os.environ, APP_ENV="dev", APP_DEBUG="1", PROFILER_COLLECT="1")
    log_path = root.parent / "consumer-profile-server.log"
    with log_path.open("w") as log:
        # This owned development server must execute the just-edited source on every request.
        # CLI-server is an OPcache-supported SAPI independently of opcache.enable_cli.
        # GPCS keeps inherited environment variables out of $_ENV in the HTTP server.
        # Exercise the application's real process-environment opt-in under this PHP configuration.
        server = subprocess.Popen([php, "-d", "opcache.enable=0", "-d", "opcache.enable_cli=0",
                                   "-d", "variables_order=GPCS", "-S", f"127.0.0.1:{port}", "-t", "public", "public/index.php"],
                                  cwd=root, env=environment, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 30
            while True:
                if server.poll() is not None:
                    raise RuntimeError("The consumer HTTP server exited before readiness")
                try:
                    with urlopen(base + "/health", timeout=1) as response:
                        if response.status == 200:
                            break
                except (OSError, URLError):
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("The consumer HTTP server did not become ready")
                time.sleep(0.1)

            @observe("symfony.request")
            def request(marker: str) -> dict:
                url = base + "/_uxor_probe/" + marker
                try:
                    response = urlopen(url, timeout=15)
                except HTTPError as error:
                    response = error
                with response:
                    token = response.headers.get("X-Debug-Token")
                    if response.status != 200 or not re.fullmatch(r"[0-9a-f]{6}", token or ""):
                        token_state = "missing" if token is None else "present"
                        raise RuntimeError(f"GET {url} returned HTTP {response.status}, X-Debug-Token {token_state}; "
                                           "expected HTTP 200 and a six-digit hexadecimal profiler token")
                    return {"url": url, "status": response.status, "token": token, "body": json.load(response)}

            def profile(response: dict) -> dict:
                data = json.loads(run("mate.read-profile", [php, "vendor/bin/mate", "tools:call", "symfony-profiler-get",
                                       "--token=" + response["token"], "--format=json"], root).stdout)["untrusted_data"]
                verify_profile(response, data)
                return data

            first = request("first-" + secrets.token_hex(6))
            unrelated = request("unrelated-" + secrets.token_hex(6))
            if first["token"] == unrelated["token"]:
                raise RuntimeError("Distinct requests reused a profiler identity")
            first_profile, unrelated_profile = profile(first), profile(unrelated)
            if first["body"]["value"] != "broken" or first["body"]["custom"] != "keep-application-value":
                raise RuntimeError("The deliberate consumer fault or preserved customization was not exercised")
            try:
                verify_profile(first, unrelated_profile)
            except AssertionError:
                pass
            else:
                raise RuntimeError("The exact-request oracle accepted a substituted newer profile")

            profiler_root = root / "var/cache/dev/profiler"
            original_profiles = {path: hashlib.sha256(path.read_bytes()).hexdigest()
                                 for path in profiler_root.rglob("*") if path.is_file() and path.name != "index.csv"}
            if not original_profiles:
                raise RuntimeError("The real requests did not persist profiler data")
            prepared = operation(root, php, "prepare", "--trust-project-code")
            if prepared["data"].get("state") != "ready" or not prepared["data"].get("fresh"):
                raise RuntimeError("Preparation did not establish current Symfony semantics")
            for path, digest in original_profiles.items():
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise RuntimeError("Preparation deleted or changed recorded request-profile evidence")
            if profile(first) != first_profile:
                raise RuntimeError("Preparation changed the exact recorded request's profile")
            generation = check_preparation_readers(root, php, fresh=True)
            with (root / ".uxor/mago/.prepare.lock").open("rb") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                check_preparation_readers(root, php, fresh=False)
            if check_preparation_readers(root, php, fresh=True) != generation:
                raise RuntimeError("Observing a locked preparation changed the verified generation")

            controller.write_text(controller.read_text().replace("'value' => 'broken'", "'value' => 'fixed'", 1))
            check_preparation_readers(root, php, fresh=False)
            repaired = operation(root, php, "prepare", "--trust-project-code")
            if repaired["data"].get("state") != "ready" or not repaired["data"].get("fresh"):
                raise RuntimeError("Explicit preparation did not recover after source repair")
            if repaired["data"].get("preparation_id") == prepared["data"].get("preparation_id"):
                raise RuntimeError("Changed source reused the previous preparation identity")
            if check_preparation_readers(root, php, fresh=True) == generation:
                raise RuntimeError("The provider retained the previous generation after source repair")
            final = request("repaired-" + secrets.token_hex(6))
            profile(final)
            expected = {"marker": final["url"].rsplit("/", 1)[1], "value": "fixed",
                        "custom": "keep-application-value"}
            if final["body"] != expected:
                observed = {key: final["body"].get(key) for key in expected} if isinstance(final["body"], dict) else {
                    "type": type(final["body"]).__name__}
                raise RuntimeError("The repaired feature did not execute with its customization preserved: "
                                   + json.dumps({"status": final["status"], "expected": expected,
                                                 "observed": observed}, ensure_ascii=True)[:2000])
            if (root / ".env.local").read_bytes() != secret_before:
                raise RuntimeError("Development preparation changed application environment values")
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=10)
    print("Installed consumer: native generation, compiled service, exact real profiles, stale-input rejection and targeted repair passed.")


def detach(root: Path, php: str) -> None:
    """Adopt the public fixture and client, then detach while the installed CLI still exists."""
    client = root / ".mcp.json"
    neighbor = {"mcpServers": {"application": {"command": "project-service", "args": ["serve"]}}}
    client.write_text(json.dumps(neighbor))
    operation(root, php, "setup", "--apply", "--client=claude", allowed=(0, 2))
    if "uxor-mago" not in json.loads(client.read_text())["mcpServers"]:
        raise RuntimeError("Detach acceptance requires an adopted client binding")

    # The application keeps the import path from setup's README as part of its own tests.
    spec = root / "application.spec.mjs"
    source = """import { test as base, expect } from './.uxor/browser.mjs';
const test = base.extend({ localSetting: [null, { option: true }] });
test.use({ localSetting: 'application value' });
test('the application fixture still runs', ({ localSetting }) => {
    expect(localSetting).toBe('application value');
});
"""
    spec.write_text(source)
    prior = snapshot(root)
    preview = operation(root, php, "detach", allowed=(0, 2))
    if preview["changes"] or snapshot(root) != prior:
        raise RuntimeError("Previewing detach changed the installed consumer")
    operation(root, php, "detach", "--apply")
    if json.loads(client.read_text()) != neighbor or spec.read_text() != source:
        raise RuntimeError("Detach lost an application server, its test, or left the UXor binding active")
    again = operation(root, php, "detach", "--apply")
    if again["changes"]:
        raise RuntimeError("Repeating detach proposed or applied further changes")


def check_detached_tools(root: Path, php: str) -> None:
    """Exercise the remaining tools against the actual application after Composer removal."""
    # Install just the fixture's locked JS runner in the enclosing temporary directory. This test needs no browser.
    tools = Path(__file__).parent
    npm_root = root.parent
    for filename in ("package.json", "package-lock.json"):
        (npm_root / filename).write_bytes((tools / filename).read_bytes())
    run("browser.install-test-runner", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], npm_root)
    run("browser.detached-fixture", [str(npm_root / "node_modules/.bin/playwright"), "test",
                                     "application.spec.mjs", "--workers=1"], root)

    # A real in-file type finding proves native Mago loaded and analyzed the app without calling UXor's removed worker.
    source = root / "src/DetachedProbe.php"
    source.write_text("<?php\ndeclare(strict_types=1);\nnamespace App;\nfinal class DetachedProbe { public function value(): int { return 'wrong'; } }\n")
    result = run("mago.detached-native", [php, "vendor/bin/mago", "analyze", "--reporting-format", "json",
                                          "--reporting-target", "stdout", "--", "src/DetachedProbe.php"],
                 root, allowed=(1,), timeout=180)
    try:
        issues = json.loads(result.stdout)["issues"]
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Native Mago did not return a JSON report:\n{result.stderr[-2000:]}{result.stdout[-2000:]}") from error
    if not any(issue.get("code") == "invalid-return-statement" and
               any(note.get("kind") == "Primary" and
                   Path(note["span"]["file_id"]["name"]).name == source.name for note in issue.get("annotations", []))
               for issue in issues):
        raise RuntimeError("The remaining native Mago did not diagnose the application's marked return type")
