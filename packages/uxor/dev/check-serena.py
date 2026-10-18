#!/usr/bin/env python3
"""Record actual Serena v2 symbol, session and partial-failure evidence."""
from __future__ import annotations

import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys

# Serena binds the repository root (mounted at /workspace); the consumer application is nested in it.
ROOT = Path(__file__).resolve().parents[3]
DEV = Path(__file__).resolve().parent
APPLICATION = "packages/uxor/dev/app"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cell(client, code: str, *, expected_error: str | None = None) -> str:
    result = client.repl(code)
    text = client.content(result["result"])
    if expected_error is not None:
        if result["ok"] or expected_error not in text:
            raise RuntimeError("The deliberate REPL failure was not reported as expected: " + text[:1000])
    elif not result["ok"]:
        raise RuntimeError("Serena operation failed: " + text[:1000])
    return text


def exercise(client_type, launch: list[str], scratch: Path, protected: Path, timeout: float, task=None) -> dict:
    """Only scratch is mutable; a reconnect must keep source and discard variables."""
    original_hash = hashlib.sha256(protected.read_bytes()).hexdigest()
    relative = scratch.relative_to(ROOT).as_posix()
    client = None
    checks = []
    try:
        client = client_type([*launch, "--write"], timeout=timeout)
        first_session = client.session
        client.timeout = min(timeout, 180)
        cell(client, "s.info('lsp.find_symbol', 'edit.replace_content')")
        found = cell(client, "s.lsp.find_symbol('DevelopmentController', relative_path='" + APPLICATION + "/src/Controller/DevelopmentController.php', include_body=False)")
        if "DevelopmentController" not in found:
            raise RuntimeError("The fixture controller was not returned by PHP symbol lookup")
        checks.append("php-symbol-lookup")

        if cell(client, "uxor_probe = 41\nuxor_probe").strip() != "41":
            raise RuntimeError("Initial REPL variable result was not 41")
        if cell(client, "uxor_probe + 1").strip() != "42":
            raise RuntimeError("REPL variables did not survive a second cell")
        checks.append("persistent-repl-variable")

        if task is not None:
            checks.extend(task.discover(client, scratch))

        cell(client, f"s.edit.replace_content({relative!r}, 'before-probe', 'after-probe', 'literal')\nraise RuntimeError('uxor-deliberate-failure')",
             expected_error="uxor-deliberate-failure")
        if "after-probe" not in scratch.read_text():
            raise RuntimeError("The source edit made before the deliberate error did not remain inspectable")
        checks.append("source-edit-survives-failed-cell")
        expected_source = "after-probe"
        if task is not None:
            checks.extend(task.recover(client, scratch))
            expected_source = "recovered-probe"
        client.close()
        client = None

        # A new read-only provider session deliberately receives no old REPL variables.
        client = client_type(launch, timeout=timeout)
        client.timeout = min(timeout, 180)
        if client.session == first_session:
            raise RuntimeError("The reconnect unexpectedly reused the previous session identity")
        if cell(client, "'uxor_probe' in globals()").strip() != "False":
            raise RuntimeError("The reconnect retained the old REPL variable")
        if expected_source not in scratch.read_text():
            raise RuntimeError("The reconnect lost the earlier source edit")
        if task is not None and "keep-this-project-value" not in scratch.read_text():
            raise RuntimeError("The reconnect lost the unrelated application customization")
        checks.append("reconnect-resets-variables-preserves-source")
        if hashlib.sha256(protected.read_bytes()).hexdigest() != original_hash:
            raise RuntimeError("The protected fixture controller changed during Serena verification")
        checks.append("fixture-controller-unchanged")
        result = {"status": "passed", "checks": checks, "controller_sha256": original_hash}
        if task is not None:
            result["composition"] = task.evidence()
        return result
    finally:
        if client is not None:
            client.close()


def main(arguments=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--startup-timeout", type=float, default=600)
    parser.add_argument("--package", action="store_true", help="Also compose the installed package's CLI and Mate capabilities and recover customized source")
    args = parser.parse_args(arguments)
    if args.startup_timeout <= 0:
        parser.error("--startup-timeout must be positive")
    state = DEV / ".state"
    state.mkdir(parents=True, exist_ok=True)
    lock_descriptor = os.open(state / "serena-check.lock", os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(lock_descriptor, "w") as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Serena verification owns this worktree; wait for it or use a separate worktree")
        # A failed new attempt must not leave an earlier passing receipt current.
        (state / "serena-evidence.json").unlink(missing_ok=True)
        runner = load_module("uxor_dev_runner", DEV / "run.py")
        provider, _, _ = runner.prepare_image(runner.environment(), serena=True)
        # The public xorder client owns MCP initialization, serialization and shutdown.
        sys.path.insert(0, str(provider / "examples/serena"))
        client = load_module("uxor_external_serena_client", provider / "examples/serena/client.py")
        protected = ROOT / APPLICATION / "src/Controller/DevelopmentController.php"
        token = secrets.token_hex(6)
        scratch = ROOT / APPLICATION / f"src/SerenaRecoveryProbe{token}.php"
        descriptor = os.open(scratch, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as source:
            source.write("<?php\nnamespace App;\nfinal class SerenaRecoveryProbe" + token
                         + " { public const STATE = 'before-probe'; public const APPLICATION_CUSTOMIZATION = 'keep-this-project-value'; }\n")
        try:
            task = None
            if args.package:
                from composition import CompositionTask
                task = CompositionTask(cell, ROOT)
            evidence = exercise(client.MCP, [sys.executable, str(DEV / "run.py"), "serena"], scratch, protected, args.startup_timeout, task)
            evidence.update({
                "provider_source": runner.XORDER_REVISION,
                "image": runner.locked_image(DEV / "serena-support.lock.json"),
                "application": APPLICATION,
                "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })
            (state / "serena-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
            print(json.dumps(evidence, indent=2))
        finally:
            scratch.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print("Serena verification failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
