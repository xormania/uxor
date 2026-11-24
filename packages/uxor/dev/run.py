#!/usr/bin/env python3
"""Develop UXor's Composer package in its own Symfony consumer (native PHP or the checkout’s FrankenPHP image)."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

# Three roots: the repository (the Composer package xormania/uxor, mounted at /workspace in Docker), this
# development directory (image recipes and local state) and the consumer application installed from the package.
ROOT = Path(__file__).resolve().parents[3]
DEV = Path(__file__).resolve().parent
APP = DEV / "app"


def workspace_identity(root: Path) -> tuple[str, int]:
    identity = hashlib.sha256(str(root.resolve()).encode()).hexdigest()
    return "uxor-dev-" + identity[:12], 20000 + int(identity[:8], 16) % 10000


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
    })
    if not native:
        recipe = (DEV / "images/php/Dockerfile").read_bytes()
        image_hash = hashlib.sha256(recipe).hexdigest()[:16]
        env["UXOR_DEV_PHP_IMAGE"] = f"uxor-dev-php:{image_hash}-{os.getuid()}-{os.getgid()}"
    return env


def run(argv: list[str], *, cwd: Path = ROOT, env: dict | None = None,
        capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None)


def require_docker() -> None:
    if not shutil.which("docker"):
        raise ValueError("Docker is unavailable; use --native with PHP >=8.4 and Composer 2, or provide a working Docker engine")
    run(["docker", "info", "--format", "{{.ServerVersion}}"], capture=True)
    run(["docker", "compose", "version", "--short"], capture=True)


def prepare_image(env: dict[str, str]) -> None:
    require_docker()
    compose(["build", "php"], env)


def compose(arguments: list[str], env: dict[str, str], *, capture: bool = False):
    project, _ = workspace_identity(ROOT)
    return run(["docker", "compose", "--project-directory", str(DEV),
                "--project-name", project, "--file", str(DEV / "compose.yaml"),
                *arguments], env=env, capture=capture)


def check_running_image(env: dict[str, str]) -> None:
    require_docker()
    ids = compose(["ps", "--status", "running", "--quiet", "php"], env, capture=True).stdout.split()
    if not ids:
        raise ValueError("The development application is not running; run packages/uxor/dev/run.py up")
    image = env["UXOR_DEV_PHP_IMAGE"]
    try:
        expected = run(["docker", "image", "inspect", "--format", "{{.Id}}", image], env=env, capture=True).stdout.strip()
    except subprocess.CalledProcessError as error:
        raise ValueError("The selected development image is unavailable; run packages/uxor/dev/run.py up") from error
    actual = run(["docker", "inspect", "--format", "{{.Image}}", *ids], env=env, capture=True).stdout.split()
    if actual != [expected] * len(ids):
        raise ValueError("The running application uses a different build; run packages/uxor/dev/run.py up")


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
    parser.add_argument("--native", action="store_true", help="Use host PHP and Composer")
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
    serena = commands.add_parser("serena", help="Start the checkout’s Serena v2 REPL MCP provider")
    serena.add_argument("--write", action="store_true", help="Allow source editing; separate concurrent work with worktrees")
    serena.add_argument("--prepare", action="store_true", help="Build the checkout’s Serena image, then exit before MCP startup")
    args = parser.parse_args(arguments)
    env = environment(args.native)

    if args.command == "prepare":
        prepare(env, args.native, assets=not args.no_assets)
    elif args.command == "up":
        if args.native:
            raise ValueError("Use --native prepare followed by --native serve; native serving runs in the foreground")
        prepare(env, False)
        compose(["up", "--detach", "--wait", "--wait-timeout", "90"], env)
        check_running_image(env)
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
            check_running_image(env)
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
        command = [sys.executable, str(DEV / "serena.py")]
        if args.prepare:
            command.append("--prepare")
        if args.write:
            command.append("--write")
        os.execvpe(command[0], command, env)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError, urllib.error.URLError) as error:
        print("UXor development: " + str(error), file=sys.stderr)
        raise SystemExit(error.returncode if isinstance(error, subprocess.CalledProcessError) else 1)
