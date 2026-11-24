"""Exercise real Mate discovery and link ownership with nonstandard Composer directories."""
from collections.abc import Callable
import json
import os
from pathlib import Path

from environment_acceptance import run
from lifecycle_events import operation


VENDOR = "dependencies/php"
BIN = "tools/commands"
PACKAGE = "xormania/uxor"
OPTIONS = ["--prefer-dist", "--no-interaction", "--no-progress"]


def detach(root: Path, php: str, *arguments: str) -> dict:
    result = run("uxor.detach", [php, BIN + "/uxor", "detach", *arguments, "--format=json"], root, allowed=(0, 2))
    document = json.loads(result.stdout)
    if document.get("operation") != "detach" or document.get("status") not in ("completed", "incomplete"):
        raise RuntimeError(f"Could not inspect the relocated app's detach result: {document}")
    return document


@operation("consumer.custom-composer-paths")
def check(parent: Path, candidate: dict, php: str, composer: list[str],
          operation_result: Callable, check_application: Callable) -> None:
    parent.mkdir()
    root = parent / "fresh"
    root.mkdir()
    config = {"vendor-dir": VENDOR, "bin-dir": BIN, "allow-plugins": {
        PACKAGE: True, "symfony/ai-mate-composer-plugin": True, "symfony/runtime": True}}
    manifest = {"name": "consumer/custom-paths", "type": "project", "config": config,
                "repositories": [candidate], "minimum-stability": "beta", "prefer-stable": True}
    (root / "composer.json").write_text(json.dumps(manifest, indent=4) + "\n")
    instructions = root / "AGENTS.md"
    owned_text = "# Consumer-owned installation notes\n"
    instructions.write_text(owned_text)
    package = PACKAGE + ":" + candidate["package"]["version"]
    run("composer.require", [*composer, "require", "--dev", package, *OPTIONS], root, timeout=600)
    alias = root / "vendor"
    if not alias.is_symlink() or not alias.samefile(root / VENDOR):
        raise RuntimeError("The relocated install did not create a project-local link to its Composer dependencies")
    mate = [php, BIN + "/uxor", "mate"]
    catalog = run("mate.catalog", [*mate, "tools:call", "uxor_catalog", "--query=kbd", "--format=json"], root)
    result = operation_result(catalog.stdout, "catalog")
    if not result or not any(item["name"] == "kbd" for item in result["data"]["items"]):
        raise RuntimeError("Mate did not discover the installed Kbd recipe in the relocated consumer")
    check_application(root.resolve(), mate, VENDOR, BIN)
    if not (root / "mate/config.php").is_file() or not instructions.read_text().startswith(owned_text):
        raise RuntimeError("The relocated install did not initialize Mate or preserve the application's instructions")
    guide = (root / "mate/AGENT_INSTRUCTIONS.md").read_text()
    first_task = BIN + "/uxor mate tools:call uxor_catalog --query=kbd --format=json"
    if (BIN + "/uxor mate" not in instructions.read_text() or BIN + "/uxor mate tools:list" not in guide
            or "vendor/bin/mate tools:call uxor_catalog" in guide
            or first_task not in (root / ".uxor/README.md").read_text()):
        raise RuntimeError("The installed instructions direct this application's first Mate task to the wrong executable")
    # Reuse the solved dependency graph in the remaining fresh installs. Only the local path state changes.
    solved = {name: (root / name).read_bytes() for name in ("composer.json", "composer.lock")}
    run("composer.install", [*composer, "install", *OPTIONS], root)
    check_application(root.resolve(), mate, VENDOR, BIN)
    # Users can move a checkout or discard an ignored link while its ownership record survives.
    alias.unlink()
    run("composer.install", [*composer, "install", *OPTIONS], root)
    if not alias.is_symlink() or not alias.samefile(root / VENDOR):
        raise RuntimeError("Reinstalling did not restore the missing, previously managed compatibility link")
    detach(root, php)
    if not alias.is_symlink() or not alias.samefile(root / VENDOR):
        raise RuntimeError("Previewing detach changed the compatibility link")
    sentinel = root / VENDOR / "consumer-owned.txt"
    sentinel.write_text("keep the dependency directory\n")
    applied = detach(root, php, "--apply")
    if (applied["status"] != "completed" or os.path.lexists(alias)
            or sentinel.read_text() != "keep the dependency directory\n"):
        raise RuntimeError("Applying detach did not remove only UXor's compatibility link")
    detach(root, php, "--apply")

    def remove(app: Path) -> None:
        run("composer.remove", [*composer, "remove", "--dev", PACKAGE, "--no-interaction", "--no-progress"], app)

    def locked_application(name: str) -> Path:
        app = parent / name
        app.mkdir()
        for file, content in solved.items():
            (app / file).write_bytes(content)
        return app

    for collision in ("directory", "dangling", "foreign", "equivalent", "replacement", "same-target-replacement"):
        app = locked_application(collision)
        path = app / "vendor"
        outsider = app / "consumer-owned"
        outsider.mkdir()
        marker = outsider / "keep.txt"
        marker.write_bytes(b"application data")
        if collision == "directory":
            path.mkdir()
            marker = path / "keep.txt"
            marker.write_bytes(b"application data")
        elif collision == "dangling":
            path.symlink_to("does-not-exist")
        elif collision == "foreign":
            path.symlink_to("consumer-owned")
        elif collision == "equivalent":
            path.symlink_to(VENDOR)
        previous = path.lstat() if os.path.lexists(path) else None
        install = run("composer.install", [*composer, "install", *OPTIONS], app)
        if collision in ("replacement", "same-target-replacement"):
            if not path.is_symlink() or not path.samefile(app / VENDOR):
                raise RuntimeError("The replacement case must start with a link UXor created")
            path.rename(app / "prior-compatibility-link")
            path.symlink_to("consumer-owned" if collision == "replacement" else VENDOR)
            previous = path.lstat()
        elif not os.path.samestat(previous, path.lstat()):
            raise RuntimeError(f"Installing UXor replaced the application's {collision} vendor path")
        if collision == "equivalent":
            check_application(app.resolve(), mate, VENDOR, BIN)
        if collision in ("directory", "dangling", "foreign"):
            diagnostics = (install.stderr + install.stdout).lower().splitlines()
            if not any("mate" in line and "vendor" in line and "preserv" in line for line in diagnostics):
                raise RuntimeError(f"Composer did not explain the conflicting {collision} at vendor")
            cli = run("uxor.catalog", [php, BIN + "/uxor", "catalog", "--query=kbd", "--format=json"], app)
            if not any(item["name"] == "kbd" for item in json.loads(cli.stdout)["data"]["items"]):
                raise RuntimeError("The vendor collision disabled UXor tools that can operate independently of Mate")
        if collision == "same-target-replacement":
            remove(app)
        else:
            detach(app, php, "--apply")
        if (not os.path.lexists(path) or not os.path.samestat(previous, path.lstat())
                or marker.read_bytes() != b"application data"):
            raise RuntimeError(f"UXor changed or adopted the application's {collision} vendor path")

    check_occupied_commands(locked_application, php, composer, check_application)

    uninstall = locked_application("uninstall")
    run("composer.install", [*composer, "install", *OPTIONS], uninstall)
    if not (uninstall / "vendor").is_symlink():
        raise RuntimeError("Plain removal did not start with an owned compatibility link")
    remove(uninstall)
    if os.path.lexists(uninstall / "vendor"):
        raise RuntimeError("Removing the plugin left an owned compatibility link behind")
    production = locked_application("production")
    run("composer.install-no-dev", [*composer, "install", "--no-dev", *OPTIONS], production)
    if os.path.lexists(production / "vendor"):
        raise RuntimeError("A production install created a Mate compatibility link")


def check_occupied_commands(locked_application: Callable, php: str, composer: list[str], check_application: Callable) -> None:
    for name, vendor in (("uxor-mate", VENDOR), ("mate", "vendor")):
        app = locked_application("occupied-" + name)
        manifest_file = app / "composer.json"
        manifest = json.loads(manifest_file.read_text())
        manifest["config"]["vendor-dir"] = vendor
        manifest_file.write_text(json.dumps(manifest, indent=4) + "\n")
        executable = app / BIN / name
        executable.parent.mkdir(parents=True)
        # Ordinary, non-executable application data. It must remain byte-for-byte intact.
        contents = "This file belongs to the existing application's tool directory."
        executable.write_text(contents)
        original = executable.lstat()
        install = run("composer.install", [*composer, "install", "--verbose", *OPTIONS], app)
        diagnostic = install.stdout + install.stderr
        if (contents in diagnostic or not os.path.samestat(original, executable.lstat())
                or executable.read_text() != contents):
            raise RuntimeError(f"Composer onboarding used or replaced the application's {name} file")
        if name == "mate" and not any("uxor:" in line.lower() and "mate" in line.lower()
                                      and "uxor mate" in line for line in diagnostic.splitlines()):
            raise RuntimeError(f"UXor did not explain how to use Mate with an occupied {BIN}/{name}")
        check_application(app.resolve(), [php, BIN + "/uxor", "mate"], vendor, BIN)
        cli = run("uxor.catalog", [php, BIN + "/uxor", "catalog", "--query=kbd", "--format=json"], app)
        if not any(item["name"] == "kbd" for item in json.loads(cli.stdout)["data"]["items"]):
            raise RuntimeError(f"An occupied {name} command disabled the independent UXor catalog")
        if name == "uxor-mate":
            run("composer.remove", [*composer, "remove", "--dev", PACKAGE, "--no-interaction", "--no-progress"], app)
            if not executable.is_file() or executable.read_text() != contents:
                raise RuntimeError("Composer removal changed the application's original uxor-mate file")
