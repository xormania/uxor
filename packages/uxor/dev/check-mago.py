# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp==2.3.0"]
# ///
"""Run the Mago and Serena checks for a disposable consumer or the UXor checkout."""
import argparse
import asyncio
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
    report = subprocess.run([launcher, "analyze", "--reporting-format", "json", *sources], cwd=cwd,
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
    params = StdioServerParameters(command=str(launcher), args=["serena"], cwd=cwd,
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


async def check_consumer():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "composer.json").write_text("{}\n")
        (root / "src").mkdir()
        missing = subprocess.run([LAUNCHER, "check"], cwd=root, capture_output=True, text=True, timeout=60)
        assert missing.returncode != 0 and "mago.toml" in missing.stderr, missing
        (root / "mago.toml").write_text('version = "1.60.2"\nphp-version = "8.4"\n[source]\npaths = ["src"]\n')
        empty = subprocess.run([LAUNCHER, "check"], cwd=root, capture_output=True, text=True, timeout=60)
        assert empty.returncode != 0 and "no files" in empty.stderr, empty
        (root / "src/Receipt.php").write_text(
            "<?php\n\ndeclare(strict_types=1);\n\nnamespace Demo;\n\nfinal class Receipt\n{\n"
            "    public function total(): int\n    {\n        return 3;\n    }\n}\n")
        (root / ".serena").mkdir()
        settings = root / ".serena/project.yml"
        existing = "project_name: consumer\nlanguage_servers: [php]\n"
        settings.write_text(existing)
        subprocess.run([LAUNCHER, "check"], cwd=root, check=True, timeout=60)
        (root / "src/Broken.php").write_text('<?php\nfunction broken(): int { return "wrong"; }\n')
        status, by_file = analyze(LAUNCHER, root, "src/Broken.php")
        errors = by_file.get("src/Broken.php", set())
        assert status == 1 and ("invalid-return-statement", 1) in errors, (status, errors)
        async with asyncio.timeout(90):
            await check_language_server(LAUNCHER, root, [("src/Receipt.php", "total", "return 3;")], "src/Broken.php", errors)
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", action="store_true", help="check this checkout with tools/mago")
    repository = parser.parse_args().repository
    launcher = REPOSITORY / "tools/mago" if repository else LAUNCHER
    for provider in ("cli", "serena"):
        version = subprocess.check_output([launcher, "version", provider], text=True, timeout=30).strip()
        assert version == "mago 1.60.2", (provider, version)
    asyncio.run(check_repository() if repository else check_consumer())
