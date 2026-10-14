#!/usr/bin/env bash
# The app cannot access the checkout or demo vendor tree. Archives, fixture, cache and reports are explicit mounts.
set -euo pipefail
work=$(mktemp -d)
server_pid=
cleanup() {
    if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
    rm -rf "$work"
}
trap cleanup EXIT
cp -R /fixture/. "$work/"
cd "$work"
mkdir -p assets/styles /reports
python3 - <<'PY'
import hashlib, json, zipfile
from pathlib import Path
plan = json.loads(Path('/dist/releases.json').read_text())
packages = []
for version in (plan['baseline_version'], plan['upgrade_version']):
    path = Path(f'/dist/uxor-pilot-{version}.zip')
    with zipfile.ZipFile(path) as archive:
        package = json.loads(archive.read('composer.json'))
    package.update(version=version, dist={'type': 'zip', 'url': path.as_uri(), 'reference': version, 'shasum': hashlib.sha1(path.read_bytes()).hexdigest()})
    packages.append(package)
path = Path('composer.json')
app = json.loads(path.read_text())
app['repositories'] = [{'type': 'package', 'package': packages}]
path.write_text(json.dumps(app, indent=4))
PY
python3 consumer-state.py > /reports/application-source-before.json
if [ -n "${PILOT_BROWSER_CONTAINER:-}" ]; then
    npm --prefix browser install --ignore-scripts --no-audit --no-fund --cache /home/dev/.cache/npm
fi

validate_release() {
    local version=$1 phase=$2
    # Exact root constraints are intentional regression inputs; still validate schema and lock agreement.
    composer validate --strict --no-check-publish --no-check-all
    (cd vendor/xormania/uxor-pilot && COMPOSER_ROOT_VERSION="$version" composer validate --strict --no-check-publish)
    # These are generated artifacts only; source CSS remains outside assets and is fingerprinted.
    rm -rf var/cache public/assets
    php bin/console cache:warmup
    php bin/console importmap:install
    tailwindcss -i styles/app.css -o assets/styles/app.css --minify
    php bin/console asset-map:compile
    php check.php "$version"
    python3 consumer-state.py > /reports/application-source-after.json
    cmp /reports/application-source-before.json /reports/application-source-after.json
    python3 - "$phase" <<'PY'
import json, sys
from pathlib import Path
packages = {p['name']: {'version': p['version'], 'source_reference': p.get('source', {}).get('reference'),
    'dist_reference': p.get('dist', {}).get('reference')} for p in json.loads(Path('composer.lock').read_text())['packages']}
Path(f'/reports/dependencies-{sys.argv[1]}.json').write_text(json.dumps(packages, sort_keys=True))
if sys.argv[1] != 'baseline':
    before = json.loads(Path('/reports/dependencies-baseline.json').read_text())
    before.pop('xormania/uxor-pilot')
    packages.pop('xormania/uxor-pilot')
    if before != packages:
        raise SystemExit('Upgrade changed unrelated dependency selections')
PY
    if [ -n "${PILOT_BROWSER_CONTAINER:-}" ]; then
        local port=${PILOT_PORT:-8187}
        php -S "127.0.0.1:$port" -t public > "/reports/server-$phase.log" 2>&1 &
        server_pid=$!
        local ready=0
        for _ in $(seq 1 30); do
            if curl --fail --silent --noproxy '*' "http://127.0.0.1:$port/orders" > /dev/null; then ready=1; break; fi
            sleep 1
        done
        [ "$ready" = 1 ] || { echo 'Consumer server did not become ready' >&2; exit 1; }
        PILOT_PHASE="$phase" PILOT_RELEASE="$version" PILOT_PORT="$port" browser/node_modules/.bin/playwright test --config browser/playwright.config.mjs
        kill "$server_pid"
        wait "$server_pid" 2>/dev/null || true
        server_pid=
    else
        echo "Browser checks for $phase: UNRUN (set PILOT_BROWSER_CONTAINER)."
    fi
}

composer update --with xormania/uxor-pilot:0.0.1 --no-interaction --no-progress --prefer-dist
validate_release 0.0.1 baseline
composer update xormania/uxor-pilot:0.0.2 --no-interaction --no-progress --prefer-dist
validate_release 0.0.2 upgrade
composer update xormania/uxor-pilot:0.0.1 --no-interaction --no-progress --prefer-dist
validate_release 0.0.1 rollback
python3 - <<'PY'
import hashlib, json
from pathlib import Path
plan = json.loads(Path('/dist/releases.json').read_text())
reports = {}
for phase in ('baseline', 'upgrade', 'rollback'):
    report = Path(f'/reports/browser-{phase}.json')
    reports[phase] = json.loads(report.read_text())['stats'] if report.exists() else None
    if reports[phase] is not None and (reports[phase]['unexpected'] or reports[phase]['skipped'] or reports[phase]['expected'] == 0):
        raise SystemExit(f'Incomplete browser validation for {phase}')
plan.update(application_source_unchanged=True, application_source_sha256=hashlib.sha256(Path('/reports/application-source-before.json').read_bytes()).hexdigest(), browser_reports=reports)
Path('/reports/upgrade-receipt.json').write_text(json.dumps(plan, indent=4))
PY
echo 'Package upgrade and rollback passed with unchanged application source and unrelated dependency selections.'
