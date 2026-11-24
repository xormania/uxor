#!/usr/bin/env bash
# Run a host-side check with a browser from the suite's pinned Playwright image.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
case "${1:-}" in
    website)
        suite="$root"
        image=$(node "$root/tools/playwright-image.mjs")
        ;;
    consumer)
        suite="$root/packages/uxor/dev"
        # Use the same base image as the shipped browser provider, checked
        # against the independent consumer lock.
        read -r instruction image rest < "$root/packages/uxor/resources/browser/Dockerfile"
        version=$(node -p 'require(process.argv[1]).packages["node_modules/@playwright/test"].version' "$suite/package-lock.json")
        prefix="mcr.microsoft.com/playwright:v$version-noble@sha256:"
        if [[ "$instruction" != FROM || -n "$rest" || "$image" != "$prefix"* || ! "${image#"$prefix"}" =~ ^[0-9a-f]{64}$ ]]; then
            echo "The browser provider base image must pin Playwright $version, as locked by the consumer." >&2
            exit 1
        fi
        ;;
    *)
        echo 'Usage: with-playwright-browser.sh {website|consumer} command [arguments...]' >&2
        exit 2
        ;;
esac
shift
[ "$#" -gt 0 ]

port=3000
if [ -n "$(ss -Hltn "sport = :$port")" ]; then
    echo "The loopback browser server port $port is already in use." >&2
    exit 1
fi

# The browser shares host loopback with the PHP and Python servers. The server's
# CLI comes from the same npm ci as its test client, without another npm fetch.
container=$(docker run --detach --init --network host --shm-size=256m \
    --cap-drop=ALL --security-opt=no-new-privileges --user pwuser \
    --mount "type=bind,source=$suite/node_modules,target=/opt/browser/node_modules,readonly" \
    "$image" node /opt/browser/node_modules/playwright/cli.js run-server --port "$port" --host 127.0.0.1)
trap '
    if [ "$?" -ne 0 ]; then
        docker logs --tail 50 "$container" >&2 || true
    fi
    docker rm -f "$container" >/dev/null || true
' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for _ in $(seq 1 60); do
    status=$(curl --max-time 1 -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
    if [[ "$status" =~ ^[1-5][0-9]{2}$ ]]; then
        echo "Browser server ready: $image"
        PW_BROWSER_WS_ENDPOINT="ws://127.0.0.1:$port/" "$@"
        exit 0
    fi
    [ "$(docker inspect --format '{{.State.Running}}' "$container")" = true ] || break
    sleep 1
done
echo 'The loopback browser server did not become ready.' >&2
exit 1
