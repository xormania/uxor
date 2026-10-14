#!/usr/bin/env bash
# Runs in an image with PHP >=8.4, Composer, Node, Python and Tailwind 4.3.3. Only /fixture and /dist are mounted.
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R /fixture/. "$work/"
cd "$work"
python3 - <<'PY'
import json, zipfile
from pathlib import Path
with zipfile.ZipFile('/dist/uxor-pilot.zip') as archive:
    package = json.loads(archive.read('composer.json'))
package.update(version='0.0.1', dist={'type': 'zip', 'url': 'file:///dist/uxor-pilot.zip', 'reference': 'pilot'})
path = Path('composer.json')
app = json.loads(path.read_text())
app['repositories'] = [{'type': 'package', 'package': package}]
path.write_text(json.dumps(app, indent=4))
PY
composer install --no-interaction --no-progress --prefer-dist
# Exact root constraints are intentional regression inputs; still validate schema and lock agreement.
composer validate --strict --no-check-publish --no-check-all
(cd vendor/xormania/uxor-pilot && composer validate --strict --no-check-publish)
php bin/console cache:warmup
php bin/console importmap:install
tailwindcss -i assets/styles/app.css -o assets/styles/compiled.css --minify
mv assets/styles/compiled.css assets/styles/app.css
php bin/console asset-map:compile
php check.php
