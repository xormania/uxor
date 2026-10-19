"""A bounded scripted task through Serena's public shell/LSP/edit APIs."""
from __future__ import annotations

import json
from pathlib import Path
import shlex

# The consumer application, relative to the repository root that Serena binds at /workspace.
APPLICATION = "packages/uxor/dev/app"
WORKSPACE_APPLICATION = "/workspace/" + APPLICATION


class CompositionTask:
    def __init__(self, cell, root: Path):
        self.cell = cell
        self.root = root
        self.trace = []
        self.project = None
        self.reference = None

    def command(self, client, name: str, arguments: list[str], select: str = "doc"):
        command = shlex.join(arguments)
        code = (
            "import json\n"
            f"uxor_output = s.shell.execute_shell_command({command!r}, cwd={APPLICATION!r}, capture_stderr=True, max_answer_chars=8000)\n"
            "if uxor_output.return_code != 0:\n"
            f" raise RuntimeError({('Command failed: ' + name)!r} + ' (exit ' + str(uxor_output.return_code) + ')')\n"
            "doc = json.loads(uxor_output.stdout)\n"
            "json.dumps({'exit_code': uxor_output.return_code, 'cwd': uxor_output.cwd, 'data': " + select + "})"
        )
        observed = json.loads(self.cell(client, code))
        if observed["exit_code"] != 0 or observed["cwd"] != WORKSPACE_APPLICATION:
            raise RuntimeError("The composed command did not run in the intended application: " + name)
        self.trace.append({"step": name, "arguments": arguments, "exit_code": observed["exit_code"], "cwd": observed["cwd"]})
        return observed["data"]

    def discover(self, client, scratch: Path) -> list[str]:
        self.cell(client, "s.info('shell.execute_shell_command', 'lsp.find_symbol', 'edit.replace_content')")
        commands = self.command(client, "discover-package-cli", ["php", "vendor/bin/uxor", "list", "--format=json"],
                                "[item['name'] for item in doc['commands']]")
        if not {"catalog", "component", "reference", "inspect"}.issubset(commands):
            raise RuntimeError("The installed package did not expose the required commands")
        schema = self.command(client, "discover-mate-component-schema", ["php", "vendor/bin/mate", "tools:inspect", "uxor_component", "--format=json"])
        if "uxor_component" not in json.dumps(schema) or "input_schema" not in schema:
            raise RuntimeError("Mate did not expose the package's component schema")
        catalog = self.command(client, "select-component", ["php", "vendor/bin/uxor", "catalog", "--query=button", "--limit=3", "--format=json"],
                               "{'status': doc['status'], 'items': [item['name'] for item in doc['data']['items']], 'reference': doc['reference']}")
        if catalog["status"] != "completed" or "button" not in catalog["items"]:
            raise RuntimeError("The package did not discover the requested button reference")
        component = self.command(client, "read-component-through-mate", ["php", "vendor/bin/mate", "tools:call", "uxor_component", "--name=button", "--format=json"],
                                 "{'status': doc['status'], 'name': doc['data']['name'], 'reference': doc['reference']}")
        if component["status"] != "completed" or component["name"] != "button":
            raise RuntimeError("Mate did not return the selected component")
        self.reference = component["reference"]
        reference = self.command(client, "read-bounded-component-reference", ["php", "vendor/bin/uxor", "reference", "button/README.md", "--limit=1200", "--format=json"],
                                 "{'status': doc['status'], 'path': doc['data']['path'], 'characters': len(doc['data']['content']), 'sha256': doc['data']['sha256']}")
        if reference["status"] != "completed" or reference["characters"] == 0:
            raise RuntimeError("The selected component reference was empty")
        self.project = self.command(client, "inspect-bound-application", ["php", "vendor/bin/uxor", "inspect", "--project-root=.", "--format=json"],
                                    "{key: doc['data'][key] for key in ['root', 'php_binary', 'php_version']}")
        if self.project["root"] != WORKSPACE_APPLICATION:
            raise RuntimeError("The package inspected a different application")
        service = self.command(client, "inspect-actual-symfony-service", ["php", "vendor/bin/mate", "tools:call", "symfony-service-detail", "--id=App\\Controller\\DevelopmentController", "--format=json"],
                               "{key: doc['untrusted_data'][key] for key in ['id', 'class', 'autowired']}")
        if service["class"] != "App\\Controller\\DevelopmentController" or not service["autowired"]:
            raise RuntimeError("Mate did not inspect the intended compiled application service")
        relative = scratch.relative_to(self.root).as_posix()
        probe = self.cell(client, f"s.lsp.find_symbol({scratch.stem!r}, relative_path={relative!r}, include_body=True)")
        if "APPLICATION_CUSTOMIZATION" not in probe:
            raise RuntimeError("The existing customized probe was not inspected before editing")
        self.trace.append({"step": "inspect-customized-probe-before-edit", "source": relative})
        return ["discover-and-compose-serena-mate-package", "inspect-customization-before-edit"]

    def recover(self, client, scratch: Path) -> list[str]:
        relative = scratch.relative_to(self.root).as_posix()
        found = self.cell(client, f"s.lsp.find_symbol({scratch.stem!r}, relative_path={relative!r}, include_body=True)")
        if "after-probe" not in found or "keep-this-project-value" not in found:
            raise RuntimeError("The failed operation's remaining source/customization could not be inspected")
        self.trace.append({"step": "inspect-failed-cell-before-retry", "source": relative})
        self.cell(client, f"s.edit.replace_content({relative!r}, 'after-probe', 'recovered-probe', 'literal')")
        local = scratch.relative_to(self.root / APPLICATION).as_posix()
        class_name = scratch.stem
        php = f"require {local!r}; echo json_encode(['state' => App\\{class_name}::STATE, 'customization' => App\\{class_name}::APPLICATION_CUSTOMIZATION]);"
        result = self.command(client, "verify-recovered-customized-source", ["php", "-r", php])
        if result != {"state": "recovered-probe", "customization": "keep-this-project-value"}:
            raise RuntimeError("The targeted recovery changed unrelated application customization")
        return ["inspect-then-recover-without-replay", "customized-source-executes-after-recovery"]

    def evidence(self) -> dict:
        return {"evaluation_type": "scripted-integration", "access": "public-serena-shell-plus-cli-and-mate",
                "project_runtime": self.project, "reference": self.reference, "trace": self.trace,
                "limitations": ["No fresh agent was evaluated by this script.",
                                "Commands ran inside the prepared Serena container against the mounted application.",
                                "Browser behavior is verified separately; the provider has no runtime networking.",
                                "Only the owned probe was changed; this is recovery/composition evidence, not feature-delivery evidence."]}
