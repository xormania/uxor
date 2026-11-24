"""Exercise the installed headless feedback tool against a site with no framework, kit or JavaScript build."""
import argparse
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import threading


@contextmanager
def plain_site():
    token = secrets.token_hex(3)
    marker = "headless-regression-" + secrets.token_hex(8)

    class Pages(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/disconnected.js":
                # A dropped same-origin connection is a real browser request failure. An HTTP 404 is a response.
                self.close_connection = True
                return
            pages = {
                "/fault": f'<script src="/disconnected.js"></script><script>throw new Error("{marker}")</script>',
                "/clean": '<p>A plain page</p>',
            }
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

    with ThreadingHTTPServer(("127.0.0.1", 0), Pages) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", token, marker
        finally:
            server.shutdown()
            thread.join()


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


def assert_capture(data, url, status, token, error):
    visit = {"url": url, "status": status, "error": None}
    if data.get("visit") != visit:
        raise RuntimeError(f"Expected visit {visit}, got {data.get('visit')}")
    expected = [(url, token, 200, f"symfony-profiler://profile/{token}")] if token else []
    actual = [(row["url"], row["token"], row["status"], row["profileUri"]) for row in data["responses"]]
    if actual != expected:
        raise RuntimeError(f"Wrong profile evidence. Expected {expected}, got {actual}")
    if error:
        if [row["message"] for row in data["pageErrors"]] != [error]:
            raise RuntimeError(f"Page error did not come from this run: {data['pageErrors']}")
        failures = data["requestFailures"]
        if len(failures) != 1 or failures[0]["url"] != url.rsplit("/", 1)[0] + "/disconnected.js" or not failures[0]["error"]:
            raise RuntimeError(f"Missing the dropped script connection: {failures}")
    elif data["pageErrors"] or data["requestFailures"]:
        raise RuntimeError(f"Clean page inherited findings from the previous run: {data}")


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
    with (plain_site() as (origin, token, marker), tempfile.TemporaryDirectory(dir=app / "var") as output,
          tempfile.TemporaryDirectory() as cache):
        pages = (("fault", 200, token, marker), ("clean", 200, None, None), ("missing", 404, None, None))
        for page, status, expected_token, error in pages:
            url = f"{origin}/{page}"
            path = (Path(output) / page / "browser-diagnostics.json").relative_to(app).as_posix()
            run_browser(app, url, path, Path(cache), expected=int(bool(error) or status >= 400),
                        docker=options.docker, warm=page != "fault")
            assert_capture(check_readers(app, path), url, status, expected_token, error)
    if dependencies() != before or (app / "node_modules").exists() != had_node:
        raise RuntimeError("The browser feedback tool changed application package files or installed Node dependencies")
    runtime = "container" if options.docker else "native runtime"
    print(f"Headless Chromium ({runtime}) verified page and network errors, a clean page and HTTP 404 through CLI and Mate.")


if __name__ == "__main__":
    main()
