<?php

// Run after the consumer app's (packages/uxor/dev/app) Composer install --no-dev; exercise actual Twig and installed PHP.
chdir(__DIR__.'/app');
require 'vendor/autoload.php';

if (Composer\InstalledVersions::isInstalled('xormania/uxor') || Composer\InstalledVersions::isInstalled('symfony/ux-toolkit')) {
    fwrite(STDERR, "Run the fixture's composer install --no-dev before this runtime check.\n");
    exit(1);
}
(new Symfony\Component\Dotenv\Dotenv())->bootEnv('.env');
$kernel = new App\Kernel('prod', false);
$request = Symfony\Component\HttpFoundation\Request::create('/customers');
$response = $kernel->handle($request);
if (200 !== $response->getStatusCode() || !str_contains($response->getContent(), 'customers-row-1') || !str_contains($response->getContent(), 'Ada Lovelace')) {
    fwrite(STDERR, 'Installed UXor components did not render in the production consumer.'.PHP_EOL);
    exit(1);
}
$kernel->terminate($request, $response);
$kernel->shutdown();
echo "Installed UXor PHP and Twig render without development dependencies.\n";
