"""Launch the selected application's Serena session with private, reusable state."""
import argparse
import fcntl
from functools import wraps
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


PROJECT = Path("/app")
STATE = Path("/state")


def preparation_generation(project=PROJECT):
    """Read the owned preparation contract without compiling or refreshing the app."""
    worker = project / ".uxor/mago/worker.php"
    if not worker.is_file():
        configuration = project / ".uxor/mago/config.toml"
        if configuration.is_file() and any(
            line.strip() == "[extension-hosts.uxor-symfony]"
            for line in configuration.read_text().splitlines()
        ):
            raise RuntimeError("Symfony graph preparation is incomplete. Run vendor/bin/uxor prepare in the application's PHP runtime.")
        return None
    try:
        result = subprocess.run(
            ["php", str(worker), "--check"], cwd=project,
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("Cannot verify Symfony graph preparation. Run vendor/bin/uxor environment in the application's PHP runtime.") from None
    if result.returncode != 0:
        raise RuntimeError("Symfony graph preparation is stale or unavailable. Run vendor/bin/uxor prepare in the application's PHP runtime.")
    try:
        if len(result.stdout) > 4096:
            raise ValueError("Oversized preparation response")
        status = json.loads(result.stdout)
        if not isinstance(status, dict) or not isinstance(status.get("enabled"), bool):
            raise ValueError("Missing preparation state")
        if not status["enabled"]:
            return None
        generation = status.get("preparationId")
        if status.get("fresh") is not True or not isinstance(generation, str) or not re.fullmatch(r"[0-9a-f]{32}", generation):
            raise ValueError("Missing fresh preparation identity")
        return generation
    except (ValueError, TypeError):
        raise RuntimeError("The Symfony preparation check returned an invalid state. Run vendor/bin/uxor environment in the application's PHP runtime.") from None


def install_graph_guard():
    """Preserve the patched graph API while rejecting stale compiled facts."""
    from serena.repl.api.lsp_api import LspApi

    original = LspApi.get_symbol_references

    @wraps(original)
    def get_symbol_references(self, relative_path: str, symbol: str, member: str = "") -> dict[str, Any]:
        generation = preparation_generation()
        if getattr(self, "_uxor_preparation_generation", None) != generation:
            # Workers cache the exported reference. A fresh preparation must
            # reach a new language-server generation before graph inspection.
            self.restart_language_server()
            self._uxor_preparation_generation = generation
        result = original(self, relative_path, symbol, member)
        if preparation_generation() != generation:
            raise RuntimeError("Symfony preparation changed during graph inspection. Repeat the query after preparation completes.")
        return result

    LspApi.get_symbol_references = get_symbol_references


def write_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    home = Path(os.environ["SERENA_HOME"])
    project = STATE / "project"
    home.mkdir(parents=True, exist_ok=True)
    project.mkdir(parents=True, exist_ok=True)

    # The volume belongs to one canonical application, user and image. Keep its
    # generated configuration and index consistent across concurrent clients.
    with (STATE / "session.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another Serena session is using this application's provider state. Close it before reconnecting.", file=sys.stderr)
            raise SystemExit(2) from None
        write_json(home / "serena_config.yml", {
            "projects": [],
            "trusted_project_path_patterns": [],
            "project_serena_folder_location": str(project),
            "web_dashboard": False,
            "web_dashboard_open_on_launch": False,
            "gui_log_window": False,
        })
        write_json(project / "project.yml", {
            "project_name": "application",
            "language_servers": ["mago"],
            "read_only": not args.write,
            "ignored_paths": ["var", ".serena", ".uxor", ".phpunit.cache", "public/assets"],
            "included_apis": [
                "lsp.restart_language_server",
                "lsp.get_diagnostics_for_file",
                "lsp.get_symbol_references",
            ],
        })
        install_graph_guard()
        from serena.cli import top_level

        top_level(args=[
            "start-mcp-server", "--project", str(PROJECT), "--transport", "stdio",
            "--agent-interface", "REPL", "--context", "desktop-app",
            "--mode", "editing", "--mode", "no-onboarding",
            "--enable-web-dashboard", "false", "--open-web-dashboard", "false",
            "--enable-gui-log-window", "false", "--log-level", "WARNING",
        ])


if __name__ == "__main__":
    main()
