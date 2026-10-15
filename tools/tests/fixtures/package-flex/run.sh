#!/usr/bin/env bash
# Runs natively or in Docker; the consumer only sees distribution archives and its fixture.
set -euo pipefail
fixture=$(cd "$(dirname "$0")" && pwd)
dist=$(cd "${1:?Pass the distribution archive directory}" && pwd)
work=$(mktemp -d)
server_pid=
cleanup() {
    if [ -n "$server_pid" ]; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
    rm -rf "$work"
}
trap cleanup EXIT
mkdir "$work/app"
cp -R "$fixture/." "$work/app/"
# Keep Composer's secure-http and peer verification enabled. Only Flex's isolated
# recipe downloader trusts this ephemeral loopback certificate; package downloads
# retain the environment's normal CA trust.
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 \
    -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 \
    -keyout "$work/key.pem" -out "$work/cert.pem" >"$work/certificate.log" 2>&1
export SYMFONY_CAFILE="$work/cert.pem"
python3 "$fixture/serve-recipes.py" "$dist" "$work/endpoint" "$work/app" "$work/ready" "$work/cert.pem" "$work/key.pem" &
server_pid=$!
for _attempt in {1..100}; do
    [ -f "$work/ready" ] && break
    kill -0 "$server_pid" 2>/dev/null || { echo 'Local recipe endpoint failed' >&2; exit 1; }
    sleep 0.1
done
[ -f "$work/ready" ] || { echo 'Local recipe endpoint did not start' >&2; exit 1; }
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
export no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"
export COMPOSER_ALLOW_SUPERUSER=1
cd "$work/app"
# Start with Flex already active, as in an existing Symfony application. Installing
# Flex itself and all bundles in one transaction can synchronize an existing importmap
# before Flex's own bootstrap reinstall has registered the bundles.
cp composer.json "$work/application-composer.json"
mv importmap.php "$work/application-importmap.php"
python3 - <<'PY'
import json
from pathlib import Path
path = Path('composer.json')
app = json.loads(path.read_text())
app['require'] = {name: version for name, version in app['require'].items() if name in ('php', 'symfony/flex')}
path.write_text(json.dumps(app, indent=4) + '\n')
PY
composer install --no-interaction --no-progress --prefer-dist
mv "$work/application-composer.json" composer.json
mv "$work/application-importmap.php" importmap.php
php frontend-check.php initialize

validate_frontend() {
    local phase=$1 version=$2
    php frontend-check.php snapshot "$work/frontend-$phase-before.json"
    if ! php bin/console uxor:assets:validate --json > "$work/frontend-$phase.json"; then
        cat "$work/frontend-$phase.json" >&2
        return 1
    fi
    php frontend-check.php valid "$work/frontend-$phase.json" "$work/frontend-$phase-before.json" "$version"
}

php check.php before
composer update --no-interaction --no-progress --prefer-dist
composer validate --strict --no-check-publish --no-check-all
rm -rf var/cache
php check.php installed
validate_frontend installed 0.0.1
php check.php customize
composer require xormania/uxor-pilot:0.0.2 --no-interaction --no-progress --prefer-dist
rm -rf var/cache
php check.php updated
validate_frontend updated 0.0.2
composer install --no-interaction --no-progress --prefer-dist
rm -rf var/cache
php check.php repeated
validate_frontend repeated 0.0.2
composer remove xormania/uxor-pilot --no-interaction --no-progress
php check.php removed
composer require xormania/uxor-pilot:0.0.2 --no-interaction --no-progress --prefer-dist
rm -rf var/cache
php check.php reinstalled
validate_frontend reinstalled 0.0.2

# Composer may already have changed vendor/lock state when installation scripts are
# skipped. The build guard protects the existing frontend records and published
# outputs; it does not claim to roll back that earlier Composer transaction.
php frontend-check.php prepare-conflict "$work/frontend-before-no-scripts.json"
composer require xormania/uxor-pilot:0.0.3 --no-scripts --no-interaction --no-progress --prefer-dist
php frontend-check.php conflict-installed "$work/frontend-before-no-scripts.json" "$work/frontend-conflict-state.json"
if php bin/console uxor:assets:validate --json > "$work/frontend-conflict.json" 2> "$work/frontend-conflict-stderr.log"; then
    echo 'Frontend validation unexpectedly accepted the incompatible installed package' >&2
    exit 1
else
    status=$?
    if [ "$status" -ne 1 ]; then
        cat "$work/frontend-conflict-stderr.log" >&2
        echo "Frontend validation returned unexpected status $status" >&2
        exit 1
    fi
fi
if php bin/console asset-map:compile --no-ansi > "$work/frontend-compile-conflict.log" 2>&1; then
    echo 'AssetMapper unexpectedly compiled incompatible frontend requirements' >&2
    exit 1
fi
php frontend-check.php rejected "$work/frontend-conflict.json" "$work/frontend-compile-conflict.log" "$work/frontend-conflict-state.json"
composer require xormania/uxor-pilot:0.0.2 --no-interaction --no-progress --prefer-dist
rm -rf var/cache
php check.php reinstalled
validate_frontend restored 0.0.2
echo 'Flex lifecycle and frontend build validation passed, including skipped-script conflict rejection and restoration; no browser or Tailwind build.'
