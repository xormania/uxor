"""Serve the unmodified pilot recipe through Flex's real HTTP downloader, on loopback only."""

import functools
import hashlib
import http.server
import json
import ssl
import sys
from pathlib import Path

dist, endpoint, app, ready, certificate, private_key = map(Path, sys.argv[1:])
endpoint.mkdir()


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


handler = functools.partial(QuietHandler, directory=str(endpoint))
with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, private_key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    base_url = f"https://127.0.0.1:{server.server_port}"
    manifest = (dist / "recipe.json").read_bytes()
    (endpoint / "index.json").write_text(json.dumps({
        "recipes": {"xormania/uxor-pilot": ["0.0"]},
        "aliases": {},
        "versions": {},
        "branch": "fixture",
        "is_contrib": False,
        "_links": {
            "repository": "local/uxor-recipes",
            "origin_template": "{package}:{version}@local/uxor-recipes:fixture",
            "recipe_template": base_url + "/{package_dotted}.{version}.json",
        },
    }))
    (endpoint / "xormania.uxor-pilot.0.0.json").write_text(json.dumps({
        "manifests": {
            "xormania/uxor-pilot": {
                "manifest": json.loads(manifest),
                "files": {},
                "ref": hashlib.sha1(manifest).hexdigest(),
            },
        },
    }))
    releases = json.loads((dist / "releases.json").read_text())
    for release in releases:
        release["dist"]["url"] = (dist / release["dist"]["url"]).as_uri()
    composer_file = app / "composer.json"
    composer = json.loads(composer_file.read_text())
    composer["repositories"] = [{"type": "package", "package": releases}]
    # An array deliberately omits the public default recipe endpoints.
    composer["extra"] = {"symfony": {"endpoint": [base_url + "/index.json"]}}
    composer_file.write_text(json.dumps(composer, indent=4) + "\n")
    ready.write_text(str(server.server_port))
    server.serve_forever()
