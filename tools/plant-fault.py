#!/usr/bin/env python3
"""Apply one cataloged fault in a private checkout, confirm what the demo serves, then run its Playwright tests."""

import argparse
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import ProxyHandler, build_opener

CATALOG = Path(__file__).with_name("planted-faults.json")


def apply_fault(root, fault):
    for edit in fault["edits"]:
        path = root / edit["path"]
        if not path.resolve().is_relative_to(root) or path.is_symlink():
            raise ValueError(f"Fault target outside the checkout: {edit['path']}")
        source = path.read_bytes()
        search = edit["search"].encode()
        if source.count(search) != 1:
            raise ValueError(f"Expected exactly one match in {edit['path']}")
        path.write_bytes(source.replace(search, edit["replace"].encode()))


def served_text(base_url, path):
    # The catalog and the demo import map both name local resources.
    if not path.startswith("/") or path.startswith("//"):
        raise ValueError(f"Expected a local demo path: {path}")
    with build_opener(ProxyHandler({})).open(base_url + path, timeout=30) as response:
        return response.read().decode()


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.append(dict(attrs))


def confirm(base_url, fault, baseline):
    marker = fault["confirm"]
    if "asset" in marker:
        page = served_text(base_url, "/lab")
        script = re.search(r'<script\s+type="importmap"[^>]*>(.*?)</script>', page, re.S)
        if not script:
            raise ValueError("The demo did not serve an import map")
        path = json.loads(script[1])["imports"][marker["asset"]]
    else:
        path = marker["page"]
    content = served_text(base_url, path)
    if "link" in marker:
        parser = PageLinks()
        parser.feed(content)
        target = marker["link"]
        present = any(link.get("aria-label") == target["label"] and
                      parse_qs(urlsplit(link.get("href") or "").query).get("page") == [target["page"]]
                      for link in parser.links)
    else:
        present = marker["contains"] in content
    if present and baseline:
        raise ValueError(f"Fault marker already served in the clean baseline at {path}")
    if not present and not baseline:
        raise ValueError(f"Planted fault is not served at {path}")


def run_fault(root, fault, specs, *, baseline, confirm_only):
    if not baseline:
        apply_fault(root, fault)
    subprocess.run(["php", "tools/sync-demo"], cwd=root, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["composer", "install", "--no-progress", "--no-interaction"], cwd=root / "demo", check=True)
    subprocess.run(["php", "bin/console", "tailwind:build"], cwd=root / "demo", check=True)
    if not confirm_only:
        subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=root, check=True)
    # Let PHP bind an unused port. An existing demo may serve another checkout.
    command = ["php", "-d", "upload_max_filesize=2M", "-d", "post_max_size=8M", "-S", "127.0.0.1:0", "-t", "demo/public",
               Path(__file__).with_name("plant-router.php").resolve()]
    server_log = root.parent / "server.log"
    with server_log.open("wb") as output, subprocess.Popen(command, cwd=root, stderr=output) as server:
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and server.poll() is None:
                match = re.search(r"\(http://127\.0\.0\.1:(\d+)\) started", server_log.read_text())
                if match:
                    break
                time.sleep(0.05)
            else:
                raise ValueError(f"Private PHP server did not start: {server_log.read_text()}")
            base_url = f"http://127.0.0.1:{match[1]}"
            confirm(base_url, fault, baseline)
            state = "clean baseline" if baseline else "planted fault"
            print(f"Confirmed the {state} at {base_url}", flush=True)
            if confirm_only:
                return 0
            env = {**os.environ, "DEMO_URL": base_url, "PHP_BINARY": "php"}
            return subprocess.run([root / "node_modules/.bin/playwright", "test", *specs], cwd=root, env=env).returncode
        finally:
            server.terminate()


def main(argv):
    faults = json.loads(CATALOG.read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fault", choices=faults, nargs="?")
    parser.add_argument("--list", action="store_true", help="list the available faults")
    parser.add_argument("--ref", default="HEAD", help="committed revision to test (default: HEAD)")
    parser.add_argument("--baseline", action="store_true", help="test the revision with the fault absent")
    parser.add_argument("--confirm-only", action="store_true", help="verify the served marker without running tests")
    split = argv.index("--") if "--" in argv else len(argv)
    args = parser.parse_args(argv[:split])
    specs = argv[split + 1:]
    if args.list:
        for name, fault in faults.items():
            print(f"{name}: {fault['description']}")
        return 0
    if not args.fault or bool(specs) == args.confirm_only:
        parser.error("specify a fault and either --confirm-only or -- followed by Playwright test arguments")

    repo = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
    rev = subprocess.check_output(["git", "rev-parse", "--verify", "--end-of-options", args.ref + "^{commit}"],
                                  cwd=repo, text=True).strip()
    with tempfile.TemporaryDirectory(prefix="uxor-plant-") as directory:
        root = Path(directory).resolve() / "checkout"
        subprocess.run(["git", "clone", "--quiet", "--shared", "--no-checkout", "--", repo, root], check=True)
        subprocess.run(["git", "checkout", "--quiet", "--detach", rev], cwd=root, check=True)
        print(f"Testing {args.fault} at {rev} in {root}", flush=True)
        return run_fault(root, faults[args.fault], specs, baseline=args.baseline, confirm_only=args.confirm_only)


if __name__ == "__main__":
    def interrupt(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
    except (OSError, ValueError, KeyError, URLError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
