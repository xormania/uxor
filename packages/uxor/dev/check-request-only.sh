#!/usr/bin/env bash
# A consumer can import the generated fixture in an API-only suite without installing a browser.
set -euo pipefail

dev=$(cd "$(dirname "$0")" && pwd)
project=$(mktemp -d)
trap 'rm -rf "$project"' EXIT
cd "$project"
printf '{}\n' > composer.json
mkdir -p vendor/xormania
ln -s "$dev/app/vendor/xormania/uxor" vendor/xormania/uxor
ln -s "$dev/node_modules" node_modules
# The temporary project intentionally has none of the optional development tools.
status=0
"${PHP_BIN:-php}" "$dev/app/vendor/bin/uxor" setup --apply --format=json > setup.json || status=$?
if (( status != 0 && status != 2 )); then cat setup.json; exit "$status"; fi

cat > request-only.spec.mjs <<'JS'
import { test, expect } from './.uxor/browser.mjs';

test.use({ baseURL: 'http://127.0.0.1', launchOptions: { executablePath: '/no-browser-installed/chromium' } });
test('a request-only test runs with diagnostics disabled', async ({ request }) => {
    expect((await request.storageState()).cookies).toEqual([]);
});
JS
PROFILER_COLLECT=0 node_modules/.bin/playwright test request-only.spec.mjs --workers=1 --reporter=line "$@"
