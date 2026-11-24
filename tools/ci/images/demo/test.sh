#!/usr/bin/env bash
set -euo pipefail

test ! -e /workspace/website
test ! -e /workspace/packages/uxor
test ! -e /workspace/demo/tests
test ! -e /workspace/demo/assets/styles/toolkit-fixtures.css

cd /workspace/demo
export APP_ENV=prod APP_DEBUG=0 UXOR_DEMO_ALLOW_PRODUCTION=1
APP_SECRET=$(php -r 'echo bin2hex(random_bytes(32));')
export APP_SECRET

php ../tools/sync-demo
composer install --no-interaction --no-scripts --prefer-dist --no-progress --no-dev
composer dump-autoload --classmap-authoritative --no-dev

# The release demo and Toolkit fixture still share routing and console configuration. Select the
# demo's actual stylesheet in this staged copy so AssetMapper can compile only the demo assets.
php <<'PHP'
<?php
use Symfony\Component\Yaml\Yaml;

require 'vendor/autoload.php';
$file = 'config/packages/symfonycasts_tailwind.yaml';
$configuration = Yaml::parseFile($file);
$entrypoint = '%kernel.project_dir%/assets/styles/demo-app.css';
if (!in_array($entrypoint, $configuration['symfonycasts_tailwind']['input_css'] ?? [], true)) {
    throw new RuntimeException('The demo stylesheet is missing from the application configuration.');
}
$configuration['symfonycasts_tailwind']['input_css'] = [$entrypoint];
file_put_contents($file, Yaml::dump($configuration, 4));
PHP

composer run-script --no-dev post-install-cmd
php bin/console tailwind:build assets/styles/demo-app.css --minify --no-interaction
php bin/console asset-map:compile --no-interaction

server_log=$(mktemp)
php -S 127.0.0.1:8080 -t public >"$server_log" 2>&1 &
server=$!
cleanup() {
    local status=$?
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
    if (( status != 0 )); then cat "$server_log" >&2; fi
    rm -f -- "$server_log"
}
trap cleanup EXIT

php <<'PHP'
<?php
for ($attempt = 0; $attempt < 100; ++$attempt) {
    $connection = @fsockopen('127.0.0.1', 8080, timeout: 0.1);
    if (false !== $connection) {
        fclose($connection);
        break;
    }
    usleep(100_000);
}
if (100 === $attempt) {
    throw new RuntimeException('The demo server did not start.');
}

$context = stream_context_create(['http' => ['follow_location' => 0, 'timeout' => 15]]);
function getDemoPage(string $route, $context): string
{
    $body = file_get_contents('http://127.0.0.1:8080'.$route, context: $context);
    $headers = http_get_last_response_headers();
    if (false === $body || !preg_match('/^HTTP\/\d\.\d 200 /', $headers[0] ?? '')) {
        throw new RuntimeException('The demo did not render '.$route.'.');
    }
    return $body;
}

$dashboard = getDemoPage('/demo', $context);
if (!str_contains($dashboard, 'Dashboard — xor') || !str_contains(getDemoPage('/demo/login', $context), 'Sign in — xor')) {
    throw new RuntimeException('The demo dashboard or sign-in page has the wrong title.');
}
if (!preg_match('~href="(/assets/styles/demo-app-[a-zA-Z0-9_-]+\.css)"~', $dashboard, $style)
    || !str_contains(getDemoPage($style[1], $context), '.xor-avatar')) {
    throw new RuntimeException('The demo dashboard did not serve the compiled demo stylesheet.');
}
PHP
