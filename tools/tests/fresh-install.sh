#!/usr/bin/env bash
# On a fresh Symfony skeleton, `ux:install dashboard-home` (which brings `layouts`) from this
# kit, as GitHub's archive gives it, yields a working dashboard page; `ux:install signup` yields a form rendered
# through the form theme without any `twig.form_themes` setting.
#
#   tools/tests/fresh-install.sh            # PHP=… COMPOSER_BIN=… to use other binaries
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
php="${PHP:-php}"
composer="${COMPOSER_BIN:-composer}"
symfony_version="${SYMFONY_VERSION:-7.4.*}"
port="${PORT:-8100}"
work="$(mktemp -d)"
server_pid=
cleanup() { [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true; rm -rf "$work"; }
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

$php -S "127.0.0.1:$port" -t public > "$work/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 1; done

"$root/tools/tests/check-fresh-app.sh" "http://127.0.0.1:$port" || {
    echo "--- routes"; $php bin/console debug:router --no-interaction 2>&1 | head -30 || true
    echo "--- src/Controller"; ls -la src/Controller || true
    echo "--- server log"; tail -20 "$work/server.log" || true
    exit 1
}
