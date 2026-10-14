<?php

// Manual research probe: record Flex's decisions without executing console commands or making network requests.
// Usage: php docs/research/flex-importmap-conflict.php demo/vendor/autoload.php /path/to/composer.phar

use Composer\IO\NullIO;
use Composer\InstalledVersions;
use Symfony\Flex\PackageJsonSynchronizer;
use Symfony\Flex\ScriptExecutor;

if (3 !== $argc || !is_file($argv[1]) || !is_file($argv[2])) {
    fwrite(STDERR, "Usage: php flex-importmap-conflict.php /path/to/vendor/autoload.php /path/to/composer.phar\n");
    exit(1);
}

Phar::loadPhar($argv[2], 'composer.phar');
require 'phar://composer.phar/vendor/autoload.php';
require $argv[1];

if (!class_exists(PackageJsonSynchronizer::class)) {
    fwrite(STDERR, "The supplied application autoloader must provide symfony/flex.\n");
    exit(1);
}

final class UXorResearchRecordingExecutor extends ScriptExecutor
{
    public array $calls = [];

    public function __construct()
    {
    }

    public function execute(string $type, string $cmd, array $arguments = [])
    {
        $this->calls[] = compact('type', 'cmd', 'arguments');
    }
}

echo json_encode(['flex' => InstalledVersions::getPrettyVersion('symfony/flex')], JSON_THROW_ON_ERROR), "\n";

$fixture = sys_get_temp_dir().'/uxor-flex-research-'.bin2hex(random_bytes(8));
if (!mkdir($fixture, 0700)) {
    throw new RuntimeException('Could not create the temporary research fixture.');
}

try {
    $packages = [
        ['name' => 'research/one', 'keywords' => ['symfony-ux']],
        ['name' => 'research/two', 'keywords' => ['symfony-ux']],
    ];

    foreach (['research/one' => '^1.0', 'research/two' => '^2.0'] as $name => $constraint) {
        $assets = $fixture.'/vendor/'.$name.'/assets';
        mkdir($assets, 0700, true);
        file_put_contents($assets.'/package.json', json_encode([
            'symfony' => ['importmap' => ['shared-peer' => $constraint]],
        ], JSON_THROW_ON_ERROR));
    }

    foreach ([
        ['order' => 'one then two', 'packages' => $packages],
        ['order' => 'two then one', 'packages' => array_reverse($packages)],
    ] as $case) {
        file_put_contents($fixture.'/importmap.php', "<?php return ['shared-peer' => ['version' => '1.5.0']];\n");
        $executor = new UXorResearchRecordingExecutor();
        $synchronizer = new PackageJsonSynchronizer($fixture, 'vendor', $executor, new NullIO());
        $synchronizer->synchronize($case['packages']);
        echo json_encode(['case' => $case['order'], 'calls' => $executor->calls], JSON_THROW_ON_ERROR), "\n";
    }
} finally {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($fixture, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST,
    );
    foreach ($files as $file) {
        $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    }
    rmdir($fixture);
}
