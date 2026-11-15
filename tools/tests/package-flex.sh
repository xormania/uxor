#!/usr/bin/env bash
# Exercise real Flex against a private recipe endpoint and Composer distribution archives.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
build_options=()
if [ -n "${PILOT_TOOLKIT_PLAN:-}" ]; then
    build_options+=(--plan "$PILOT_TOOLKIT_PLAN")
fi
if [ -n "${PILOT_TOOLKIT_PLAN:-}" ] && [ -n "${PILOT_IMAGE:-}" ]; then
    # The author build needs PHP for Composer's constraint semantics. Keep that toolchain outside the
    # later consumer: only the resulting distributions are mounted into the Flex installation.
    autoload=${PILOT_COMPOSER_AUTOLOAD:-$root/demo/vendor/autoload.php}
    [ -f "$autoload" ] || { echo 'PILOT_COMPOSER_AUTOLOAD must name an installed Composer autoloader' >&2; exit 1; }
    docker run --rm --network none --user "$(id -u):$(id -g)" --entrypoint node \
        -v "$root:/source:ro" -v "$work:/work" \
        -v "$(realpath "$PILOT_TOOLKIT_PLAN"):/toolkit-plan.json:ro" \
        -v "$(cd "$(dirname "$autoload")" && pwd):/composer-vendor:ro" \
        -e "PILOT_COMPOSER_AUTOLOAD=/composer-vendor/$(basename "$autoload")" \
        "$PILOT_IMAGE" /source/tools/build-package-pilot.mjs /work/package --plan /toolkit-plan.json
else
    node "$root/tools/build-package-pilot.mjs" "$work/package" "${build_options[@]}"
fi
python3 "$root/tools/tests/fixtures/package-flex/build-dist.py" \
    "$work/package" "$root/packages/uxor-pilot/recipe/manifest.json" "$work/dist"

if [ -z "${PILOT_IMAGE:-}" ]; then
    bash "$root/tools/tests/fixtures/package-flex/run.sh" "$work/dist"
    exit
fi

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
    -v "$root/tools/tests/fixtures/package-flex:/fixture:ro" \
    "$PILOT_IMAGE" bash /fixture/run.sh /dist
