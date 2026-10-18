#!/usr/bin/env python3
"""Check the repository archive that both delivery routes install: the Toolkit kit and the Composer package.

The UX Toolkit (ux:install) and Composer (xormania/uxor) install the same archive of this repository. The archive
is built with `composer archive` at the repository root, then checked against an explicit list that is kept
independent of .gitattributes on purpose: this script is the oracle for what the export rules must produce.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "packages/uxor"
PACKAGE_PATH = PACKAGE.relative_to(ROOT).as_posix()
PACKAGE_NAME = "xormania/uxor"
# The independent consumer application (a Symfony project that installs the archive as a dependency).
FIXTURE = PACKAGE / "dev/app"
# What the fixture renders in production. Fixture data: keep in step with the fixture's controller and templates.
FIXTURE_PAGES = {"/health": "uxor-ready", "/": "UXor development"}

# Development-only content: no exported path may be inside these directories or be one of these files.
# `composer archive` exports untracked working-tree files too (it does not read .gitignore), so local tool output
# such as vendor/ or Playwright reports must be export-ignored as well.
DEVELOPMENT_DIRECTORIES = (
    ".git", ".github", ".phpunit.cache", ".xorder", "blob-report", "coverage", "demo", "docs", "node_modules",
    "playwright-report", "playwright-results", "test-results", "tests", "tools", "var", "vendor",
    f"{PACKAGE_PATH}/dev", f"{PACKAGE_PATH}/tests", f"{PACKAGE_PATH}/tools",
)
DEVELOPMENT_FILES = {
    ".editorconfig", ".gitattributes", ".gitignore", "AGENTS.md", "CHANGELOG.md", "CONTRIBUTING.md",
    "FOR-AGENTS.md", "SECURITY.md", "composer.lock", "llms.txt", "package-lock.json", "package.json",
    "playwright.config.ts", f"{PACKAGE_PATH}/phpunit.xml.dist",
}
# Every file the source tree holds under these package directories must be exported.
PACKAGE_DIRECTORIES = ("bin", "config", "resources", "skills", "src")
REQUIRED_FILES = (
    "composer.json", "LICENSE", "README.md", "manifest.json",
    f"{PACKAGE_PATH}/INSTRUCTIONS.md", f"{PACKAGE_PATH}/OPERATIONS.md", f"{PACKAGE_PATH}/README.md",
)
# Everything else is refused: a new development file is caught even when nobody thought to list it. An exported
# file is a root file below, a file of a recipe (a top-level directory whose manifest.json is exported) or one of
# the package's entries below.
ROOT_FILES = {"INSTALL.md", "LICENSE", "NOTICE", "README.md", "composer.json", "icon.svg", "kit.css", "kit.js",
              "manifest.json"}
PACKAGE_ENTRIES = {"INSTRUCTIONS.md", "OPERATIONS.md", "README.md", *PACKAGE_DIRECTORIES}


def composer_command() -> list[str]:
    """Run Composer; a PHAR or a PHP script (Composer's usual install) runs with PHP_BIN when it is set."""
    executable = os.environ.get("COMPOSER_BIN", "composer")
    resolved = shutil.which(executable) or executable
    if executable.endswith(".phar") or is_php_script(Path(resolved)):
        return [os.environ.get("PHP_BIN", "php"), resolved]
    return [executable]


def is_php_script(path: Path) -> bool:
    try:
        with path.open("rb") as script:
            first_line = script.readline(256)
    except OSError:
        return False
    return first_line.startswith(b"#!") and b"php" in first_line


def development_only(path: str) -> bool:
    parts = PurePosixPath(path).parts
    if path in DEVELOPMENT_FILES:
        return True
    if any(path == directory or path.startswith(directory + "/") for directory in DEVELOPMENT_DIRECTORIES):
        return True
    # Recipe tests (and any other top-level directory's tests) are repository-only.
    return len(parts) >= 2 and parts[1] == "tests"


def source_files(*pathspecs: str) -> list[str]:
    """Files the source tree holds: tracked, plus untracked files Git does not ignore (not yet committed)."""
    listed = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *pathspecs],
                            cwd=ROOT, check=True, text=True, stdout=subprocess.PIPE).stdout
    return sorted({name for name in listed.split("\0") if name and (ROOT / name).is_file()})


def as_list(value) -> list[str]:
    if value is None:
        return []
    return [value] if isinstance(value, str) else list(value)


def check_archive(archive: Path) -> int:
    with tarfile.open(archive, mode="r:") as package:
        paths: dict[str, tarfile.TarInfo] = {}
        for member in package.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise RuntimeError(f"Unsafe archive path: {member.name}")
            normalized = path.as_posix().removeprefix("./")
            if normalized == ".":
                continue
            if member.issym() or member.islnk():
                raise RuntimeError(f"Package must contain portable regular files: {normalized}")
            if not (member.isfile() or member.isdir()):
                raise RuntimeError(f"Package must contain only regular files and directories: {normalized}")
            if development_only(normalized):
                raise RuntimeError(f"Development-only content exported: {normalized}")
            paths[normalized] = member

        recipes = {name.split("/")[0] for name, entry in paths.items()
                   if entry.isfile() and len(PurePosixPath(name).parts) == 2 and name.endswith("/manifest.json")}
        package_parts = PurePosixPath(PACKAGE_PATH).parts
        for name, entry in paths.items():
            parts = PurePosixPath(name).parts
            if not entry.isfile() or name in ROOT_FILES or parts[0] in recipes:
                continue
            if parts[:len(package_parts)] == package_parts and len(parts) > len(package_parts) \
                    and parts[len(package_parts)] in PACKAGE_ENTRIES:
                continue
            raise RuntimeError(f"Exported file is neither part of the kit nor of the package: {name}")

        def exported_file(name: str) -> bool:
            return name in paths and paths[name].isfile()

        def exported_directory(name: str) -> bool:
            prefix = name.rstrip("/") + "/"
            return any(path.startswith(prefix) and entry.isfile() for path, entry in paths.items())

        recipe_manifests = [name for name in source_files("*/manifest.json") if len(PurePosixPath(name).parts) == 2]
        if not recipe_manifests:
            raise RuntimeError("No recipe manifests found in the source tree")
        package_files = source_files(*(f"{PACKAGE_PATH}/{directory}" for directory in PACKAGE_DIRECTORIES))
        for required in (*REQUIRED_FILES, *recipe_manifests, *package_files):
            if not exported_file(required):
                raise RuntimeError(f"Required file missing from the archive: {required}")

        manifest_file = package.extractfile(paths["composer.json"])
        if manifest_file is None:
            raise RuntimeError("Cannot read exported Composer metadata")
        manifest = json.load(manifest_file)
        if manifest.get("name") != PACKAGE_NAME:
            raise RuntimeError(f"Unexpected Composer package identity: {manifest.get('name')!r}")
        executables = as_list(manifest.get("bin"))
        if not executables:
            raise RuntimeError("The Composer package declares no executable")
        for executable in executables:
            if not exported_file(executable):
                raise RuntimeError(f"Declared Composer executable missing from the archive: {executable}")
            if not paths[executable].mode & 0o111:
                raise RuntimeError(f"Declared Composer executable is not executable in the archive: {executable}")
        namespaces = manifest.get("autoload", {}).get("psr-4", {})
        if not namespaces:
            raise RuntimeError("The Composer package declares no PSR-4 autoloading")
        for namespace_path in namespaces.values():
            for path in as_list(namespace_path):
                if not exported_directory(path):
                    raise RuntimeError(f"Autoload directory missing from the archive: {path}")
        mate = manifest.get("extra", {}).get("ai-mate")
        if not isinstance(mate, dict):
            raise RuntimeError("The Composer package declares no Mate extension (extra.ai-mate)")
        for key in ("scan-dirs", "includes", "instructions", "skills"):
            declared = as_list(mate.get(key))
            if not declared:
                raise RuntimeError(f"The Mate extension declares no {key}")
            for path in declared:
                if not (exported_file(path) or exported_directory(path)):
                    raise RuntimeError(f"Mate extension path ({key}) missing from the archive: {path}")

    return sum(entry.isfile() for entry in paths.values())


def execute(arguments: list[str], application: Path, *, capture: bool = False) -> str:
    result = subprocess.run(arguments, cwd=application, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout if capture else ""


def operation_result(payload, operation: str):
    """Find the public operation envelope inside Mate's transport encoding."""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return None
    if isinstance(payload, dict):
        if payload.get("operation") == operation:
            return payload
        children = payload.values()
    elif isinstance(payload, list):
        children = payload
    else:
        return None
    for child in children:
        result = operation_result(child, operation)
        if result is not None:
            return result
    return None


def consumer_instruction_parts(content: str) -> tuple[str, str]:
    start = "<!-- BEGIN AI_MATE_INSTRUCTIONS -->"
    end = "<!-- END AI_MATE_INSTRUCTIONS -->"
    if content.count(start) != 1 or content.count(end) != 1:
        raise RuntimeError("Initialization must produce exactly one managed instruction block")
    before, managed = content.split(start, 1)
    _, after = managed.split(end, 1)
    return before, after


def versioned_archive(source: Path, destination: Path, version: str) -> str:
    """Make two temporary package versions without changing the maintained checkout."""
    marker = f"UXor archive update acceptance: {version}"
    guidance = {f"{PACKAGE_PATH}/INSTRUCTIONS.md", f"{PACKAGE_PATH}/skills/build/SKILL.md"}
    changed: set[str] = set()
    with tarfile.open(source, mode="r:") as original, tarfile.open(destination, mode="w:") as output:
        for member in original.getmembers():
            exported = original.extractfile(member) if member.isfile() else None
            if exported is None:
                output.addfile(member)
                continue
            content = exported.read()
            name = PurePosixPath(member.name).as_posix().removeprefix("./")
            if name == "composer.json":
                manifest = json.loads(content)
                manifest["version"] = version
                content = (json.dumps(manifest, indent=4) + "\n").encode()
            elif name in guidance:
                content += f"\n\n<!-- {marker} -->\n".encode()
                changed.add(name)
            entry = copy.copy(member)
            entry.size = len(content)
            output.addfile(entry, io.BytesIO(content))
    if changed != guidance:
        raise RuntimeError(f"Versioned archive could not mark the packaged guidance: {sorted(guidance - changed)}")
    return marker


def archive_repository(archive: Path) -> dict:
    with tarfile.open(archive, mode="r:") as package:
        exported = package.extractfile("composer.json")
        if exported is None:
            raise RuntimeError("Archive Composer metadata cannot be read")
        dependency = json.load(exported)
    dependency["dist"] = {"type": "tar", "url": archive.as_uri(),
                          "shasum": hashlib.sha1(archive.read_bytes(), usedforsecurity=False).hexdigest()}
    return {"type": "package", "package": dependency}


def check_update(application: Path, manifest: dict, archive: Path, old_marker: str,
                 new_marker: str, build_skill: Path) -> None:
    instructions = application / "AGENTS.md"
    custom_instructions = consumer_instruction_parts(instructions.read_text())
    component = application / "templates/components/ConsumerOwned.html.twig"
    component.parent.mkdir(parents=True, exist_ok=True)
    component.write_text('{# Application-owned custom component. #}\n<span class="consumer-custom">Keep this behavior.</span>\n')
    component_content = component.read_bytes()
    manifest["repositories"] = [archive_repository(archive)]
    (application / "composer.json").write_text(json.dumps(manifest, indent=4) + "\n")
    execute([*composer_command(), "update", PACKAGE_NAME, "--prefer-dist",
             "--no-interaction", "--no-progress"], application)
    installed = application / "vendor" / PACKAGE_NAME
    metadata = json.loads((application / "vendor/composer/installed.json").read_text())
    companion = next(package for package in metadata["packages"] if package["name"] == PACKAGE_NAME)
    if installed.is_symlink() or companion["version"] != "0.0.1" or companion.get("installation-source") != "dist":
        raise RuntimeError("Composer update did not install the newer archive as a regular distribution")
    if companion.get("dist", {}).get("url") != archive.as_uri():
        raise RuntimeError("Installed package metadata does not identify the newer archive")
    if json.loads((installed / "composer.json").read_text()).get("version") != "0.0.1":
        raise RuntimeError("Updated package files do not match Composer's installed version")
    # The supported lifecycle refreshes Mate explicitly after Composer updates.
    # Mate 0.14's plugin can resolve Composer's own root when Composer runs as a PHAR.
    php = os.environ.get("PHP_BIN", "php")
    execute([php, "vendor/bin/mate", "discover", "--no-interaction"], application)
    for materialized in (application / "mate/AGENT_INSTRUCTIONS.md", build_skill):
        content = materialized.read_text()
        if new_marker not in content or old_marker in content:
            raise RuntimeError(f"The updated package's Mate refresh did not replace old guidance: {materialized.relative_to(application)}")
    if consumer_instruction_parts(instructions.read_text()) != custom_instructions:
        raise RuntimeError("Composer update changed consumer-owned instructions")
    if component.read_bytes() != component_content:
        raise RuntimeError("Composer update changed an application-owned custom component")
    catalog = operation_result(execute([php, "vendor/bin/mate", "tools:call", "uxor_catalog",
                                       "--query=modal", "--limit=1", "--format=json"], application, capture=True), "catalog")
    if catalog is None or catalog.get("status") != "completed" or catalog.get("reference", {}).get("version") != "0.0.1":
        raise RuntimeError("The updated Mate tool does not report the newly installed companion version")
    print("Composer update and native Mate refresh verified: newer archive installed; guidance and skills replaced; consumer instructions and custom component preserved.")


def check_consumer(archive: Path, temporary: Path) -> None:
    application = temporary / "consumer"
    tracked = execute(["git", "ls-files", "-z", "--", FIXTURE.relative_to(ROOT).as_posix()], ROOT, capture=True)
    fixture_files = list(filter(None, tracked.split("\0")))
    if not fixture_files:
        raise RuntimeError(f"The consumer fixture has no tracked files: {FIXTURE.relative_to(ROOT)}")
    for filename in fixture_files:
        source = ROOT / filename
        destination = application / source.relative_to(FIXTURE)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    (application / "composer.lock").unlink(missing_ok=True)
    manifest_path = application / "composer.json"
    manifest = json.loads(manifest_path.read_text())
    first_archive = temporary / "uxor-0.0.0.tar"
    second_archive = temporary / "uxor-0.0.1.tar"
    old_marker = versioned_archive(archive, first_archive, "0.0.0")
    new_marker = versioned_archive(archive, second_archive, "0.0.1")
    manifest["repositories"] = [archive_repository(first_archive)]
    manifest.setdefault("require-dev", {})[PACKAGE_NAME] = "0.0.*"
    manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
    (application / ".env.local").write_text("APP_SECRET=" + secrets.token_hex(32) + "\n")
    # The fixture's repository wrapper is replaced by the independent application's invocation.
    (application / "mate/config.php").write_text("""<?php
use Symfony\\Component\\DependencyInjection\\Loader\\Configurator\\ContainerConfigurator;
return static function (ContainerConfigurator $container): void {
    $container->parameters()->set('mate.invocation', 'vendor/bin/mate');
};
""")
    custom_instructions = "# Consumer instructions\n\nKeep application decisions here.\n"
    instructions_path = application / "AGENTS.md"
    instructions_path.write_text(custom_instructions)
    execute([*composer_command(), "install", "--prefer-dist", "--no-interaction", "--no-progress"], application)
    installed = application / "vendor" / PACKAGE_NAME
    if installed.is_symlink() or not installed.is_dir():
        raise RuntimeError("Independent consumer must install the archive, not a source symlink")
    php = os.environ.get("PHP_BIN", "php")
    mate = [php, "vendor/bin/mate"]
    execute([*mate, "init", "--no-interaction"], application)
    execute([*composer_command(), "dump-autoload", "--no-interaction"], application)
    execute([*mate, "discover", "--no-interaction"], application)
    first_instructions = instructions_path.read_text()
    if not first_instructions.startswith(custom_instructions):
        raise RuntimeError("Mate initialization replaced the consumer's existing instructions")
    expected_instructions = first_instructions + "\nConsumer-owned trailing instructions.\n"
    instructions_path.write_text(expected_instructions)
    execute([*mate, "init", "--no-interaction"], application)
    if consumer_instruction_parts(instructions_path.read_text()) != consumer_instruction_parts(expected_instructions):
        raise RuntimeError("Repeated initialization changed consumer-owned instructions")

    tools = json.loads(execute([*mate, "tools:list", "--format=json"], application, capture=True))
    if "uxor_catalog" not in tools.get("tools", {}):
        raise RuntimeError("The installed package's catalog tool was not discovered")
    catalog = operation_result(execute([*mate, "tools:call", "uxor_catalog", "--query=modal",
                                       "--limit=1", "--format=json"], application, capture=True), "catalog")
    expected_revision = json.loads((installed / PACKAGE_PATH / "resources/uxor/index.json").read_text())["source"]["revision"]
    if catalog is None or catalog.get("status") != "completed" or not catalog.get("data", {}).get("items"):
        raise RuntimeError("The discovered catalog tool could not read its exported references")
    if catalog.get("reference", {}).get("uxor", {}).get("revision") != expected_revision:
        raise RuntimeError("Catalog results do not identify the packaged UXor reference revision")
    reference = operation_result(execute([*mate, "resources:read", "uxor://reference/FOR-AGENTS.md",
                                         "--format=json"], application, capture=True), "reference")
    if reference is None or reference.get("status") != "completed" or not reference.get("data", {}).get("content"):
        raise RuntimeError("The installed reference resource could not be read through Mate")
    skills = json.loads(execute([*mate, "skills:list", "--format=json"], application, capture=True))
    companion_skills = [skill for skill in skills.get("skills", []) if skill.get("package") == PACKAGE_NAME]
    if {skill["original_name"] for skill in companion_skills} != {"setup", "build", "verify"}:
        raise RuntimeError("Mate did not discover all three packaged UXor skills")
    for skill in companion_skills:
        if not skill["enabled"] or not (application / ".agents/skills" / skill["installed_name"] / "SKILL.md").is_file():
            raise RuntimeError("A companion skill was discovered but not installed for agents")
    # Mate nests the package's headings, so look for the heading text of the packaged INSTRUCTIONS.md.
    if not re.search(r"Building with UXor\b", (application / "mate/AGENT_INSTRUCTIONS.md").read_text()):
        raise RuntimeError("Packaged UXor instructions were not materialized for agents")
    build = next(skill for skill in companion_skills if skill["original_name"] == "build")
    build_skill = application / ".agents/skills" / build["installed_name"] / "SKILL.md"
    for materialized in (application / "mate/AGENT_INSTRUCTIONS.md", build_skill):
        if old_marker not in materialized.read_text():
            raise RuntimeError("The first archive's agent guidance was not installed before the update")
    print("Independent archive consumer: Mate operation, reference, provenance, three skills and repeated initialization verified.")
    check_update(application, manifest, second_archive, old_marker, new_marker, build_skill)

    execute([php, "bin/console", "importmap:install", "--no-interaction"], application)
    execute([*composer_command(), "install", "--no-dev", "--prefer-dist", "--no-interaction", "--no-progress"], application)
    if installed.exists():
        raise RuntimeError("The development-only companion remains installed after --no-dev")
    execute([php, "bin/console", "cache:clear", "--env=prod", "--no-debug", "--no-interaction"], application)
    render = r"""
require 'vendor/autoload.php';
(new Symfony\Component\Dotenv\Dotenv())->bootEnv('.env');
$kernel = new App\Kernel('prod', false);
foreach (json_decode($argv[1], true, flags: JSON_THROW_ON_ERROR) as $path => $marker) {
    $request = Symfony\Component\HttpFoundation\Request::create($path);
    $response = $kernel->handle($request);
    if (200 !== $response->getStatusCode() || !str_contains($response->getContent(), $marker)) {
        fwrite(STDERR, 'Production consumer did not render '.$path.PHP_EOL);
        exit(1);
    }
    $kernel->terminate($request, $response);
}
$kernel->shutdown();
echo "Production consumer boot and Twig render passed without development dependencies.\n";
"""
    execute([php, "-r", render, json.dumps(FIXTURE_PAGES)], application)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--consumer", action="store_true", help="Install the archive in an independent Symfony application and verify Mate and no-dev runtime")
    arguments = parser.parse_args()
    if arguments.consumer and not FIXTURE.is_dir():
        raise RuntimeError(f"--consumer needs the independent consumer fixture at {FIXTURE.relative_to(ROOT)}, "
                           "which arrives with the later dev job")
    temporary = Path(tempfile.mkdtemp(prefix="uxor-package-"))
    try:
        subprocess.run(
            [*composer_command(), "archive", "--format=tar", "--file=uxor", f"--dir={temporary}"],
            cwd=ROOT,
            check=True,
        )
        archive = temporary / "uxor.tar"
        count = check_archive(archive)
        print(f"Repository archive verified for the kit and {PACKAGE_NAME}: {count} regular files; development files excluded.")
        if arguments.consumer:
            check_consumer(archive, temporary)
    except BaseException:
        print(f"Failed package check retained for inspection: {temporary}", file=sys.stderr)
        raise
    else:
        shutil.rmtree(temporary)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"Package check failed: {error}", file=sys.stderr)
        sys.exit(1)
