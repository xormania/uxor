# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp==2.3.0"]
# ///
"""Run the public launcher against a real provider and a disposable Composer app."""
import asyncio
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

LAUNCHER = Path(__file__).resolve().parents[1] / "bin/uxor-mago"


async def check_language_server(root: Path) -> None:
    params = StdioServerParameters(command=str(LAUNCHER), args=["--project-root", str(root), "serena"],
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

        symbols = json.loads(await repl("s.lsp.find_symbol('total', relative_path='src/Receipt.php', include_body=True)"))
        assert any(symbol["relative_path"] == "src/Receipt.php" and "return 3;" in symbol["body"] for symbol in symbols), symbols
        result = json.loads(await repl("s.lsp.get_diagnostics_for_file('src/Broken.php')"))
        errors = result["src/Broken.php"]["Error"]
        assert any(issue["source"] == "mago" and issue["code"] == "invalid-return-statement"
                   for group in errors.values() for issue in group), result


async def main():
    for provider in ("cli", "serena"):
        version = subprocess.check_output([LAUNCHER, "version", provider], text=True, timeout=30).strip()
        assert version == "mago 1.60.2", (provider, version)
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
        report = subprocess.run([LAUNCHER, "analyze", "--reporting-format", "json"], cwd=root,
                                capture_output=True, text=True, timeout=60)
        assert report.returncode == 1, (report.returncode, report.stderr)
        assert any(issue["code"] == "invalid-return-statement" for issue in json.loads(report.stdout)["issues"])
        async with asyncio.timeout(90):
            await check_language_server(root)
        assert settings.read_text() == existing
    print("Passed Mago checks, CLI and LSP diagnostics, symbol lookup and consumer settings preservation.")


if __name__ == "__main__":
    asyncio.run(main())
