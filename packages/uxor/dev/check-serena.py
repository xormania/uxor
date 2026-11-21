#!/usr/bin/env python3
"""Record actual Serena v2 symbol, session and partial-failure evidence."""
from __future__ import annotations

import argparse
from contextlib import contextmanager, suppress
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import re
import secrets
import subprocess
import sys
import threading
import time

# Serena binds the repository root (mounted at /workspace); the consumer application is nested in it.
ROOT = Path(__file__).resolve().parents[3]
DEV = Path(__file__).resolve().parent
APPLICATION = "packages/uxor/dev/app"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MCP:
    """Single-request stdio client for the two Serena tools exercised below."""

    def __init__(self, argv, timeout):
        self.timeout = timeout
        self.next_id = 0
        self.process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        text=True, encoding="utf-8")
        self.messages = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()
        try:
            self.request("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                        "clientInfo": {"name": "uxor-development-check", "version": "1"}})
            self.send({"method": "notifications/initialized"})
            manual = self.tool("initial_instructions", {})
            identity = re.search(r"Your Serena session id is `([^`]+)`", self.content(manual))
            if manual.get("isError") or not identity:
                raise RuntimeError("Serena did not return its REPL session ID")
            self.session = identity.group(1)
        except BaseException:
            self.close()
            raise

    def _read(self):
        try:
            for line in self.process.stdout:
                self.messages.put(line)
        finally:
            self.messages.put(None)

    def send(self, message):
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", **message}) + "\n")
        self.process.stdin.flush()

    def request(self, method, params):
        self.next_id += 1
        self.send({"method": method, "params": params, "id": self.next_id})
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                line = self.messages.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                raise TimeoutError(f"Timed out waiting for Serena {method}") from None
            if line is None:
                raise RuntimeError(f"Serena closed its output while handling {method}")
            response = json.loads(line)
            if "method" in response:
                # Notifications have no reply. An MCP peer may also check liveness.
                if "id" in response:
                    payload = {"result": {}} if response["method"] == "ping" else {
                        "error": {"code": -32601, "message": "Unsupported client method"}}
                    self.send({"id": response["id"], **payload})
                continue
            if response.get("id") != self.next_id:
                raise RuntimeError(f"Unexpected Serena response ID for {method}")
            if "error" in response:
                raise RuntimeError(f"Serena {method} failed: {response['error']}")
            return response["result"]

    def tool(self, name, arguments):
        return self.request("tools/call", {"name": name, "arguments": arguments})

    @staticmethod
    def content(result):
        return "\n".join(item["text"] for item in result["content"] if item["type"] == "text")

    def repl(self, code):
        result = self.tool("serena_repl", {"session": self.session, "code": code})
        # Upstream renders exceptions in tool text, including when MCP isError is false.
        failed = result.get("isError") or re.match(r"^(?:\w*Error|\w*Exception):", self.content(result))
        return {"ok": not failed, "result": result}

    def close(self):
        try:
            self.process.stdin.close()
        except BrokenPipeError:
            pass
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process.stdout.close()


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

        references = cell(client, f"s.lsp.find_referencing_symbols('CustomerStore', '{APPLICATION}/src/Customer/CustomerStore.php', max_answer_chars=8000)")
        if "CustomerController/edit" not in references:
            raise RuntimeError("PHPactor did not find the controller's reference to CustomerStore")
        checks.append("php-cross-file-reference")

        symbols = cell(client, f"s.lsp.get_symbols_overview('{APPLICATION}/assets/controllers/counter_controller.js', depth=2)")
        if "increment" not in symbols:
            raise RuntimeError("The JavaScript language server did not return the Stimulus action")
        checks.append("javascript-symbol-lookup")

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
        cell(client, f"s.edit.replace_content({relative!r}, {expected_source!r}, 'forbidden-write', 'literal')",
             expected_error="has no attribute 'edit'")
        if expected_source not in scratch.read_text():
            raise RuntimeError("The read-only session changed the probe")
        checks.append("read-only-session-denies-source-edit")
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


@contextmanager
def verification_state(state):
    state.mkdir(exist_ok=True)
    # Keep an open directory handle for all host writes. Ignore checkout symlinks
    # even if the state path is replaced while Docker is starting.
    directory = os.open(state, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        descriptor = os.open("serena-check.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(descriptor, "r+") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Another Serena verification owns this worktree; wait for it or use a separate worktree")
            with suppress(FileNotFoundError):
                os.unlink("serena-evidence.json", dir_fd=directory)
            yield directory
    finally:
        os.close(directory)


def record(directory, evidence):
    name = "serena-evidence-" + secrets.token_hex(8) + ".tmp"
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, "w") as out:
            out.write(json.dumps(evidence, indent=2) + "\n")
        os.replace(name, "serena-evidence.json", src_dir_fd=directory, dst_dir_fd=directory)
    finally:
        with suppress(FileNotFoundError):
            os.unlink(name, dir_fd=directory)


def main(arguments=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--startup-timeout", type=float, default=600)
    parser.add_argument("--package", action="store_true", help="Also compose the installed package's CLI and Mate capabilities and recover customized source")
    args = parser.parse_args(arguments)
    if args.startup_timeout <= 0:
        parser.error("--startup-timeout must be positive")
    with verification_state(DEV / ".state") as state:
        editor = load_module("uxor_editor", DEV / "serena.py")
        image = editor.prepare()
        protected = ROOT / APPLICATION / "src/Controller/DevelopmentController.php"
        if protected.resolve(strict=True) != protected:
            raise RuntimeError("The verification fixture must be a regular path in the checkout")
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
            evidence = exercise(MCP, [sys.executable, str(DEV / "run.py"), "serena"], scratch, protected, args.startup_timeout, task)
            evidence.update({
                "provider_source": editor.image_tag(),
                "image": image,
                "application": APPLICATION,
                "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })
            record(state, evidence)
            print(json.dumps(evidence, indent=2))
        finally:
            scratch.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print("Serena verification failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
