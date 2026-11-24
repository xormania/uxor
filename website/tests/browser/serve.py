"""Serve the website at its publication prefix independently of the Symfony demo."""
import os
import subprocess
import sys
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class StaticFiles(SimpleHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        if int(code) >= 400:
            super().log_request(code, size)


with tempfile.TemporaryDirectory(prefix="uxor-website-") as public:
    site = Path(public, "uxor")
    if output := os.environ.get("WEBSITE_OUTPUT"):
        site.symlink_to(Path(output).resolve(strict=True), target_is_directory=True)
    else:
        subprocess.run([
            os.environ.get("PHP_BINARY", "php"), "website/bin/build", str(site),
            "--base-path=/uxor", "--site-url=https://xormania.github.io/uxor",
        ], check=True)
    if not (site / "index.html").is_file():
        raise FileNotFoundError(site / "index.html")
    handler = partial(StaticFiles, directory=public)
    with ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), handler) as server:
        server.serve_forever()
