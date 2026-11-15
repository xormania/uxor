#!/usr/bin/env php
<?php

/** Installed metadata discovery uses Composer paths, rereads files and fails on malformed UX metadata. */

use Composer\Autoload\ClassLoader;
use Composer\InstalledVersions;
use Symfony\Component\AssetMapper\AssetMapperRepository;
use Symfony\Component\AssetMapper\ImportMap\ImportMapConfigReader;
use Symfony\Component\AssetMapper\ImportMap\RemotePackageStorage;
use Symfony\Component\Console\Tester\CommandTester;
use UXor\Pilot\Asset\FrontendAssets;
use UXor\Pilot\Asset\FrontendContractValidator;
use UXor\Pilot\Asset\InstalledFrontendPackages;
use UXor\Pilot\Asset\StableNpmRange;
use UXor\Pilot\Asset\ValidateFrontendAssetsCommand;

function verifyFrontendReader(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

verifyFrontendReader(2 === $argc && is_file($argv[1]), 'Usage: php tools/tests/frontend-reader.php AUTOLOAD');
require $argv[1];
foreach (['InstalledFrontendPackages', 'StableNpmRange', 'FrontendContractValidator', 'FrontendAssets', 'ValidateFrontendAssetsCommand'] as $class) {
    require dirname(__DIR__, 2).'/packages/uxor-pilot/src/Asset/'.$class.'.php';
}

$work = sys_get_temp_dir().'/uxor-frontend-reader-'.bin2hex(random_bytes(8));
mkdir($work, 0700);
$installed = InstalledVersions::getAllRawData()[0];
$loader = new ClassLoader($work.'/custom-vendor');
$shadowLoader = new ClassLoader($work.'/shadow-vendor');
try {
    foreach (['local', 'plain', 'php-only'] as $directory) {
        mkdir($work.'/'.$directory.'/assets', 0700, true);
    }
    mkdir($work.'/local/Resources/assets', 0700, true);
    mkdir($work.'/local/src/Resources/assets', 0700, true);
    // Package-repository ZIPs need not ship composer.json: registry metadata owns UX membership.
    file_put_contents($work.'/plain/assets/package.json', 'not json; a non-UX package is ignored');
    file_put_contents($work.'/local/assets/package.json', '{"symfony":{"importmap":{"shared-peer":"^1.0.0"}}}');
    file_put_contents($work.'/local/Resources/assets/package.json', '{"location":"legacy"}');
    file_put_contents($work.'/local/src/Resources/assets/package.json', '{"location":"oldest"}');
    symlink($work.'/local', $work.'/composer-install-link');
    $versions = [];
    foreach (['local' => 'composer-install-link', 'plain' => 'plain', 'php-only' => 'php-only'] as $name => $path) {
        $versions['uxor-research/'.$name] = [
            'pretty_version' => '1.2.3', 'version' => '1.2.3.0', 'reference' => 'fixture-reference',
            'type' => 'library', 'install_path' => $work.'/'.$path, 'dev_requirement' => false,
        ];
    }
    $versions['uxor-research/virtual'] = ['provided' => ['1.0'], 'dev_requirement' => false];
    mkdir($work.'/custom-vendor/composer', 0700, true);
    $records = [];
    foreach (['local' => 'composer-install-link', 'plain' => 'plain', 'php-only' => 'php-only'] as $name => $path) {
        $records[] = ['name' => 'uxor-research/'.$name, 'install-path' => '../../'.$path, 'keywords' => 'plain' === $name ? [] : ['symfony-ux']];
    }
    $registryPath = $work.'/custom-vendor/composer/installed.json';
    file_put_contents($registryPath, json_encode(['packages' => $records], JSON_THROW_ON_ERROR));
    file_put_contents($work.'/custom-vendor/composer/installed.php', '<?php return '.var_export(['root' => $installed['root'], 'versions' => $versions], true).';');
    $loader->register(true);
    InstalledVersions::reload(['root' => $installed['root'], 'versions' => $versions]);
    $reader = new InstalledFrontendPackages();
    $readFixture = static fn (): array => array_values(array_filter($reader->read(), static fn (array $package): bool => str_starts_with($package['owner'], 'uxor-research/')));
    $packages = $readFixture();
    verifyFrontendReader(1 === count($packages), 'Non-UX, PHP-only or virtual packages participated in discovery');
    verifyFrontendReader($work.'/local' === $packages[0]['packagePath'], 'Composer custom/symlink install path was not canonicalized');
    verifyFrontendReader($work.'/local/assets/package.json' === $packages[0]['metadataPath'], 'Flex metadata path precedence changed');
    verifyFrontendReader('1.2.3' === $packages[0]['version'] && 'fixture-reference' === $packages[0]['reference'], 'Installed release identity was lost');

    mkdir($work.'/shadow-vendor/composer', 0700, true);
    mkdir($work.'/shadow-package/assets', 0700, true);
    file_put_contents($work.'/shadow-package/assets/package.json', '{"location":"shadow"}');
    $shadowVersion = $versions['uxor-research/local'];
    $shadowVersion['install_path'] = $work.'/shadow-package';
    $shadowVersion['pretty_version'] = '9.0.0';
    file_put_contents($work.'/shadow-vendor/composer/installed.php', '<?php return '.var_export(['root' => $installed['root'], 'versions' => ['uxor-research/local' => $shadowVersion]], true).';');
    file_put_contents($work.'/shadow-vendor/composer/installed.json', json_encode(['packages' => [
        ['name' => 'uxor-research/local', 'install-path' => '../../shadow-package', 'keywords' => ['symfony-ux']],
    ]], JSON_THROW_ON_ERROR));
    $shadowLoader->register();
    verifyFrontendReader($packages === $readFixture(), 'An inactive copy from a second Composer loader contributed metadata');
    $shadowLoader->unregister();
    $shadowLoader->register(true);
    verifyFrontendReader('9.0.0' === $readFixture()[0]['version'] && 'shadow' === $readFixture()[0]['metadata']['location'], 'Reader did not follow Composer active-package precedence');
    $shadowLoader->unregister();

    file_put_contents($work.'/local/assets/package.json', '{"symfony":{"importmap":{"shared-peer":"^2.0.0"}}}');
    verifyFrontendReader('^2.0.0' === $readFixture()[0]['metadata']['symfony']['importmap']['shared-peer'], 'Metadata was cached across validation reads');
    foreach (['not json', '[]', 'null', '{"symfony":[]}', '{"symfony":{"importmap":[]}}', '{"peerDependencies":[]}', '{"peerDependenciesMeta":{"shared-peer":[]}}', '{"symfony":{"importmap":{"shared-peer":[]}}}'] as $invalid) {
        file_put_contents($work.'/local/assets/package.json', $invalid);
        try {
            $readFixture();
            throw new LogicException('Malformed preferred metadata was silently ignored');
        } catch (RuntimeException $error) {
            verifyFrontendReader(str_contains($error->getMessage(), 'uxor-research/local'), 'Malformed metadata diagnostic omitted its owner');
        }
    }
    unlink($work.'/local/assets/package.json');
    verifyFrontendReader('legacy' === $readFixture()[0]['metadata']['location'], 'Resources/assets fallback was not discovered');
    unlink($work.'/local/Resources/assets/package.json');
    verifyFrontendReader('oldest' === $readFixture()[0]['metadata']['location'], 'src/Resources/assets fallback was not discovered');

    file_put_contents($work.'/outside.json', '{}');
    symlink($work.'/outside.json', $work.'/local/assets/package.json');
    try {
        $readFixture();
        throw new LogicException('Metadata outside the installed package was accepted');
    } catch (RuntimeException $error) {
        verifyFrontendReader(str_contains($error->getMessage(), 'inside its installed package'), 'Escaped metadata diagnostic changed');
    }
    unlink($work.'/local/assets/package.json');
    rename($registryPath, $registryPath.'.backup');
    try {
        $readFixture();
        throw new LogicException('Missing installed.json silently removed UX owners');
    } catch (RuntimeException $error) {
        verifyFrontendReader(str_contains($error->getMessage(), 'registry') && str_contains($error->getMessage(), 'missing'), 'Missing registry diagnostic changed');
    }
    rename($registryPath.'.backup', $registryPath);
    foreach (['{"packages":{}}', '{"packages":[{"name":"uxor-research/local","keywords":null}]}', '{"packages":[{"name":"uxor-research/local","keywords":{}}]}'] as $invalid) {
        file_put_contents($registryPath, $invalid);
        try {
            $readFixture();
            throw new LogicException('Malformed registry shape silently removed UX owners');
        } catch (RuntimeException $error) {
            verifyFrontendReader(str_contains($error->getMessage(), 'registry'), 'Malformed registry diagnostic changed');
        }
    }
    $records[0]['keywords'] = 'symfony-ux';
    file_put_contents($registryPath, json_encode(['packages' => $records], JSON_THROW_ON_ERROR));
    try {
        $readFixture();
        throw new LogicException('Malformed Composer keyword metadata was accepted');
    } catch (RuntimeException $error) {
        verifyFrontendReader(str_contains($error->getMessage(), 'keywords'), 'Keyword shape diagnostic changed');
    }
    $records[0]['keywords'] = ['symfony-ux'];
    file_put_contents($registryPath, json_encode(['packages' => $records], JSON_THROW_ON_ERROR));
    foreach (["['peer' => 'invalid']", "['peer' => ['version' => []]]", "['peer' => ['unknown' => 'value']]"] as $invalid) {
        file_put_contents($work.'/importmap.php', '<?php return '.$invalid.';');
        $assets = new FrontendAssets($reader, new ImportMapConfigReader($work.'/importmap.php', new RemotePackageStorage($work.'/downloaded')), new AssetMapperRepository([], $work), new FrontendContractValidator(new StableNpmRange()));
        $command = new CommandTester(new ValidateFrontendAssetsCommand($assets));
        verifyFrontendReader(1 === $command->execute(['--json' => true]), 'Malformed import map was accepted by the command');
        $diagnostic = json_decode($command->getDisplay(), true, flags: JSON_THROW_ON_ERROR);
        verifyFrontendReader(false === $diagnostic['valid'] && str_contains($diagnostic['error'], 'Invalid import-map configuration'), 'Malformed import map did not produce a JSON diagnostic');
    }
    echo "Frontend reader: installed paths, loader precedence, fresh reads, malformed metadata and command diagnostics passed.\n";
} finally {
    $shadowLoader->unregister();
    $loader->unregister();
    InstalledVersions::reload($installed);
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($work, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) {
        $file->isDir() && !$file->isLink() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    }
    rmdir($work);
}
