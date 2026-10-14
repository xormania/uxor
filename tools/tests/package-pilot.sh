#!/usr/bin/env bash
# Package an archive, then test in a consumer that cannot access this checkout or the demo's vendor directory.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
image=${PILOT_IMAGE:?Set PILOT_IMAGE to a PHP 8.4+ image with Composer, Node, Python and Tailwind 4.3.3}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node "$root/tools/build-package-pilot.mjs" "$work/package"
mkdir "$work/dist"
python3 - "$work" <<'PY'
import sys, zipfile
from pathlib import Path
work = Path(sys.argv[1])
with zipfile.ZipFile(work/'dist/uxor-pilot.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted((work/'package').rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(work/'package'))
PY
options=()
if [ -n "${PILOT_COMPOSER_CACHE_DIR:-}" ]; then
    [ -d "$PILOT_COMPOSER_CACHE_DIR" ] || { echo 'PILOT_COMPOSER_CACHE_DIR must already exist' >&2; exit 1; }
    options+=(-v "$PILOT_COMPOSER_CACHE_DIR:/home/dev/.cache/composer")
fi
if proxy_ip=$(getent ahostsv4 proxy | awk 'NR==1 {print $1}') && [ -n "$proxy_ip" ]; then
    options+=(--add-host "proxy:$proxy_ip")
fi
ca=${PILOT_CA_CERTIFICATE:-/usr/local/share/ca-certificates/environment-proxy-ca.crt}
if [ -f "$ca" ]; then
    options+=(-v "$ca:/run/pilot-proxy.pem:ro" -e LIBRARY_CA_FILE=/run/pilot-proxy.pem)
fi
docker run --rm "${options[@]}" \
    -e COMPOSER_CACHE_DIR=/home/dev/.cache/composer \
    -e HTTP_PROXY -e HTTPS_PROXY -e http_proxy -e https_proxy -e NO_PROXY -e no_proxy \
    -v "$work/dist:/dist:ro" \
    -v "$root/tools/tests/fixtures/package-pilot:/fixture:ro" \
    "$image" bash /fixture/run.sh
