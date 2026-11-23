# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp==2.3.0"]
# ///
"""Run the Mago and Serena checks for a disposable consumer or the UXor checkout."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

LAUNCHER = Path(__file__).resolve().parents[1] / "bin/uxor-mago"
REPOSITORY = LAUNCHER.parents[3]


def analyze(launcher: Path, cwd: Path, *sources: str) -> tuple[int, dict[str, set[tuple[str, int]]]]:
    report = subprocess.run([launcher, "--trust-project-code", "analyze", "--reporting-format", "json", *sources], cwd=cwd,
                            capture_output=True, text=True, timeout=90)
    assert report.returncode in (0, 1), (report.returncode, report.stderr)
    diagnostics = {}
    for issue in json.loads(report.stdout)["issues"]:
        for annotation in issue["annotations"]:
            if annotation["kind"] == "Primary":
                span = annotation["span"]
                diagnostics.setdefault(span["file_id"]["name"], set()).add((issue["code"], span["start"]["line"]))
    return report.returncode, diagnostics


async def check_language_server(launcher: Path, cwd: Path, symbols: list[tuple[str, str, str]], source: str,
                                expected: set[tuple[str, int]]) -> None:
    params = StdioServerParameters(command=str(launcher), args=["--trust-project-code", "serena"], cwd=cwd,
                                  env={k: os.environ[k] for k in ("UXOR_MAGO_IMAGE", "DOCKER_HOST", "DOCKER_CONTEXT") if k in os.environ})
    async with stdio_client(params) as streams, ClientSession(*streams) as client:
        await client.initialize()

        async def call(tool, arguments):
            result = await client.call_tool(tool, arguments)
            text = "\n".join(item.text for item in result.content if item.type == "text")
            if result.is_error:
                raise RuntimeError(text)
            return text

        instructions = await call("initial_instructions", {})
        match = re.search(r"session(?:\s+id)?[^\n]{0,40}?[`'\"]([a-zA-Z0-9_-]+)[`'\"]", instructions, re.I)
        if not match:
            raise RuntimeError("Serena returned no REPL session")

        async def repl(code):
            return await call("serena_repl", {"session": match[1], "code": code})

        for path, name, body in symbols:
            result = json.loads(await repl(f"s.lsp.find_symbol({name!r}, relative_path={path!r}, include_body=True)"))
            assert any(symbol["relative_path"] == path and body in symbol["body"] for symbol in result), (path, name, result)
        result = json.loads(await repl(f"s.lsp.get_diagnostics_for_file({source!r})"))
        reported = {(issue["code"], issue["range"]["start"]["line"])
                    for groups in result.get(source, {}).values() for group in groups.values()
                    for issue in group if issue["source"] == "mago"}
        assert expected <= reported, (source, "missing from Serena", sorted(expected - reported))
        print(f"{source}: {len(expected)} distinct CLI diagnostic codes and lines matched Serena.")


async def check_consumer(launcher: Path = LAUNCHER):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "composer.json").write_text("{}\n")
        (root / "src").mkdir()
        missing = subprocess.run([launcher, "--trust-project-code", "check"], cwd=root, capture_output=True, text=True, timeout=60)
        assert missing.returncode != 0 and "mago.toml" in missing.stderr, missing
        (root / "mago.toml").write_text('version = "1.60.2"\nphp-version = "8.4"\n[source]\npaths = ["src"]\n')
        empty = subprocess.run([launcher, "--trust-project-code", "check"], cwd=root, capture_output=True, text=True, timeout=60)
        assert empty.returncode != 0 and "no files" in empty.stderr, empty
        (root / "src/Receipt.php").write_text(
            "<?php\n\ndeclare(strict_types=1);\n\nnamespace Demo;\n\nfinal class Receipt\n{\n"
            "    public function total(): int\n    {\n        return 3;\n    }\n}\n")
        (root / ".serena").mkdir()
        settings = root / ".serena/project.yml"
        existing = "project_name: consumer\nlanguage_servers: [php]\n"
        settings.write_text(existing)
        subprocess.run([launcher, "--trust-project-code", "check"], cwd=root, check=True, timeout=60)
        unformatted = root / "src/FormattingProbe.php"
        unformatted.write_text("<?php\nnamespace Demo;final class FormattingProbe{public function value():int{return 7;}}\n")
        before_format = unformatted.read_bytes()
        preview = subprocess.run([launcher, "--trust-project-code", "format", "src/FormattingProbe.php"], cwd=root,
                                 capture_output=True, text=True, timeout=60)
        assert preview.returncode == 1 and unformatted.read_bytes() == before_format, preview
        subprocess.run([launcher, "--trust-project-code", "--write", "format", "src/FormattingProbe.php"], cwd=root, check=True, timeout=60)
        assert unformatted.read_bytes() != before_format, "Explicit formatting did not change the unformatted source"
        subprocess.run([launcher, "--trust-project-code", "format", "src/FormattingProbe.php"], cwd=root, check=True, timeout=60)
        templates = root / "templates"
        templates.mkdir()
        twig = templates / "acceptance.html.twig"
        twig.write_text("{% if %}invalid{% endif %}\n")
        invalid_twig = subprocess.run([launcher, "--trust-project-code", "twig:lint", str(twig.relative_to(root))], cwd=root,
                                     capture_output=True, text=True, timeout=60)
        assert invalid_twig.returncode == 1, (invalid_twig.returncode, invalid_twig.stdout, invalid_twig.stderr)
        twig.write_text("<span>{{ 'ready' }}</span>\n")
        subprocess.run([launcher, "--trust-project-code", "twig:lint", str(twig.relative_to(root))], cwd=root, check=True, timeout=60)
        (root / "src/Broken.php").write_text('<?php\nfunction broken(): int { return "wrong"; }\n')
        status, by_file = analyze(launcher, root, "src/Broken.php")
        errors = by_file.get("src/Broken.php", set())
        assert status == 1 and ("invalid-return-statement", 1) in errors, (status, errors)
        async with asyncio.timeout(90):
            await check_language_server(launcher, root, [("src/Receipt.php", "total", "return 3;")], "src/Broken.php", errors)
        assert settings.read_text() == existing
    print("Passed Mago checks, CLI and Serena diagnostics, symbol lookup and consumer settings preservation.")


def check_source_selection(root: Path):
    # Give every path the same diagnostic, then let Mago select files using the real repository configuration.
    for relative in ("tools/mago", LAUNCHER.relative_to(REPOSITORY), "mago.toml"):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPOSITORY / relative, target)
    (root / "composer.json").write_text("{}\n")
    included = {"packages/uxor/bin/uxor", "demo/bin/console", "demo/importmap.php", "demo/mate/config.php",
                "demo/public/index.php", "demo/src/Probe.php", "demo/config/Probe.php", "demo/tests/Probe.php"}
    included.update(f"packages/uxor/{directory}/Probe.php" for directory in ("config", "src", "tests", "tools"))
    included.update(f"{manifest.parent.name}/src/Probe.php" for manifest in REPOSITORY.glob("*/manifest.json")
                    if (manifest.parent / "src").is_dir())
    excluded = {"vendor/Probe.php", "demo/vendor/Probe.php", "demo/var/Probe.php", "demo/config/reference.php",
                "demo/src/UXor/Probe.php", "packages/uxor/dev/app/src/Probe.php", "tools/tests/fixtures/Probe.php"}
    for index, relative in enumerate(sorted(included | excluded)):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'<?php\nfunction probe{index}(): int {{ return "wrong"; }}\n')
    status, by_file = analyze(root / "tools/mago", root)
    selected = {path for path, issues in by_file.items() if ("invalid-return-statement", 1) in issues}
    assert status == 1 and selected == included, (status, "missing", included - selected, "extra", selected - included)
    print(f"Mago analyzed {len(included)} authored source probes and excluded {len(excluded)} other paths.")


async def check_repository():
    with tempfile.TemporaryDirectory() as directory:
        check_source_selection(Path(directory))
    source = "packages/uxor/src/ReferenceBundle.php"
    symbols = [(source, "catalog", "function catalog("),
               ("markdown-editor/src/UXor/MarkdownEditor/MarkdownRenderer.php", "toHtml", "function toHtml("),
               ("demo/src/Kernel.php", "boot", "function boot(")]
    launcher = REPOSITORY / "tools/mago"
    nested = REPOSITORY / "demo"
    status, by_file = analyze(launcher, nested, source)
    errors = by_file.get(source, set())
    assert status == 0 or errors, (status, by_file)
    async with asyncio.timeout(90):
        await check_language_server(launcher, nested, symbols, source, errors)
    print("Passed repository package, recipe and demo symbol lookups.")



@asynccontextmanager
async def provider_session(launcher: Path, root: Path, *, write: bool = False):
    params = StdioServerParameters(command=str(launcher), args=["--trust-project-code", *(["--write"] if write else []), "serena"],
                                  cwd=root, env={name: os.environ[name] for name in
                                  ("UXOR_MAGO_IMAGE", "DOCKER_HOST", "DOCKER_CONTEXT") if name in os.environ})
    async with stdio_client(params) as streams, ClientSession(*streams) as client:
        await client.initialize()

        async def tool(name, arguments, *, allow_error=False):
            response = await client.call_tool(name, arguments)
            text = "\n".join(item.text for item in response.content if item.type == "text")
            if response.is_error and not allow_error:
                raise RuntimeError(text)
            return text

        instructions = await tool("initial_instructions", {})
        session = re.search(r"session(?:\s+id)?[^\n]{0,40}?[\x60'\"]([a-zA-Z0-9_-]+)[\x60'\"]", instructions, re.I)
        if not session:
            raise RuntimeError("Installed Serena returned no REPL session")

        async def repl(code, *, allow_error=False):
            return await tool("serena_repl", {"session": session[1], "code": code}, allow_error=allow_error)

        await repl("import json")
        yield repl


def references(graph: dict, owner: str, member: str) -> dict[str, set[str]]:
    if not isinstance(graph, dict) or not isinstance(graph.get("references"), list):
        raise AssertionError("The native graph is malformed")
    source = graph.get("source", {})
    if source.get("symbol", "").lower() != owner.lower() or source.get("member") != member:
        raise AssertionError("The native graph belongs to another source symbol")
    result = {}
    for edge in graph["references"]:
        target = edge.get("target", {}).get("symbol")
        if isinstance(target, str):
            result.setdefault(edge.get("kind", "").lower(), set()).add(target.lower())
    return result


async def check_installed(launcher: Path, root: Path) -> None:
    """Qualify the installed archive, real Symfony wiring and writable Serena together."""
    php = os.environ.get("PHP_BIN", "php")
    for arguments in (["analyze", "src/Controller/UxorAcceptanceController.php"],
                      ["--write", "analyze", "src/Controller/UxorAcceptanceController.php"],
                      ["--write", "serena"]):
        refused = subprocess.run([launcher, *arguments], cwd=root, capture_output=True, text=True, timeout=30)
        assert refused.returncode == 2 and "--trust-project-code" in refused.stderr, (refused.returncode, refused.stderr)
    directory = root / "src/UxorProviderAcceptance"
    if directory.exists():
        raise RuntimeError("The provider acceptance directory already belongs to the application")
    directory.mkdir()
    configuration = root / "config/packages/uxor_provider_acceptance.yaml"
    if configuration.exists():
        raise RuntimeError("The provider acceptance configuration already belongs to the application")
    owner = r"App\UxorProviderAcceptance\Consumer"
    interface = r"App\UxorProviderAcceptance\Contract"
    concrete = r"App\UxorProviderAcceptance\LocalGateway"
    replacement = r"App\UxorProviderAcceptance\AlternateGateway"
    source = "src/UxorProviderAcceptance/RepairProbe.php"
    graph_path = "src/UxorProviderAcceptance/Consumer.php"
    files = {
        "Contract.php": "<?php\nnamespace App\\UxorProviderAcceptance;\ninterface Contract { public function fee(): int; }\n",
        "LocalGateway.php": "<?php\nnamespace App\\UxorProviderAcceptance;\nfinal class LocalGateway implements Contract { public function fee(): int { return 3; } }\n",
        "AlternateGateway.php": "<?php\nnamespace App\\UxorProviderAcceptance;\nfinal class AlternateGateway implements Contract { public function fee(): int { return 5; } }\n",
        "Consumer.php": "<?php\nnamespace App\\UxorProviderAcceptance;\nfinal class Consumer { public function __construct(private Contract $gateway) {} public function total(): int { return $this->gateway->fee(); } }\n",
        "RepairProbe.php": "<?php\nnamespace App\\UxorProviderAcceptance;\nfinal class RepairProbe { public const CUSTOMIZATION = 'keep-project-value'; public function total(): int { return 'wrong'; } }\n",
    }
    for name, content in files.items():
        (directory / name).write_text(content)
    configuration.write_text("services:\n  " + interface + ":\n    alias: " + concrete + "\n    public: true\n")
    settings = root / ".serena/project.yml"
    settings.parent.mkdir(exist_ok=True)
    previous_settings = settings.read_bytes() if settings.exists() else None
    settings.write_text("project_name: application-owned\nlanguage_servers: [php]\n")
    saved_config = (root / ".uxor/mago/config.toml").read_bytes()

    def prepare():
        result = subprocess.run([php, "vendor/bin/uxor", "prepare", "--trust-project-code", "--format=json"],
                                cwd=root, text=True, capture_output=True, timeout=120)
        payload = json.loads(result.stdout)
        if result.returncode != 0 or payload.get("data", {}).get("state") != "ready":
            raise RuntimeError("Installed consumer preparation failed: " + result.stdout[-2000:] + result.stderr[-2000:])
        return payload["data"]["preparation_id"]

    def graph_code():
        return f"json.dumps(s.lsp.get_symbol_references({graph_path!r}, {owner!r}, '__construct'))"

    try:
        # Native control uses the public, inert configuration supplied by setup.
        native = subprocess.check_output([php, "-r",
            r"require 'vendor/autoload.php'; echo \Xormania\UXor\SymfonyPreparation::configurationFiles()['.uxor/mago/config.toml'];"],
            cwd=root, timeout=30)
        (root / ".uxor/mago/config.toml").write_bytes(native)
        async with asyncio.timeout(240), provider_session(launcher, root) as repl:
            native_graph = references(json.loads(await repl(graph_code())), owner, "__construct")
            assert interface.lower() in native_graph.get("signature", set()), native_graph
            assert concrete.lower() not in native_graph.get("body", set()), native_graph
            before = (root / source).read_bytes()
            denied = await repl(f"s.edit.replace_content({source!r}, \"return 'wrong';\", 'return 4;', 'literal')",
                                allow_error=True)
            assert (root / source).read_bytes() == before, "Read-only Serena changed application source"
            assert re.search(r"error|exception|read.only|disabled|no attribute", denied, re.I), denied

        generation = prepare()
        status, diagnostics = analyze(launcher, root, source)
        expected = diagnostics.get(source, set())
        assert status == 1 and any(code == "invalid-return-statement" for code, _ in expected), (status, diagnostics)
        async with asyncio.timeout(300), provider_session(launcher, root, write=True) as repl:
            enriched = references(json.loads(await repl(graph_code())), owner, "__construct")
            assert interface.lower() in enriched.get("signature", set()), enriched
            assert concrete.lower() in enriched.get("body", set()), enriched
            assert replacement.lower() not in enriched.get("body", set()), enriched
            observed = json.loads(await repl(f"s.lsp.find_symbol('RepairProbe', relative_path={source!r}, include_body=True)"))
            assert any("keep-project-value" in symbol.get("body", "") for symbol in observed), observed
            diagnostic_result = json.loads(await repl(f"s.lsp.get_diagnostics_for_file({source!r})"))
            before_codes = {(issue["code"], issue["range"]["start"]["line"])
                            for groups in diagnostic_result.get(source, {}).values() for group in groups.values()
                            for issue in group if issue["source"] == "mago"}
            assert expected <= before_codes, (expected, before_codes)
            await repl("uxor_acceptance_state = 41")
            await repl(f"s.edit.replace_content({source!r}, \"return 'wrong';\", 'return 4;', 'literal')")
            assert "return 4;" in (root / source).read_text(), "Writable Serena did not perform the requested repair"
            assert "keep-project-value" in (root / source).read_text(), "The repair replaced unrelated customization"
            configuration.write_text(configuration.read_text().replace(concrete, replacement))
            stale = await repl(graph_code(), allow_error=True)
            assert re.search(r"stale|prepare|preparation", stale, re.I), stale
            # Recompile independently while the same Serena session remains alive.
            # The next graph query must restart its old worker and observe the new binding.
            renewed = await asyncio.to_thread(prepare)
            assert renewed != generation, "Changed source and binding reused a preparation identity"
            refreshed = references(json.loads(await repl(graph_code())), owner, "__construct")
            assert replacement.lower() in refreshed.get("body", set()), refreshed
            assert concrete.lower() not in refreshed.get("body", set()), refreshed

        status, fixed = analyze(launcher, root, source)
        assert status == 0 and not fixed.get(source), (status, fixed)
        runtime = subprocess.check_output([php, "-r",
            r"require 'vendor/autoload.php'; echo json_encode([(new \App\UxorProviderAcceptance\RepairProbe())->total(), \App\UxorProviderAcceptance\RepairProbe::CUSTOMIZATION]);"],
            cwd=root, text=True, timeout=30)
        assert json.loads(runtime) == [4, "keep-project-value"], runtime
        async with asyncio.timeout(240), provider_session(launcher, root) as repl:
            assert (await repl("'uxor_acceptance_state' in globals()")).strip() == "False"
            result = json.loads(await repl(f"s.lsp.find_symbol('total', relative_path={source!r}, include_body=True)"))
            assert any("return 4;" in symbol.get("body", "") for symbol in result), result
        assert settings.read_text() == "project_name: application-owned\nlanguage_servers: [php]\n"
        print("Installed archive: native/enriched graph controls, current binding, writable repair, read-only refusal, reconnect and real PHP execution passed.")
    finally:
        shutil.rmtree(directory)
        configuration.unlink(missing_ok=True)
        (root / ".uxor/mago/config.toml").write_bytes(saved_config)
        if previous_settings is None:
            settings.unlink(missing_ok=True)
        else:
            settings.write_bytes(previous_settings)
        # The owned probes were removed; the consumer should leave with truthful fresh state.
        prepare()


async def check_archive_consumer(launcher: Path, root: Path):
    await check_consumer(launcher)
    await check_installed(launcher, root)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", action="store_true", help="check this checkout with tools/mago")
    parser.add_argument("--application", type=Path, help="Prepared disposable archive consumer")
    parser.add_argument("--launcher", type=Path, help="Installed consumer launcher; requires --application")
    arguments = parser.parse_args()
    if arguments.repository and arguments.application:
        parser.error("--repository and --application are separate scopes")
    if arguments.launcher and not arguments.application:
        parser.error("--launcher requires --application")
    launcher = REPOSITORY / "tools/mago" if arguments.repository else (
        arguments.launcher or arguments.application / "vendor/bin/uxor-mago" if arguments.application else LAUNCHER)
    launcher = launcher.resolve()
    for provider in ("cli", "serena"):
        version = subprocess.check_output([launcher, "version", provider], text=True, timeout=30).strip()
        assert version == "mago 1.60.2", (provider, version)
    if arguments.application:
        asyncio.run(check_archive_consumer(launcher, arguments.application.resolve()))
    else:
        asyncio.run(check_repository() if arguments.repository else check_consumer())
