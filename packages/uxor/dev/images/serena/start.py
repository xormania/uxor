"""Start the offline editor with UXor's prepared tools and a per-session configuration."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--write", action="store_true")
args = parser.parse_args()
home = Path(os.environ["SERENA_HOME"])
project = home / "project"
project.mkdir(parents=True)
(project / "project.yml").write_text(json.dumps({
    "project_name": "UXor",
    "language_servers": ["php_phpactor", "typescript"],
    "read_only": not args.write,
    "ignored_paths": ["**/node_modules/**", "**/var/**", "**/.state/**", "**/vendor/**"],
}))
phpactor_config = {"language_server_configuration.auto_config": False}
phpactor_options = ["--config-extra", json.dumps(phpactor_config)]
(home / "serena_config.yml").write_text(json.dumps({
    "projects": [],
    "trusted_project_path_patterns": [],
    "project_serena_folder_location": str(project),
    "ls_specific_settings": {
        "php_phpactor": {"ls_base_cmd": ["php", "/opt/phpactor.phar"], "ls_args": ["language-server", *phpactor_options]},
        "typescript": {"ls_path": "/opt/javascript/node_modules/.bin/typescript-language-server"},
    },
    "web_dashboard": False,
    "web_dashboard_open_on_launch": False,
    "gui_log_window": False,
}))
# Upstream resolves its trusted TypeScript SDK from its static resource directory.
sdk = home / "language_servers/static/TypeScriptLanguageServer/ts-lsp"
sdk.parent.mkdir(parents=True)
sdk.symlink_to("/opt/javascript", target_is_directory=True)

# Finish PHPactor's incremental index before answering a cold reference query.
# Serialize sessions using this worktree's index, including the LSP's later writes.
with (Path(os.environ["XDG_CACHE_HOME"]) / "editor.lock").open("a") as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit("Another Serena process is using this worktree's PHPactor index")
    subprocess.run(["php", "/opt/phpactor.phar", "index:build", *phpactor_options, "--quiet", "--no-interaction"],
                   stdout=sys.stderr, check=True)
    from serena.cli import top_level
    top_level(args=["start-mcp-server", "--project", "/workspace", "--agent-interface", "REPL",
                    "--context", "desktop-app", "--mode", "editing", "--mode", "no-onboarding",
                    "--enable-web-dashboard", "False", "--open-web-dashboard", "False",
                    "--enable-gui-log-window", "False", "--log-level", "WARNING"])
