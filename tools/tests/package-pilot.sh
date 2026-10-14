#!/usr/bin/env bash
# Package an archive, then test in a consumer that cannot access this checkout or the demo's vendor directory.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
image=${PILOT_IMAGE:?Set PILOT_IMAGE to a PHP 8.4+ image with Composer, Node, Python and Tailwind 4.3.3}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$root/test-results"
reports=$(mktemp -d "$root/test-results/package-pilot.XXXXXXXX")
node "$root/tools/package-pilot-releases.mjs" "$work/releases"
mkdir "$work/dist"
python3 - "$work" <<'PY'
import json, shutil, sys, zipfile
from pathlib import Path
work = Path(sys.argv[1])
plan = json.loads((work/'releases/releases.json').read_text())
shutil.copyfile(work/'releases/releases.json', work/'dist/releases.json')
for version in (plan['baseline_version'], plan['upgrade_version']):
    package = work/'releases'/version
    with zipfile.ZipFile(work/f'dist/uxor-pilot-{version}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(package.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(package))
PY
options=()
if [ -n "${PILOT_BROWSER_CONTAINER:-}" ]; then
    options+=(--network "container:$PILOT_BROWSER_CONTAINER")
fi
if [ -n "${PILOT_COMPOSER_CACHE_DIR:-}" ]; then
    [ -d "$PILOT_COMPOSER_CACHE_DIR" ] || { echo 'PILOT_COMPOSER_CACHE_DIR must already exist' >&2; exit 1; }
    options+=(-v "$PILOT_COMPOSER_CACHE_DIR:/home/dev/.cache/composer")
fi
ca=${PILOT_CA_CERTIFICATE:-/usr/local/share/ca-certificates/environment-proxy-ca.crt}
if [ -f "$ca" ]; then
    options+=(-v "$ca:/run/pilot-proxy.pem:ro" -e LIBRARY_CA_FILE=/run/pilot-proxy.pem)
fi
python3 - "${options[@]}" \
    -e "PUID=${PUID:-$(id -u)}" -e "PGID=${PGID:-$(id -g)}" \
    -e COMPOSER_CACHE_DIR=/home/dev/.cache/composer \
    -e PILOT_BROWSER_CONTAINER -e PILOT_BROWSER_WS -e PILOT_PORT \
    -e HTTP_PROXY -e HTTPS_PROXY -e http_proxy -e https_proxy -e NO_PROXY -e no_proxy \
    -v "$work/dist:/dist:ro" \
    -v "$root/tools/tests/fixtures/package-pilot:/fixture:ro" \
    -v "$reports:/reports" \
    "$image" bash /fixture/run.sh <<'PY'
import os, socket, subprocess, sys
from urllib.parse import urlsplit, urlunsplit
env = os.environ.copy()
# Shared container networks reject custom hosts. Resolve the platform's HTTP proxy in the host context instead.
# Bindings remain in process memory and are forwarded by variable name; never write or print their values.
for name in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'):
    if env.get(name):
        url = urlsplit(env[name])
        if url.hostname == 'proxy' and url.scheme == 'http':
            env[name] = urlunsplit((url.scheme, url.netloc.replace('proxy', socket.gethostbyname('proxy')), url.path, url.query, url.fragment))
sys.exit(subprocess.call(['docker', 'run', '--rm', *sys.argv[1:]], env=env))
PY
echo "Upgrade reports: $reports"
