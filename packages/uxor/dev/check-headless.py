"""Exercise the installed headless feedback tool against a site with no framework, kit or JavaScript build."""
import argparse
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
from pathlib import Path
import secrets
import subprocess
import tempfile
import threading


@contextmanager
def serve(handler):
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


@contextmanager
def plain_site():
    token = secrets.token_hex(3)
    marker = "headless-regression-" + secrets.token_hex(8)

    private = "private-" + secrets.token_hex(8)

    class External(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/disconnected/"):
                self.close_connection = True
                return
            status = 503 if self.path.startswith("/unavailable/") else 200
            self.send_response(status)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", "0")
            self.send_header("X-Debug-Token", private)
            self.end_headers()

        def log_message(self, *args):
            pass

    class Pages(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/disconnected.js":
                # Closing before response headers makes the browser emit a transport failure.
                self.close_connection = True
                return
            pages = {
                "/fault": f'<script src="/disconnected.js"></script><script>throw new Error("{marker}")</script>',
                "/clean": f'<script src="{foreign}/ok/{private}"></script>',
                "/asset": f'<img src="/absent.png?key={private}">',
                # The server rejects this oversized request line; the artifact must count its omitted row.
                "/over-limit": '<img src="/' + 'a' * (300 * 1024) + '">',
                "/external-http": f'<script src="{foreign}/unavailable/{private}?key={private}"></script>',
                "/external-transport": f'<script src="{foreign}/disconnected/{private}?key={private}"></script>',
            }
            if self.path.startswith("/absent.png"):
                self.send_response(404)
                self.send_header("X-Debug-Token", token)
                self.end_headers()
                return
            if self.path not in pages:
                self.send_error(404)
                return
            body = ('<!doctype html><meta charset="utf-8">' + pages[self.path]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            if self.path == "/fault":
                self.send_header("X-Debug-Token", token)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    with serve(External) as foreign, serve(Pages) as origin:
        yield origin, foreign, token, marker, private


def run_browser(app, url, path, cache, *, expected, docker, warm):
    env = os.environ.copy()
    env["XDG_CACHE_HOME"] = str(cache)
    env.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(cache / "chromium"))
    if warm:
        # No package or Chromium download is available on subsequent launches.
        env.update(npm_config_cache=str(cache / "empty-npm-cache"), npm_config_offline="true",
                   PLAYWRIGHT_DOWNLOAD_HOST="http://127.0.0.1:1")
    command = [str(app / "vendor/bin/uxor-browser")]
    if docker:
        command.append("--docker")
    result = subprocess.run([*command, "--output", path, url], cwd=app, env=env,
                            capture_output=True, text=True, timeout=600)
    if result.returncode != expected or result.stdout.strip() != path:
        raise RuntimeError(f"Headless launch for {url} expected exit {expected} and artifact {path}, "
                           f"got {result.returncode}, stdout {result.stdout!r}, stderr {result.stderr[-2000:]!r}")
    return result.stderr


def check_readers(app, path):
    php = os.environ.get("PHP_BIN", "php")
    cli = subprocess.check_output([php, "vendor/bin/uxor", "browser-diagnostics", path, "--format=json"], cwd=app)
    report = json.loads(cli)
    if report["status"] != "completed" or report["data"]["artifact"] != path:
        raise RuntimeError("The UXor CLI did not read the capture from this run")
    mate = subprocess.check_output([php, "vendor/bin/mate", "tools:call", "uxor_browser_diagnostics",
                                    "--path=" + path, "--format=json"], cwd=app)
    if json.loads(mate)["untrusted_data"] != report:
        raise RuntimeError("The Mate tool did not return the same capture as the UXor CLI")
    return report["data"]


def assert_capture(data, diagnostic, page, origin, foreign, token, marker, private):
    url = f"{origin}/{page}"
    status = 404 if page == "missing" else 200
    if data["visit"] != {"url": url, "status": status, "error": None}:
        raise RuntimeError(f"Unexpected visit for {page}: {data['visit']}")
    if private in json.dumps(data) or private in diagnostic:
        raise RuntimeError(f"Private URL data or a foreign profiler token leaked from {page}")
    if [row["message"] for row in data["pageErrors"]] != ([marker] if page == "fault" else []):
        raise RuntimeError(f"Unexpected page errors for {page}: {data['pageErrors']}")
    failures = data["requestFailures"]
    expected = {
        "missing": (url, "HTTP 404"),
        "fault": (origin + "/disconnected.js", None),
        "asset": (origin + "/absent.png", "HTTP 404"),
        "external-http": (foreign, "HTTP 503"),
        "external-transport": (foreign, None),
    }.get(page)
    dropped = data.get("dropped", {}).get("requestFailures", 0)
    count = int(expected is not None)
    omitted = int(page == "over-limit")
    if (len(failures) != count or dropped != omitted
            or not re.search(rf"\b{count + omitted} failed requests\.", diagnostic)):
        raise RuntimeError(f"Wrong number of failed requests for {page}: {failures}")
    if expected:
        row = failures[0]
        target, error = expected
        if row["url"].rstrip("/") != target or row["method"] != "GET" or row["turboFrame"] is not None:
            raise RuntimeError(f"Wrong request attribution for {page}: {row}")
        if not row["error"] or (error is not None and row["error"] != error):
            raise RuntimeError(f"Wrong failure reason for {page}: {row}")
    profiles = data["responses"]
    if page in ("fault", "asset"):
        if len(profiles) != 1 or (profiles[0]["token"], profiles[0]["status"], profiles[0]["profileUri"]) != (
                token, 404 if page == "asset" else 200, f"symfony-profiler://profile/{token}"):
            raise RuntimeError(f"Wrong profiled response for {page}: {profiles}")
        same_request = profiles[0]["requestId"] == failures[0]["requestId"]
        if same_request != (page == "asset"):
            raise RuntimeError(f"Incorrectly correlated the failure and profiler token for {page}")
    elif profiles:
        raise RuntimeError(f"Unexpected profiler token on {page}: {profiles}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="Composer application with the package and its Mate reader installed")
    parser.add_argument("--docker", action="store_true", help="Exercise the bundled container on the Docker host")
    options = parser.parse_args()
    app = options.app.resolve()
    manifests = ("composer.json", "composer.lock", "symfony.lock", "package.json", "package-lock.json",
                 "yarn.lock", "pnpm-lock.yaml")

    def dependencies():
        return {name: (app / name).read_bytes() for name in manifests if (app / name).is_file()}

    before = dependencies()
    had_node = (app / "node_modules").exists()
    (app / "var").mkdir(exist_ok=True)
    with (plain_site() as (origin, foreign, token, marker, private), tempfile.TemporaryDirectory(dir=app / "var") as output,
          tempfile.TemporaryDirectory() as cache):
        for page in ("fault", "asset", "external-http", "external-transport", "over-limit", "clean", "missing"):
            path = (Path(output) / page / "browser-diagnostics.json").relative_to(app).as_posix()
            diagnostic = run_browser(app, f"{origin}/{page}", path, Path(cache), expected=int(page != "clean"),
                                     docker=options.docker, warm=page != "fault")
            assert_capture(check_readers(app, path), diagnostic, page, origin, foreign, token, marker, private)
    if dependencies() != before or (app / "node_modules").exists() != had_node:
        raise RuntimeError("The browser feedback tool changed application package files or installed Node dependencies")
    runtime = "container" if options.docker else "native runtime"
    print(f"Headless Chromium ({runtime}) verified local and external HTTP and transport failures, profile correlation and a clean page through CLI and Mate.")


if __name__ == "__main__":
    main()
