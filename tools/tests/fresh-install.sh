#!/usr/bin/env bash
# On a fresh Symfony skeleton, `ux:install dashboard-home` (which brings `layouts`) from this
# kit, as GitHub's archive gives it, yields a working dashboard page; `ux:install signup` yields a form rendered
# through the form theme without any `twig.form_themes` setting.
#
#   tools/tests/fresh-install.sh            # PHP=… COMPOSER_BIN=… to use other binaries
#   PORT=<port> tools/tests/fresh-install.sh # default: choose a free loopback port
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
php="${PHP:-php}"
composer="${COMPOSER_BIN:-composer}"
symfony_version="${SYMFONY_VERSION:-7.4.*}"
port="${PORT:-0}"
if ! [[ $port =~ ^[0-9]{1,5}$ ]] || ((10#$port > 65535)); then
    echo 'PORT must be an integer from 0 (automatic allocation) to 65535' >&2
    exit 1
fi
port=$((10#$port))
work="$(mktemp -d)"
server_pid=
cleanup() {
    if [ -n "$server_pid" ]; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
    rm -rf "$work"
}
trap cleanup EXIT

app="$work/app"
$composer create-project --no-interaction --no-progress "symfony/skeleton:$symfony_version" "$app"
cd "$app"
$composer config platform.php "$($php -r 'echo PHP_VERSION;')"

# the shared steps (install-scenario.sh), run on the host
app() { "$@"; }
app_console() { $php bin/console "$@"; }
app_composer="$composer"
app_dir="$app"
# shellcheck source=tools/tests/install-scenario.sh
. "$root/tools/tests/install-scenario.sh"
require_kit_packages

# the kit as GitHub's archive gives it (export-ignore applies), from the last commit, as a local kit
kit="vendor/symfony/ux-toolkit/kits/kit-local"
mkdir -p "$kit"
git -C "$root" archive HEAD | tar -x -C "$kit"
install_kit_recipes kit-local "$work"
add_fresh_app "$root"

server_failed() {
    echo "FAIL: $1" >&2
    tail -20 "$work/server.log" >&2 || true
    exit 1
}

# PHP binds port 0 atomically and reports the actual port after listening. Read that confirmation from this child's
# log before sending any request, including when PORT is explicit. One worker keeps the listener owned by this PID.
(
    unset PHP_CLI_SERVER_WORKERS
    exec "$php" -S "127.0.0.1:$port" -t public
) > "$work/server.log" 2>&1 &
server_pid=$!
deadline=$((SECONDS + 15))
bound_port=
while ((SECONDS < deadline)); do
    kill -0 "$server_pid" 2>/dev/null || server_failed "owned PHP fixture server exited before binding port $port"
    bound_port=$(sed -nE 's/^.* PHP [^ ]+ Development Server \(http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\) started$/\1/p' "$work/server.log")
    [ -z "$bound_port" ] || break
    sleep 0.1
done
if [ -z "$bound_port" ] || { [ "$port" != 0 ] && [ "$bound_port" != "$port" ]; }; then
    server_failed "owned PHP fixture server did not confirm a listening port for $port"
fi
kill -0 "$server_pid" 2>/dev/null || server_failed 'owned PHP fixture server exited before the readiness request'
base="http://127.0.0.1:$bound_port"
if ! status=$(curl --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 15 --output /dev/null --write-out '%{http_code}' "$base/") \
    || [ "$status" != 200 ] || ! kill -0 "$server_pid" 2>/dev/null; then
    server_failed "owned PHP fixture server readiness failed at $base/ (HTTP ${status:-unavailable})"
fi

"$root/tools/tests/check-fresh-app.sh" "$base" --noproxy '*' || {
    echo "--- routes"; $php bin/console debug:router --no-interaction 2>&1 | head -30 || true
    echo "--- src/Controller"; ls -la src/Controller || true
    echo "--- server log"; tail -20 "$work/server.log" || true
    exit 1
}
kill -0 "$server_pid" 2>/dev/null || server_failed 'owned PHP fixture server exited during HTTP checks'
