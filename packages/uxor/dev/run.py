#!/usr/bin/env python3
"""Develop UXor's Composer package in its own Symfony consumer (native PHP or pinned xorder)."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

# Three roots: the repository (the Composer package xormania/uxor, mounted at /workspace in Docker), this
# development directory (locks, provider checkout, state) and the consumer application installed from the package.
ROOT = Path(__file__).resolve().parents[3]
DEV = Path(__file__).resolve().parent
APP = DEV / "app"
XORDER_REVISION = "97cb40b083f4ccf16148355c4e785ed0c6e4b00a"


def workspace_identity(root: Path) -> tuple[str, int]:
    identity = hashlib.sha256(str(root.resolve()).encode()).hexdigest()
    return "uxor-dev-" + identity[:12], 20000 + int(identity[:8], 16) % 10000


def locked_image(lock_path: Path) -> str:
    data = json.loads(lock_path.read_text())
    if len(data["resources"]) != 1:
        raise ValueError("Each development support lock must select exactly one service")
    return data["resources"][0]["identity"]


def environment(native: bool = False) -> dict[str, str]:
    env = dict(os.environ)
    _, port = workspace_identity(ROOT)
    selected_port = env.get("UXOR_DEV_HTTP_PORT", str(port))
    if not selected_port.isdigit() or not 1024 <= int(selected_port) <= 65535:
        raise ValueError("UXOR_DEV_HTTP_PORT must be a port between 1024 and 65535")
    env.update({
        "UXOR_DEV_NATIVE": "1" if native else "0",
        "UXOR_DEV_HTTP_PORT": selected_port,
        "UXOR_DEV_UID": str(os.getuid()),
        "UXOR_DEV_GID": str(os.getgid()),
        "UXOR_DEV_PHP_IMAGE": locked_image(DEV / "xorder-support.lock.json"),
    })
    return env


def run(argv: list[str], *, cwd: Path = ROOT, env: dict | None = None,
        capture: bool = False, stderr_only: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else (sys.stderr if stderr_only else None))


def require_docker() -> None:
    if not shutil.which("docker"):
        raise ValueError("Docker is unavailable; use --native with PHP >=8.4 and Composer 2, or provide a working Docker engine")
    run(["docker", "info", "--format", "{{.ServerVersion}}"], capture=True)
    run(["docker", "compose", "version", "--short"], capture=True)


def xorder_source() -> Path:
    """Use the external provider at one reviewed revision; never copy its implementation."""
    checkout = Path(os.environ.get("XORDER_DIR", DEV / ".tools/xorder")).resolve()
    if not checkout.exists():
        checkout.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "init", str(checkout)], stderr_only=True)
        run(["git", "-C", str(checkout), "remote", "add", "origin", "https://github.com/xormania/xorder.git"], stderr_only=True)
        run(["git", "-C", str(checkout), "fetch", "--depth=1", "origin", XORDER_REVISION], stderr_only=True)
        run(["git", "-C", str(checkout), "checkout", "--detach", "FETCH_HEAD"], stderr_only=True)
    revision = run(["git", "-C", str(checkout), "rev-parse", "HEAD"], capture=True).stdout.strip()
    if revision != XORDER_REVISION:
        raise ValueError(f"XORDER_DIR must select reviewed revision {XORDER_REVISION}; found {revision}. Use another checkout or update the project pin deliberately")
    if run(["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=all"], capture=True).stdout.strip():
        raise ValueError("The pinned xorder provider has tracked or untracked modifications; use a clean provider checkout")
    return checkout


def support_module(checkout: Path):
    sys.path.insert(0, str(checkout / "scripts"))
    spec = importlib.util.spec_from_file_location("uxor_xorder_support", checkout / "scripts/xorder/downstream.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def support_configuration(image: str, service: str = "php") -> dict:
    return {"services": {service: {"image": image}}}


@contextlib.contextmanager
def current_support(module, env: dict[str, str]):
    """Acquire a completed receipt before the pinned provider checks its clock.

    The pinned provider's direct online loader captures its check time before
    network acquisition, then rejects the freshly acquired receipt as future.
    Its supported fetch-then-check path preserves all freshness validation.
    """
    if env.get("XORDER_SUPPORT_POLICY_FILE"):
        # Explicit offline input retains its original freshness and ownership.
        yield env
        return
    state = DEV / ".state"
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="support-", dir=state) as temporary:
        snapshot = Path(temporary) / "policy.json"
        arguments = argparse.Namespace(
            policy_url=env.get("XORDER_SUPPORT_POLICY_URL") or module.DEFAULT_POLICY_URL,
            output=snapshot,
        )
        # fetch_cli validates canonical policy and writes its actual acquisition
        # receipt atomically. Private unique directories avoid concurrent refresh races.
        with contextlib.redirect_stdout(sys.stderr):
            module.fetch_cli(arguments)
        snapshot.chmod(0o600)
        checked_env = dict(env, XORDER_SUPPORT_POLICY_FILE=str(snapshot))
        # The URL selected acquisition; the completed receipt is now the single
        # policy input. Upstream correctly rejects two simultaneous inputs.
        checked_env.pop("XORDER_SUPPORT_POLICY_URL", None)
        yield checked_env


def prepare_image(env: dict[str, str], *, serena: bool = False):
    require_docker()
    provider = xorder_source()
    module = support_module(provider)
    lock = DEV / ("serena-support.lock.json" if serena else "xorder-support.lock.json")
    image = locked_image(lock)
    service = "serena" if serena else "php"
    support_env = dict(env, XORDER_SUPPORT_LOCK=str(lock))
    configuration = support_configuration(image, service)
    with current_support(module, support_env) as checked_env:
        with contextlib.redirect_stdout(sys.stderr):
            prepared = module.runner_precheck(ROOT, checked_env, configuration)
        # Pull only after the current support policy has accepted this selection.
        run(["docker", "pull", "--platform", "linux/amd64", image], env=env, stderr_only=serena)
        with contextlib.redirect_stdout(sys.stderr):
            module.runner_check(ROOT, checked_env, configuration=configuration, prepared=prepared)
    return provider, module, support_env


def compose(arguments: list[str], env: dict[str, str], *, capture: bool = False):
    project, _ = workspace_identity(ROOT)
    return run(["docker", "compose", "--project-directory", str(DEV),
                "--project-name", project, "--file", str(DEV / "compose.yaml"),
                *arguments], env=env, capture=capture)


def check_running_support(env: dict[str, str]) -> None:
    require_docker()
    module = support_module(xorder_source())
    ids = compose(["ps", "--quiet", "php"], env, capture=True).stdout.split()
    if not ids:
        raise ValueError("The development application is not running; run packages/uxor/dev/run.py up")
    containers = json.loads(run(["docker", "inspect", *ids], env=env, capture=True).stdout)
    with current_support(module, env) as checked_env:
        with contextlib.redirect_stdout(sys.stderr):
            module.runner_check(ROOT, checked_env, containers=containers)


def native_command(argv: list[str]) -> list[str]:
    if not argv:
        raise ValueError("exec requires a command after the subcommand")
    php = os.environ.get("PHP_BIN", "php")
    if argv[0] == "php":
        return [php, *argv[1:]]
    if argv[0] == "composer":
        composer = os.environ.get("COMPOSER_BIN", "composer")
        return ([php, composer] if composer.endswith(".phar") else [composer]) + argv[1:]
    if argv[0] in {"bin/console", "vendor/bin/mate"}:
        return [php, *argv]
    return argv


def execute(argv: list[str], env: dict[str, str], native: bool, *, cwd: Path = APP,
            running: bool = True):
    if native:
        return run(native_command(argv), cwd=cwd, env=env)
    relative = cwd.relative_to(ROOT)
    directory = str(Path("/workspace") / relative)
    if running:
        return compose(["exec", "--no-TTY", "--workdir", directory, "php", *argv], env)
    return compose(["run", "--rm", "--no-deps", "--workdir", directory, "php", *argv], env)


def ensure_secret() -> None:
    destination = APP / ".env.local"
    if not destination.exists():
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as output:
            output.write("APP_SECRET=" + secrets.token_hex(32) + "\n")


def prepare(env: dict[str, str], native: bool, *, assets: bool = True) -> None:
    if not native:
        prepare_image(env)
    ensure_secret()
    common = ["install", "--prefer-dist", "--no-interaction", "--no-progress"]
    execute(["composer", *common], env, native, cwd=ROOT, running=False)
    execute(["composer", *common], env, native, running=False)
    execute(["php", "bin/console", "cache:clear", "--no-interaction"], env, native, running=False)
    if assets:
        execute(["php", "bin/console", "importmap:install", "--no-interaction"], env, native, running=False)
    execute(["php", "vendor/bin/mate", "init", "--no-interaction"], env, native, running=False)
    execute(["composer", "dump-autoload", "--no-interaction"], env, native, running=False)
    execute(["php", "vendor/bin/mate", "discover", "--no-interaction"], env, native, running=False)


def readiness(env: dict[str, str]) -> None:
    url = "http://127.0.0.1:" + env["UXOR_DEV_HTTP_PORT"] + "/health"
    # A public proxy must not decide whether a loopback application is ready.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=5) as response:
        if response.status != 200 or response.read(256) != b"uxor-ready":
            raise ValueError("The development application's health response is not valid")
    print(json.dumps({"status": "ready", "application": str(APP), "url": url.removesuffix("/health")}))


def main(arguments=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true", help="Use host PHP/Composer; no Docker or provider checkout")
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("prepare", help="Install locked dependencies and initialize the consuming application")
    setup.add_argument("--no-assets", action="store_true", help="Skip importmap downloads for console-only work")
    for name, help_text in [
        ("up", "Prepare and serve through the pinned FrankenPHP image"),
        ("serve", "Serve with native PHP in the foreground"),
        ("status", "Inspect running application readiness without starting it"),
        ("check", "Check the Symfony container, Twig and Mate discovery"),
        ("down", "Stop this worktree's Docker stack; retain dependency caches"),
    ]:
        commands.add_parser(name, help=help_text)
    execute_parser = commands.add_parser("exec", help="Run a command in the consuming application")
    execute_parser.add_argument("arguments", nargs=argparse.REMAINDER)
    serena = commands.add_parser("serena", help="Start the external Serena v2 REPL MCP provider")
    serena.add_argument("--write", action="store_true", help="Allow source editing; separate concurrent work with worktrees")
    serena.add_argument("--prepare", action="store_true", help="Validate support and pull Serena, then exit before MCP startup")
    args = parser.parse_args(arguments)
    env = environment(args.native)

    if args.command == "prepare":
        prepare(env, args.native, assets=not args.no_assets)
    elif args.command == "up":
        if args.native:
            raise ValueError("Use --native prepare followed by --native serve; native serving runs in the foreground")
        prepare(env, False)
        compose(["up", "--detach", "--wait", "--wait-timeout", "90"], env)
        check_running_support(env)
        readiness(env)
    elif args.command == "serve":
        if not args.native:
            raise ValueError("serve is the native foreground command; use up for FrankenPHP")
        run(native_command(["php", "-S", "127.0.0.1:" + env["UXOR_DEV_HTTP_PORT"],
                            "-t", "public", "public/index.php"]), cwd=APP, env=env)
    elif args.command == "status":
        if not args.native:
            require_docker()
            compose(["ps"], env)
        readiness(env)
    elif args.command == "down":
        if args.native:
            raise ValueError("Stop the foreground native server with Ctrl-C")
        require_docker()
        compose(["down"], env)
    elif args.command in {"exec", "check"}:
        if not args.native:
            check_running_support(env)
        if args.command == "exec":
            execute(args.arguments, env, args.native)
        else:
            for command in [
                ["php", "bin/console", "lint:container", "--no-interaction"],
                ["php", "bin/console", "lint:twig", "templates", "--no-interaction"],
                ["php", "bin/console", "debug:container", "App\\Controller\\DevelopmentController", "--no-interaction"],
                ["php", "vendor/bin/mate", "tools:list", "--format=json"],
                ["php", "vendor/bin/mate", "tools:call", "symfony-service-detail", "--id=App\\Controller\\DevelopmentController", "--format=json"],
            ]:
                execute(command, env, args.native)
    elif args.command == "serena":
        if args.native:
            raise ValueError("The prepared Serena provider requires Docker; native PHP remains usable independently")
        if args.prepare:
            prepare_image(env, serena=True)
            return 0
        require_docker()
        provider = xorder_source()
        module = support_module(provider)
        image = locked_image(DEV / "serena-support.lock.json")
        support_env = dict(env, XORDER_SUPPORT_LOCK=str(DEV / "serena-support.lock.json"))
        with current_support(module, support_env) as checked_env:
            with contextlib.redirect_stdout(sys.stderr):
                module.runner_check(ROOT, checked_env, configuration=support_configuration(image, "serena"))
        command = [sys.executable, str(provider / "examples/serena/run.py"), str(ROOT),
                   "--project", ".", "--image", image, "--languages", "php_phpactor,typescript",
                   "--cache-dir", str(DEV / ".state/serena-index"),
                   "--write" if args.write else "--read-only"]
        os.execvpe(command[0], command, env)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError, urllib.error.URLError) as error:
        print("UXor development: " + str(error), file=sys.stderr)
        raise SystemExit(error.returncode if isinstance(error, subprocess.CalledProcessError) else 1)
