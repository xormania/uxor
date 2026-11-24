#!/usr/bin/env bash
set -euo pipefail

dev=$(cd "$(dirname "$0")" && pwd)
python3 "$dev/run.py" --native prepare --no-assets
python3 "$dev/check-headless.py" "$dev/app"
python3 "$dev/install-uxor.py"
(cd "$dev" && npm run test:request-only && npm run test:workflow)

# With the Toolkit and development package removed, the installed recipe files must still render.
python3 "$dev/run.py" --native exec composer install --no-dev --prefer-dist --no-interaction --no-progress
python3 "$dev/run.py" --native exec php bin/console cache:clear --env=prod --no-debug --no-interaction
python3 "$dev/run.py" --native exec php "$dev/check-workflow-runtime.php"
