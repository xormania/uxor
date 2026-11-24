#!/usr/bin/env bash
set -euo pipefail

metadata_checksum() {
    find /workspace -path /workspace/website -prune -o -type f -print0 \
        | sort -z | xargs -0 sha256sum | sha256sum
}

test ! -e /workspace/demo
test ! -e /workspace/packages/uxor/src
metadata_before=$(metadata_checksum)
cd /workspace/website
composer install --no-interaction --no-scripts --prefer-dist --no-progress
php vendor/bin/phpunit

output=$(mktemp -d)
trap 'rm -rf -- "$output"' EXIT
php bin/build "$output" --base-path=/uxor

test -s "$output/index.html"
test -s "$output/composer/index.html"
test -s "$output/r/button/index.html"
test -s "$output/llms.txt"
test ! -e "$output/demo"
test ! -e "$output/preview"
test "$metadata_before" = "$(metadata_checksum)"
