#!/usr/bin/env bash
set -euo pipefail

# Use the package's lock and bundled references from the isolated test checkout.
export COMPOSER_ALLOW_SUPERUSER=1
composer validate --check-lock --no-ansi
composer install --no-interaction --no-progress --prefer-dist --no-plugins --no-scripts
php packages/uxor/tools/generate-command-guide.php --check
composer --no-plugins test

# shellcheck disable=SC2016 # PHP reads its own variable references.
php packages/uxor/bin/uxor component modal --format=json | php -r '
    $result = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    if (($result["status"] ?? null) !== "completed" || ($result["data"]["name"] ?? null) !== "modal") {
        fwrite(STDERR, "The package CLI did not return the modal reference.\n");
        exit(1);
    }
'
