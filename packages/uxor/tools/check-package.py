#!/usr/bin/env python3
"""Check the repository archive that both delivery routes install: the Toolkit kit and the Composer package.

The UX Toolkit (ux:install) and Composer (xormania/uxor) install the same archive of this repository. The archive
is `git archive HEAD` at the repository root, what GitHub serves as both the Toolkit's download and Composer's
dist (committed files only: untracked local files cannot reach it), then checked against an explicit list that is kept
independent of .gitattributes on purpose: this script is the oracle for what the export rules must produce.
"""

from __future__ import annotations

import argparse
import copy
import fnmatch
import hashlib
import importlib.util
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
BROWSER_DIAGNOSTICS_MODULE = f"{PACKAGE_PATH}/resources/browser/diagnostics.mjs"
CONSUMER_SKILL_NAMES = ("build", "setup", "verify")
# The independent consumer application (a Symfony project that installs the archive as a dependency).
FIXTURE = PACKAGE / "dev/app"
# What the fixture renders in production. Fixture data: keep in step with the fixture's controller and templates.
FIXTURE_PAGES = {"/health": "uxor-ready", "/": "UXor development", "/_uxor_probe/production": '"value":"fixed"'}
SHORTCUT_PAGE = {"/panel": 'data-shortcut-owner="consumer"'}
MATE_PACKAGES = ("symfony/ai-mate", "symfony/ai-mate-composer-plugin", "symfony/ai-symfony-mate-extension")
MATE_BETA = "1.0.0-BETA1"

# Development-only content: no exported path may be inside these directories or be one of these files.
# Local tool output (vendor/, Playwright reports) is never committed, so `git archive` leaves it out; it is listed for
# archives built some other way (`composer archive` reads the working tree and not .gitignore).
DEVELOPMENT_DIRECTORIES = (
    ".git", ".github", ".phpunit.cache", "blob-report", "coverage", "demo", "docs", "node_modules",
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
    BROWSER_DIAGNOSTICS_MODULE,
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


def source_files() -> list[str]:
    """Files HEAD's tree holds: the archive is `git archive HEAD`, so an uncommitted file is not expected in it."""
    listed = subprocess.check_output(["git", "ls-tree", "-r", "-z", "--name-only", "HEAD"], cwd=ROOT)
    return [os.fsdecode(path) for path in listed.split(b"\0") if path]


def recipe_payload_files(manifests: list[str], tracked: list[str]) -> list[str]:
    expected: set[str] = set()
    for manifest in manifests:
        source = subprocess.check_output(["git", "show", f"HEAD:{manifest}"], cwd=ROOT)
        try:
            contents = json.loads(source)
        except (UnicodeError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Invalid JSON in {manifest}: {error}") from error
        copy_files = contents.get("copy-files", {}) if isinstance(contents, dict) else None
        if not isinstance(copy_files, dict):
            raise RuntimeError(f"{manifest}: copy-files must be an object")

        recipe = PurePosixPath(manifest).parent
        recipe_files = [file for file in tracked if file.startswith(f"{recipe}/")]
        for declared in copy_files:
            relative = PurePosixPath(declared)
            if (not declared or relative.is_absolute() or ".." in relative.parts
                    or "\\" in declared or re.match(r"^[A-Za-z]:", declared)):
                raise RuntimeError(f"{manifest}: invalid copy-files source {declared!r}")
            prefix = (recipe / relative).as_posix() + "/"
            # The Toolkit's Finder omits hidden entries when walking a directory.
            matches = [file for file in recipe_files if file.startswith(prefix)
                       and all(not part.startswith(".") for part in file[len(prefix):].split("/"))]
            if not matches:
                raise RuntimeError(f"{manifest}: copy-files source is not a tracked directory with payload: {declared}")
            expected.update(matches)
    return sorted(expected)


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

        tracked = source_files()
        recipe_manifests = [name for name in tracked if name.endswith("/manifest.json") and name.count("/") == 1]
        if not recipe_manifests:
            raise RuntimeError("No recipe manifests found in the source tree")
        package_prefixes = tuple(f"{PACKAGE_PATH}/{directory}/" for directory in PACKAGE_DIRECTORIES)
        package_files = [name for name in tracked if name.startswith(package_prefixes)]
        for required in (*REQUIRED_FILES, *recipe_manifests, *recipe_payload_files(recipe_manifests, tracked), *package_files):
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


def check_mate_versions(application: Path, version: str) -> None:
    installed = json.loads((application / "vendor/composer/installed.json").read_text())["packages"]
    actual = {
        package["name"]: package["version"].removeprefix("v")
        for package in installed if package["name"] in MATE_PACKAGES
    }
    if actual != dict.fromkeys(MATE_PACKAGES, version):
        raise RuntimeError(f"Expected Mate, its Composer plugin and Symfony extension at {version}, installed {actual}")
    print(f"Composer installed Mate, its Composer plugin and Symfony extension at {version}.")


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


def instruction_sections(content: str, block: str = "AI_MATE_INSTRUCTIONS") -> tuple[str, str, str]:
    start = f"<!-- BEGIN {block} -->"
    end = f"<!-- END {block} -->"
    if content.count(start) != 1 or content.count(end) != 1:
        raise RuntimeError("Initialization must produce exactly one managed instruction block")
    before, rest = content.split(start, 1)
    managed, after = rest.split(end, 1)
    return before, managed, after


def consumer_instruction_parts(content: str, block: str = "AI_MATE_INSTRUCTIONS") -> tuple[str, str]:
    before, _, after = instruction_sections(content, block)
    return before, after


def versioned_archive(source: Path, destination: Path, version: str) -> str:
    """Make two temporary package versions without changing the maintained checkout."""
    marker = f"UXor archive update acceptance: {version}"
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
            elif name == f"{PACKAGE_PATH}/INSTRUCTIONS.md" or fnmatch.fnmatch(name, f"{PACKAGE_PATH}/skills/*/SKILL.md"):
                content += f"\n\n<!-- {marker} -->\n".encode()
            entry = copy.copy(member)
            entry.size = len(content)
            output.addfile(entry, io.BytesIO(content))
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


def released_repository(temporary: Path) -> dict:
    """Use the original exported 0.3.2 files and Composer manifest, including in a shallow CI checkout."""
    revision = "8bea08b6e8d42a27df79b2cbbb41e9fb23729abb"  # commit tagged 0.3.2
    repository = ROOT
    if subprocess.run(["git", "cat-file", "-e", revision + "^{commit}"], cwd=repository,
                      stderr=subprocess.DEVNULL).returncode:
        repository = temporary / "release.git"
        execute(["git", "init", "--quiet", "--bare", str(repository)], temporary)
        execute(["git", "fetch", "--quiet", "--depth=1", "--no-tags", "https://github.com/xormania/uxor.git", revision], repository)
    archive = temporary / "uxor-0.3.2.tar"
    execute(["git", "archive", "--format=tar", f"--output={archive}", revision], repository)
    result = archive_repository(archive)
    result["package"]["version"] = "0.3.2"  # With a VCS repository Composer derives this from the tag.
    return result


def write_consumer_skills(application: Path) -> dict[str, bytes]:
    sources = {}
    for name in CONSUMER_SKILL_NAMES:
        path = application / "project-skills" / name / "SKILL.md"
        path.parent.mkdir(parents=True)
        sources[name] = (f"---\nname: {name}\ndescription: Application-specific {name} instructions.\n---\n"
                         f"Follow this application's {name} procedure.\n").encode()
        path.write_bytes(sources[name])
    return sources


def check_skills(application: Path, php: str, consumer_sources: dict[str, bytes], marker: str) -> None:
    listed = json.loads(execute([php, "vendor/bin/mate", "skills:list", "--format=json"], application, capture=True))
    expected = {("_custom", name) for name in consumer_sources} | {(PACKAGE_NAME, f"uxor-{name}") for name in CONSUMER_SKILL_NAMES}
    skills = [skill for skill in listed["skills"] if skill["package"] in ("_custom", PACKAGE_NAME)]
    if {(skill["package"], skill["original_name"]) for skill in skills} != expected:
        raise RuntimeError("Mate must list the three application skills and the three UXor skills under their respective owners")
    for skill in skills:
        name = skill["original_name"]
        installed = f"mate-{name}"
        if skill["installed_name"] != installed or not skill["enabled"] or skill["status"] != "ok":
            raise RuntimeError(f"Mate did not install a healthy, enabled {installed}")
        if skill["package"] == "_custom":
            source = consumer_sources[name]
            if (application / "project-skills" / name / "SKILL.md").read_bytes() != source:
                raise RuntimeError(f"Mate changed the application's {name} source")
        else:
            source = (application / "vendor" / PACKAGE_NAME / PACKAGE_PATH / "skills" / name / "SKILL.md").read_bytes()
            if marker.encode() not in source:
                raise RuntimeError(f"Packaged {name} has the wrong archive version")
        # Mate rewrites the frontmatter name in its installed copies.
        content = source.replace(f"\nname: {name}\n".encode(), f"\nname: {installed}\n".encode(), 1)
        for target in (".agents/skills", ".claude/skills"):
            if (application / target / installed / "SKILL.md").read_bytes() != content:
                raise RuntimeError(f"Mate installed the wrong content in {target}/{installed}")

    # The names in the installed instructions must refer agents to UXor skills.
    skill_names = {skill[key] for skill in skills for key in ("original_name", "installed_name")}
    for installed, targets in {
        "mate-uxor-build": {"mate-uxor-setup", "mate-uxor-verify"},
        "mate-uxor-setup": {"mate-uxor-verify"},
    }.items():
        guidance = (application / ".agents/skills" / installed / "SKILL.md").read_text()
        references = set(re.findall(r"`([^`\n]+)`", guidance)) & skill_names
        if references != targets:
            raise RuntimeError(f"{installed} refers to {sorted(references)}; expected {sorted(targets)}")


def check_install_handoff(application: Path, php: str, consumer_sources: dict[str, bytes], marker: str) -> None:
    """Read what a new agent sees without running init or discovery to repair the installation."""
    installed = application / "vendor" / PACKAGE_NAME
    mate = [php, "vendor/bin/mate"]
    instructions = (application / "AGENTS.md").read_text()
    _, managed, _ = instruction_sections(instructions)
    if "mate/AGENT_INSTRUCTIONS.md" not in managed or PACKAGE_NAME not in managed:
        raise RuntimeError("The project's agent instructions do not lead to the installed UXor extension")
    guidance = (application / "mate/AGENT_INSTRUCTIONS.md").read_text()
    if "Building with UXor" not in guidance or marker not in guidance:
        raise RuntimeError("Public setup did not publish this archive's UXor instructions")
    tools = json.loads(execute([*mate, "tools:list", "--format=json"], application, capture=True))
    for tool in ("uxor_catalog", "uxor_browser_diagnostics"):
        if tool not in tools["tools"]:
            raise RuntimeError(f"The installed tool was not discovered: {tool}")
    catalog = operation_result(execute([*mate, "tools:call", "uxor_catalog", "--query=modal",
                                        "--limit=1", "--format=json"], application, capture=True), "catalog")
    expected_inputs = json.loads((installed / PACKAGE_PATH / "resources/uxor/index.json").read_text())["source"]["inputs_sha256"]
    if catalog is None or catalog.get("status") != "completed" or not catalog.get("data", {}).get("items"):
        raise RuntimeError("The discovered catalog tool could not read its exported references")
    if catalog.get("reference", {}).get("uxor", {}).get("inputs_sha256") != expected_inputs:
        raise RuntimeError("Catalog results do not identify the packaged UXor references by their inputs' digest")
    reference = operation_result(execute([*mate, "resources:read", "uxor://reference/FOR-AGENTS.md",
                                          "--format=json"], application, capture=True), "reference")
    if reference is None or reference.get("status") != "completed" or not reference.get("data", {}).get("content"):
        raise RuntimeError("The installed reference resource could not be read through Mate")
    check_skills(application, php, consumer_sources, marker)
    print("Install: the project instructions lead to working UXor tools, references and three skills after public setup.")


def install_customized_shortcut(application: Path, php: str) -> Path:
    """Install a real recipe from the same dist through Toolkit, then use and customize the application's copy."""
    kit = application / "vendor/symfony/ux-toolkit/kits/uxor-lifecycle"
    shutil.copytree(application / "vendor" / PACKAGE_NAME, kit)
    try:
        execute([php, "bin/console", "ux:install", "kbd", f"--kit={kit.name}", "--no-interaction"], application)
    finally:
        shutil.rmtree(kit)
    component = application / "templates/components/Kbd.html.twig"
    source, count = re.subn(r"<kbd(?=[\s>])", '<kbd data-shortcut-owner="consumer"', component.read_text(), count=1)
    if not count:
        raise RuntimeError("The installed Kbd recipe has no keyboard-key element to customize")
    component.write_text(source)
    panel = application / "templates/panel.html.twig"
    panel.write_text(panel.read_text().replace("{% block body %}", "{% block body %}\n    <twig:Kbd>Ctrl</twig:Kbd>", 1))
    return component


def check_update(application: Path, archive: Path, old_marker: str,
                 new_marker: str, consumer_sources: dict[str, bytes], component: Path) -> None:
    instructions = application / "AGENTS.md"
    custom_instructions = consumer_instruction_parts(instructions.read_text())
    component_content = component.read_bytes()
    manifest = json.loads((application / "composer.json").read_text())
    manifest["repositories"] = [archive_repository(archive)]
    (application / "composer.json").write_text(json.dumps(manifest, indent=4) + "\n")
    execute([*composer_command(), "update", PACKAGE_NAME, "--prefer-dist",
             "--no-interaction", "--no-progress"], application)
    installed = application / "vendor" / PACKAGE_NAME
    metadata = json.loads((application / "vendor/composer/installed.json").read_text())
    installed_package = next(package for package in metadata["packages"] if package["name"] == PACKAGE_NAME)
    if installed.is_symlink() or installed_package["version"] != "0.0.1" or installed_package.get("installation-source") != "dist":
        raise RuntimeError("Composer update did not install the newer archive as a regular distribution")
    if installed_package.get("dist", {}).get("url") != archive.as_uri():
        raise RuntimeError("Installed package metadata does not identify the newer archive")
    if json.loads((installed / "composer.json").read_text()).get("version") != "0.0.1":
        raise RuntimeError("Updated package files do not match Composer's installed version")
    check_mate_versions(application, MATE_BETA)
    # The approved Beta1 plugin refreshes an initialized application's extensions on Composer update.
    php = os.environ.get("PHP_BIN", "php")
    check_skills(application, php, consumer_sources, new_marker)
    guidance = (application / "mate/AGENT_INSTRUCTIONS.md").read_text()
    if new_marker not in guidance or old_marker in guidance:
        raise RuntimeError("The updated package's Mate refresh did not replace old agent instructions")
    if consumer_instruction_parts(instructions.read_text()) != custom_instructions:
        raise RuntimeError("Composer update changed consumer-owned instructions")
    if component.read_bytes() != component_content:
        raise RuntimeError("Composer update changed an application-owned custom component")
    catalog = operation_result(execute([php, "vendor/bin/mate", "tools:call", "uxor_catalog",
                                       "--query=modal", "--limit=1", "--format=json"], application, capture=True), "catalog")
    if catalog is None or catalog.get("status") != "completed" or catalog.get("reference", {}).get("version") != "0.0.1":
        raise RuntimeError("The updated Mate tool does not report the newly installed package version")
    render_pages(application, php, "dev", SHORTCUT_PAGE)
    print("Update: Composer refreshed Mate guidance, skills and catalog version; the customized component still renders.")


def check_browser_diagnostics(application: Path, installed: Path, php: str, mate: list[str]) -> None:
    recorder = installed / BROWSER_DIAGNOSTICS_MODULE
    path = "var/browser-diagnostics/customer-workflow/browser-diagnostics.json"
    artifact = application / path
    artifact.parent.mkdir(parents=True, exist_ok=True)
    url = "http://127.0.0.1:8765/customers?q=Ada"
    responses = [
        {"requestId": 1, "token": "a1b2c3", "method": "GET", "url": url, "status": 200, "turboFrame": "customers"},
        {"requestId": 2, "token": "d4e5f6", "method": "GET", "url": url, "status": 200, "turboFrame": None},
    ]
    request_failures = [
        {"requestId": 2, "method": "GET", "url": url, "turboFrame": None, "error": "net::ERR_ABORTED"},
    ]
    page_errors = [{"name": "AbortError", "message": "signal is aborted without reason", "stack": None}]
    capture = """
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
const [recorder, path, scenario] = process.argv.slice(1);
const { recordBrowserDiagnostics } = await import(pathToFileURL(recorder).href);
const { responses, requestFailures, pageErrors } = JSON.parse(scenario);
const context = new EventEmitter();
const requests = new Map();
process.env.PROFILER_COLLECT = '1';
await recordBrowserDiagnostics({ context, baseURL: 'http://127.0.0.1:8765' }, async () => {
    for (const response of responses) {
        const request = {
            method: () => response.method,
            url: () => response.url,
            headers: () => ({ 'turbo-frame': response.turboFrame }),
            failure: () => ({ errorText: requestFailures.find(({ requestId }) => requestId === response.requestId)?.error }),
        };
        requests.set(response.requestId, request);
        context.emit('response', {
            headers: () => ({ 'x-debug-token': response.token }),
            url: request.url,
            request: () => request,
            status: () => response.status,
        });
    }
    for (const failure of requestFailures) context.emit('requestfailed', requests.get(failure.requestId));
    context.emit('weberror', { error: () => ({ name: 'Error', message: 'a'.repeat(1024 * 1024) }) });
    for (const error of pageErrors) context.emit('weberror', { error: () => error });
}, { outputPath: () => path, attach: async () => {} });
"""
    scenario = json.dumps({"responses": responses, "requestFailures": request_failures, "pageErrors": page_errors})
    execute(["node", "--input-type=module", "-e", capture, str(recorder), str(artifact), scenario], application)
    cli = json.loads(execute([php, "vendor/bin/uxor", "browser-diagnostics", path, "--format=json"],
                             application, capture=True))
    expected_responses = [response | {"profileUri": f"symfony-profiler://profile/{response['token']}"}
                          for response in responses]
    data = cli.get("data", {})
    if (cli.get("operation") != "browser-diagnostics" or cli.get("status") != "completed"
            or data.get("artifact") != path or data.get("version") != 1
            or data.get("responses") != expected_responses or data.get("requestFailures") != request_failures
            or data.get("pageErrors") != page_errors
            or data.get("dropped") != {"responses": 0, "requestFailures": 0, "pageErrors": 1}):
        raise RuntimeError("The installed CLI did not correlate the captured requests and report the dropped oversized error")
    payload = json.loads(execute([*mate, "tools:call", "uxor_browser_diagnostics", f"--path={path}", "--format=json"],
                                 application, capture=True))
    if payload.get("untrusted_data") != cli:
        raise RuntimeError("The installed Mate tool did not return the CLI's browser diagnostics as untrusted data")
    print("Verified the installed browser recorder import and request correlation through CLI and Mate.")


def check_consumer(archive: Path, temporary: Path, *, providers: bool = False) -> None:
    application = temporary / "consumer"
    tracked = execute(["git", "ls-files", "-z", "--", FIXTURE.relative_to(ROOT).as_posix()], ROOT, capture=True)
    fixture_files = list(filter(None, tracked.split("\0")))
    if not fixture_files:
        raise RuntimeError(f"The consumer fixture has no tracked files: {FIXTURE.relative_to(ROOT)}")
    for filename in fixture_files:
        source = ROOT / filename
        if source == FIXTURE / "mate/config.php":
            # The repository fixture uses its own runner. This application has never initialized Mate.
            continue
        destination = application / source.relative_to(FIXTURE)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    (application / "composer.lock").unlink(missing_ok=True)
    manifest_path = application / "composer.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("minimum-stability", "stable") != "stable":
        raise RuntimeError("The archive consumer must keep its stable Composer policy")
    first_archive = temporary / "uxor-0.0.0.tar"
    second_archive = temporary / "uxor-0.0.1.tar"
    old_marker = versioned_archive(archive, first_archive, "0.0.0")
    new_marker = versioned_archive(archive, second_archive, "0.0.1")
    manifest["repositories"] = [archive_repository(first_archive)]
    for name in (PACKAGE_NAME, *MATE_PACKAGES):
        del manifest["require-dev"][name]
    manifest["extra"]["ai-mate"]["skills"] = ["project-skills"]
    consumer_sources = write_consumer_skills(application)
    manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
    (application / ".env.local").write_text("APP_SECRET=" + secrets.token_hex(32) + "\n")
    custom_instructions = "# Consumer instructions\n\nThe adoption history for xormania/uxor belongs to this application.\n"
    instructions_path = application / "AGENTS.md"
    instructions_path.write_text(custom_instructions)
    (application / "CLAUDE.md").write_text("# Application conventions\n\nKeep the project's keyboard shortcut.\n")
    execute([*composer_command(), "require", "--dev", f"{PACKAGE_NAME}:0.0.*",
             *(f"{name}:{MATE_BETA}" for name in MATE_PACKAGES), "--prefer-dist", "--no-interaction", "--no-progress"], application)
    installed = application / "vendor" / PACKAGE_NAME
    if installed.is_symlink() or not installed.is_dir():
        raise RuntimeError("Independent consumer must install the archive, not a source symlink")
    check_mate_versions(application, MATE_BETA)
    execute(["vendor/bin/uxor-mago", "--help"], application)
    php = os.environ.get("PHP_BIN", "php")
    mate = [php, "vendor/bin/mate"]
    spec = importlib.util.spec_from_file_location("uxor_environment_acceptance", PACKAGE / "dev/environment_acceptance.py")
    environment = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(environment)
    # Exercise the public installed setup before manual initialization. Keep its
    # added dev dependencies in the update manifest instead of undoing setup.
    environment.setup(application, php)
    check_mate_versions(application, MATE_BETA)
    check_install_handoff(application, php, consumer_sources, old_marker)
    first_instructions = instructions_path.read_text()
    if not first_instructions.startswith(custom_instructions):
        raise RuntimeError("Mate initialization replaced the consumer's existing instructions")
    expected_instructions = first_instructions + "\nConsumer-owned trailing instructions.\n"
    instructions_path.write_text(expected_instructions)
    environment.repeat_setup(application, php)
    execute([*mate, "init", "--no-interaction"], application)
    if consumer_instruction_parts(instructions_path.read_text()) != consumer_instruction_parts(expected_instructions):
        raise RuntimeError("Repeated initialization changed consumer-owned instructions")

    check_browser_diagnostics(application, installed, php, mate)
    component = install_customized_shortcut(application, php)
    execute([php, "bin/console", "importmap:install", "--no-interaction"], application)
    render_pages(application, php, "dev", SHORTCUT_PAGE)
    check_update(application, second_archive, old_marker, new_marker, consumer_sources, component)
    environment.exercise(application, php)
    if providers:
        execute(["uv", "run", "--script", str(PACKAGE / "dev/check-mago.py"),
                 "--application", str(application), "--launcher", str(application / "vendor/bin/uxor-mago")], ROOT)

    execute([*composer_command(), "install", "--no-dev", "--prefer-dist", "--no-interaction", "--no-progress"], application)
    if installed.exists():
        raise RuntimeError("The development-only package remains installed after --no-dev")
    execute([php, "bin/console", "cache:clear", "--env=prod", "--no-debug", "--no-interaction"], application)
    render_pages(application, php, "prod", FIXTURE_PAGES | SHORTCUT_PAGE)
    print("Production: the deployed application renders its customized component with development dependencies omitted.")

    # Restore the dev installation from its lock before testing permanent removal.
    execute([*composer_command(), "install", "--prefer-dist", "--no-interaction", "--no-progress"], application)
    check_removal(application, php, component, consumer_sources, new_marker)
    candidate = temporary / "uxor-upgrade-candidate.tar"
    # A test-only version higher than 0.3.2 makes Composer perform an actual upgrade.
    candidate_marker = versioned_archive(archive, candidate, "999.0.0")
    check_mate_upgrade(candidate, temporary / "mate-upgrade", candidate_marker)
    check_mate_upgrade(candidate, temporary / "release-upgrade", candidate_marker, released_repository(temporary))


def render_pages(application: Path, php: str, environment: str, pages: dict[str, str]) -> None:
    render = r"""
require 'vendor/autoload.php';
(new Symfony\Component\Dotenv\Dotenv())->bootEnv('.env');
$kernel = new App\Kernel($argv[1], false);
foreach (json_decode($argv[2], true, flags: JSON_THROW_ON_ERROR) as $path => $marker) {
    $request = Symfony\Component\HttpFoundation\Request::create($path);
    $response = $kernel->handle($request);
    if (200 !== $response->getStatusCode() || !str_contains($response->getContent(), $marker)) {
        fwrite(STDERR, $argv[1].' consumer did not render '.$path.' with '.$marker.PHP_EOL);
        exit(1);
    }
    $kernel->terminate($request, $response);
}
$kernel->shutdown();
"""
    execute([php, "-r", render, environment, json.dumps(pages)], application)


def check_removal(application: Path, php: str, component: Path, consumer_sources: dict[str, bytes], marker: str) -> None:
    """Remove UXor from a working dev project whose own Composer requirements include Mate."""
    mate = [php, "vendor/bin/mate"]
    # Establish that the preceding no-dev deployment was restored before testing removal.
    catalog = operation_result(execute([*mate, "tools:call", "uxor_catalog", "--query=kbd", "--format=json"],
                                       application, capture=True), "catalog")
    if not catalog or catalog.get("reference", {}).get("version") != "0.0.1" or not catalog["data"]["items"]:
        raise RuntimeError("Removal must start with a working, updated UXor installation")
    check_skills(application, php, consumer_sources, marker)
    manifest_path = application / "composer.json"
    manifest = json.loads(manifest_path.read_text())
    expected_dev = manifest["require-dev"].copy()
    del expected_dev[PACKAGE_NAME]
    agent_files = {"AGENTS.md": "AI_MATE_INSTRUCTIONS", "CLAUDE.md": "AI_MATE_AGENTS_IMPORT"}
    owned_text = {name: consumer_instruction_parts((application / name).read_text(), block)
                  for name, block in agent_files.items()}
    retained = [component, application / "templates/panel.html.twig", application / "mate/config.php"]
    mirrors = [application / ".agents/skills", application / ".claude/skills"]
    for name in consumer_sources:
        retained.append(application / "project-skills" / name / "SKILL.md")
        retained.extend(directory / f"mate-{name}/SKILL.md" for directory in mirrors)
    before = {path: path.read_bytes() for path in retained}

    execute([*composer_command(), "remove", "--dev", PACKAGE_NAME, "--no-interaction", "--no-progress"], application)

    remaining = json.loads(manifest_path.read_text())
    if remaining["require"] != manifest["require"] or remaining["require-dev"] != expected_dev:
        raise RuntimeError("Removal changed unrelated application dependencies or retained UXor")
    lock = json.loads((application / "composer.lock").read_text())
    installed = json.loads((application / "vendor/composer/installed.json").read_text())
    for packages in (lock["packages"], lock["packages-dev"], installed["packages"]):
        if any(package["name"] == PACKAGE_NAME for package in packages):
            raise RuntimeError("Composer still records UXor after removal")
    for name in (f"vendor/{PACKAGE_NAME}", "vendor/bin/uxor", "vendor/bin/uxor-mago"):
        if os.path.lexists(application / name):
            raise RuntimeError(f"Removal left a package entry at {name}")

    tools = json.loads(execute([*mate, "tools:list", "--format=json"], application, capture=True))["tools"]
    if "symfony-service-detail" not in tools or any(name.startswith("uxor_") for name in tools):
        raise RuntimeError("The remaining Mate installation lost Symfony tools or still advertises UXor tools")
    skills = json.loads(execute([*mate, "skills:list", "--format=json"], application, capture=True))["skills"]
    if any(skill["package"] == PACKAGE_NAME for skill in skills):
        raise RuntimeError("Mate still advertises skills owned by the removed extension")
    for directory in mirrors:
        for name in CONSUMER_SKILL_NAMES:
            if os.path.lexists(directory / f"mate-uxor-{name}"):
                raise RuntimeError(f"Removal left a generated UXor skill in {directory.name}: {name}")
    _, managed, _ = instruction_sections((application / "AGENTS.md").read_text())
    if marker in (application / "mate/AGENT_INSTRUCTIONS.md").read_text() or PACKAGE_NAME in managed:
        raise RuntimeError("Agent instructions still advertise the removed archive")
    for name, block in agent_files.items():
        if consumer_instruction_parts((application / name).read_text(), block) != owned_text[name]:
            raise RuntimeError(f"Removing UXor changed application-owned instructions in {name}")
    for path, content in before.items():
        if path.read_bytes() != content:
            raise RuntimeError(f"Removing UXor changed application-owned content: {path.relative_to(application)}")
    render_pages(application, php, "dev", SHORTCUT_PAGE)
    print("Removal: the package, binaries and Mate integration are gone; application skills, instructions and the rendered recipe are preserved.")


def check_mate_upgrade(candidate: Path, application: Path, marker: str, previous_release: dict | None = None) -> None:
    """Use an initialized Mate 0.14 project, both with and without an existing UXor release."""
    application.mkdir()
    manifest = {
        "name": "example/mate-upgrade",
        "type": "project",
        "require-dev": dict.fromkeys(MATE_PACKAGES, "0.14.0"),
        "repositories": [archive_repository(candidate)],
        "config": {"allow-plugins": {"symfony/ai-mate-composer-plugin": True}},
    }
    if previous_release:
        manifest["require-dev"][PACKAGE_NAME] = "0.3.2"
        manifest["repositories"] = [previous_release]
    manifest_path = application / "composer.json"
    manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
    roots = {"AGENTS.md": "AI_MATE_INSTRUCTIONS", "CLAUDE.md": "AI_MATE_AGENTS_IMPORT"}
    for name in roots:
        (application / name).write_text(f"# Project rules for {name}\n")
    composer = composer_command()
    mate = [os.environ.get("PHP_BIN", "php"), "vendor/bin/mate"]
    options = ["--prefer-dist", "--no-interaction", "--no-progress"]
    execute([*composer, "install", *options], application)
    check_mate_versions(application, "0.14.0")
    execute([*mate, "init", "--no-interaction"], application)
    execute([*composer, "dump-autoload", "--no-interaction"], application)
    execute([*mate, "discover", "--no-interaction"], application)
    old_skills = json.loads(execute([*mate, "skills:list", "--format=json"], application, capture=True))["skills"]
    released = [skill for skill in old_skills if skill["package"] == PACKAGE_NAME]
    expected_names = set(CONSUMER_SKILL_NAMES) if previous_release else set()
    if {skill["original_name"] for skill in released} != expected_names:
        raise RuntimeError("The starting Mate project has the wrong set of UXor skills")
    old_targets = [application / target / skill["installed_name"] for target in (".agents/skills", ".claude/skills")
                   for skill in released]
    if not all((path / "SKILL.md").is_file() for path in old_targets):
        raise RuntimeError("The real 0.3.2 skill installation must exist before testing its upgrade")
    execute([*mate, "skills:override", "system-information", "--no-interaction"], application)
    override = application / "mate/skills/system-information/SKILL.md"
    override_marker = b"\nUse this application's system checks.\n"
    override.write_bytes(override.read_bytes() + override_marker)
    execute([*mate, "discover", "--no-interaction"], application)
    owned = {}
    for name, block in roots.items():
        path = application / name
        content = path.read_text()
        if not content.startswith(f"# Project rules for {name}\n"):
            raise RuntimeError(f"Mate initialization replaced {name}")
        path.write_text(content + f"\nTrailing project rules for {name}.\n")
        owned[name] = consumer_instruction_parts(path.read_text(), block)
    files = [override, *(application / target / "mate-system-information/SKILL.md"
                         for target in (".agents/skills", ".claude/skills"))]
    before = {path: path.read_bytes() for path in files}
    if any(override_marker not in content for content in before.values()):
        raise RuntimeError("The customized 0.14 skill was not installed before the upgrade")
    manifest = json.loads(manifest_path.read_text())
    manifest["repositories"] = [archive_repository(candidate)]
    manifest_path.write_text(json.dumps(manifest, indent=4) + "\n")
    execute([*composer, "require", "--dev", f"{PACKAGE_NAME}:999.0.0",
             *(f"{package}:{MATE_BETA}" for package in MATE_PACKAGES), *options], application)
    check_mate_versions(application, MATE_BETA)
    if json.loads(manifest_path.read_text()).get("minimum-stability", "stable") != "stable":
        raise RuntimeError("The package-specific beta requirements changed the consumer's stable policy")
    execute([*mate, "discover", "--no-interaction"], application)
    check_skills(application, mate[0], {}, marker)
    if any(os.path.lexists(path) for path in old_targets):
        raise RuntimeError("The upgrade left generated copies of the retired UXor skills")
    for name, block in roots.items():
        if consumer_instruction_parts((application / name).read_text(), block) != owned[name]:
            raise RuntimeError(f"Mate upgrade changed project-owned content in {name}")
    if not re.search(r"^@(?:\./)?AGENTS\.md$", (application / "CLAUDE.md").read_text(), re.MULTILINE):
        raise RuntimeError("The upgraded Mate did not retain the CLAUDE.md import of the project's AGENTS.md")
    if any(path.read_bytes() != content for path, content in before.items()):
        raise RuntimeError("Mate upgrade changed the project's skill override or its installed copies")
    skills = json.loads(execute([*mate, "skills:list", "--format=json"], application, capture=True))["skills"]
    if not any(skill["package"] == "symfony/ai-mate" and skill["original_name"] == "system-information"
               and skill["mode"] == "override" and skill["enabled"] and skill["status"] == "ok" for skill in skills):
        raise RuntimeError("The upgraded Mate did not retain the active system-information override")
    if marker not in (application / "mate/AGENT_INSTRUCTIONS.md").read_text():
        raise RuntimeError("The upgraded Mate did not publish the installed UXor guidance")
    if previous_release:
        print("Release upgrade: UXor 0.3.2 with Mate 0.14 upgraded to the candidate; retired generated skills were replaced, and project instructions and the override survived.")
    else:
        print("Existing Mate: installing UXor upgraded Mate while preserving project instructions and the skill override.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--consumer", action="store_true", help="Verify installation, update, no-dev deployment and removal in an independent Symfony application")
    parser.add_argument("--providers", action="store_true", help="Exercise the installed Mago and Serena providers inside the archive consumer (requires --consumer)")
    arguments = parser.parse_args()
    if arguments.providers and not arguments.consumer:
        parser.error("--providers requires --consumer")
    if arguments.consumer and not FIXTURE.is_dir():
        raise RuntimeError(f"--consumer needs the independent consumer fixture at {FIXTURE.relative_to(ROOT)}, "
                           "which arrives with the later dev job")
    temporary = Path(tempfile.mkdtemp(prefix="uxor-package-"))
    try:
        subprocess.run(
            ["git", "archive", "--format=tar", f"--output={temporary / 'uxor.tar'}", "HEAD"],
            cwd=ROOT,
            check=True,
        )
        archive = temporary / "uxor.tar"
        count = check_archive(archive)
        print(f"Repository archive verified for the kit and {PACKAGE_NAME}: {count} regular files; development files excluded.")
        if arguments.consumer:
            check_consumer(archive, temporary, providers=arguments.providers)
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
