"""Installed-archive acceptance for consumer setup, preparation and request diagnosis."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from lifecycle_events import operation as observe


def run(event: str, arguments: list[str], root: Path, *, timeout: float = 120, allowed=(0,)) -> subprocess.CompletedProcess:
    with observe(event):
        result = subprocess.run(arguments, cwd=root, text=True, capture_output=True, timeout=timeout)
        if result.returncode not in allowed:
            raise RuntimeError(f"Consumer command failed ({result.returncode}): {arguments[:4]!r}\n"
                               + result.stderr[-4000:] + result.stdout[-4000:])
        return result


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
    """Install through the public command, preserving application decisions."""
    before = snapshot(root)
    planned = operation(root, php, "setup", allowed=(0, 2))
    if planned["changes"] or snapshot(root) != before:
        raise RuntimeError("Setup planning changed the independent consumer")
    instructions = (root / "AGENTS.md").read_bytes()
    if (root / "mate/config.php").exists() or (root / "mate/extensions.php").exists():
        raise RuntimeError("The first installation needs a consumer where Mate has never been initialized")
    installed = operation(root, php, "setup", "--apply", "--install", "--trust-project-code",
                          allowed=(0, 2), timeout=900)
    if not installed["changes"]:
        raise RuntimeError("Fresh consumer setup reported no application configuration changes")
    for name in ("mago.toml", ".uxor/mago/config.toml", ".uxor/mago/worker.php",
                 "config/packages/dev/uxor.yaml", ".uxor/browser.mjs", ".uxor/mcp.json",
                 "mate/config.php", "mate/extensions.php"):
        if not (root / name).is_file():
            raise RuntimeError("Installed setup omitted " + name)
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
    for name in ("symfony/maker-bundle", "symfony/web-profiler-bundle"):
        if name not in packages:
            raise RuntimeError("Setup did not install its requested development package: " + name)
    for name, version in {"carthage-software/mago": "1.60.2", "byte-kitsune/mago-symfony-wiring": "1.3.0"}.items():
        if packages.get(name) != version:
            raise RuntimeError(f"Setup installed {name} at {packages.get(name)}, expected {version}")
    manifest = json.loads((root / "composer.json").read_text())
    if manifest.get("minimum-stability", "stable") != "stable":
        raise RuntimeError("Setup weakened the application's Composer stability policy")
    for name in ("carthage-software/mago", "byte-kitsune/mago-symfony-wiring"):
        if name not in manifest.get("require-dev", {}) or name in manifest.get("require", {}):
            raise RuntimeError("Setup did not keep development tools in require-dev: " + name)
    print("Installed setup: real Composer dev dependencies, first Mate initialization, separate saved execution permission and application instructions verified.")


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
    native = operation(root, php, "setup", "--apply", "--install", "--trust-project-code", allowed=(0, 2))
    if native["data"].get("mode") != "apply" or config.read_bytes() != expected_config:
        raise RuntimeError("Repeated native setup did not retain the application's Mate configuration")


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
    environment = dict(os.environ, APP_ENV="dev", APP_DEBUG="1")
    log_path = root.parent / "consumer-profile-server.log"
    with log_path.open("w") as log:
        # This owned development server must execute the just-edited source on every request.
        # CLI-server is an OPcache-supported SAPI independently of opcache.enable_cli.
        server = subprocess.Popen([php, "-d", "opcache.enable=0", "-d", "opcache.enable_cli=0",
                                   "-S", f"127.0.0.1:{port}", "-t", "public", "public/index.php"],
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
                    result = {"url": url, "status": response.status,
                              "token": response.headers.get("X-Debug-Token"), "body": json.loads(response.read())}
                if result["status"] != 200 or not re.fullmatch(r"[0-9a-f]{6}", result["token"] or ""):
                    raise RuntimeError("The setup consumer did not produce a real successful request/profile")
                return result

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
