<?php

use Composer\InstalledVersions;
use Consumer\AssetProbe;
use Consumer\Kernel;
use Symfony\Component\HttpFoundation\Request;

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function readJson(string $path): array
{
    return json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
}

function writeJson(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
}

function appSources(): array
{
    $hashes = ['assets/app.js' => hash_file('sha256', 'assets/app.js')];
    foreach (['src', 'templates', 'assets/controllers', 'assets/styles'] as $directory) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if ($file->isFile()) {
                $hashes[$file->getPathname()] = hash_file('sha256', $file->getPathname());
            }
        }
    }
    ksort($hashes);

    return $hashes;
}

function otherLockedPackages(string $package): array
{
    $records = [];
    foreach (readJson('composer.lock')['packages'] as $dependency) {
        if ($dependency['name'] !== $package) {
            $records[$dependency['name']] = [
                'version' => $dependency['version'],
                'source' => $dependency['source'] ?? [],
                'dist' => $dependency['dist'] ?? [],
            ];
        }
    }
    ksort($records);

    return $records;
}

$phase = $argv[1] ?? '';
$pilot = '@xormania/uxor-pilot';
$bundle = 'UXor\\Pilot\\UXorBundle';
$package = 'xormania/uxor-pilot';
$controllers = readJson('assets/controllers.json');
$imports = require 'importmap.php';
$bundles = require 'config/bundles.php';

if ('before' === $phase) {
    check(!isset($bundles[$bundle]), 'Fixture must not register the package bundle itself');
    check(!isset($controllers['controllers'][$pilot]), 'Fixture must not declare package controllers itself');
    check(!isset($imports['@symfony/stimulus-bundle']), 'Fixture must let Flex add the local Stimulus import');
    writeJson('.fixture-source-hashes.json', appSources());
    writeJson('.fixture-original-imports.json', $imports);
    writeJson('.fixture-original-bundles.json', $bundles);
    echo "Before install: package registration and local imports are absent.\n";
    exit;
}

check(readJson('.fixture-source-hashes.json') === appSources(), 'Application PHP, Twig, controller or CSS source changed');
foreach (readJson('.fixture-original-imports.json') as $name => $entry) {
    check(isset($imports[$name]) && $imports[$name] === $entry, 'An application import or shared runtime pin changed: '.$name);
}
foreach (readJson('.fixture-original-bundles.json') as $name => $environments) {
    check(isset($bundles[$name]) && $bundles[$name] === $environments, 'An application bundle registration changed: '.$name);
}

if ('customize' === $phase) {
    $controllers['controllers'][$pilot]['data-table'] = ['enabled' => false, 'fetch' => 'lazy'];
    $controllers['controllers']['@symfony/ux-turbo']['turbo-core']['enabled'] = false;
    $controllers['controllers']['@symfony/ux-turbo']['turbo-core']['fetch'] = 'lazy';
    $controllers['entrypoints']['consumer'] = 'app.js';
    writeJson('assets/controllers.json', $controllers);
    writeJson('.fixture-turbo-policy.json', $controllers['controllers']['@symfony/ux-turbo']);
    echo "Application policy: table disabled, lazy fetch, unrelated Turbo policy and entrypoint customized.\n";
    exit;
}

require __DIR__.'/vendor/autoload.php';
$recipeLock = readJson('symfony.lock');
if ('removed' === $phase) {
    check(!is_dir('vendor/'.$package), 'Package distribution remains after removal');
    check(!isset($bundles[$bundle]), 'Flex did not remove the bundle registration');
    check(!isset($controllers['controllers'][$pilot]), 'Flex did not remove package controllers');
    check(!isset($recipeLock[$package]), 'Flex did not remove the recipe lock entry');
    check($controllers['controllers']['@symfony/ux-turbo'] === readJson('.fixture-turbo-policy.json'), 'Removal changed unrelated controller policy');
    check(($controllers['entrypoints']['consumer'] ?? null) === 'app.js', 'Removal changed the application entrypoint');
    // Flex deliberately does not garbage-collect imports. App adapters still refer to
    // removed PHP classes, so removal checks metadata; the reinstall must render again.
    echo "Removed: distribution, bundle registration, controllers and recipe lock gone; app sources and other policy preserved.\n";
    exit;
}

check(isset($bundles[$bundle]['all']) && true === $bundles[$bundle]['all'], 'Flex recipe did not register the package bundle');
check(isset($recipeLock[$package]['recipe']['ref']), 'No real downloaded recipe was recorded');
check(($recipeLock[$package]['recipe']['repo'] ?? null) === 'local/uxor-recipes', 'The fixture did not use its isolated recipe endpoint');
check(is_file($imports['@symfony/stimulus-bundle']['path'] ?? ''), 'Flex did not register the real local Stimulus loader');
check(!is_dir('vendor/'.$package.'/recipe'), 'Recipe files leaked into the Composer distribution');
if ('installed' === $phase) {
    check(InstalledVersions::getPrettyVersion($package) === '0.0.1', 'Wrong initial package release');
    check($controllers['controllers'][$pilot]['data-table'] === ['enabled' => true, 'fetch' => 'eager'], 'Flex did not discover the package controller defaults');
    check(!isset($controllers['controllers'][$pilot]['fixture-probe']), 'Synthetic upgrade controller appeared before update');
    writeJson('.fixture-recipe.json', $recipeLock[$package]['recipe']);
    writeJson('.fixture-locked-packages.json', otherLockedPackages($package));
} else {
    check(in_array($phase, ['updated', 'repeated', 'reinstalled'], true), 'Unknown fixture phase');
    check(InstalledVersions::getPrettyVersion($package) === '0.0.2', 'Wrong upgraded package release');
    $expectedTable = 'reinstalled' === $phase ? ['enabled' => true, 'fetch' => 'eager'] : ['enabled' => false, 'fetch' => 'lazy'];
    check($controllers['controllers'][$pilot]['data-table'] === $expectedTable, 'Existing application controller choices changed during update, or defaults were not restored on reinstall');
    check($controllers['controllers'][$pilot]['fixture-probe'] === ['enabled' => true, 'fetch' => 'lazy'], 'The synthetic new controller was not discovered automatically');
    $helper = $imports[$pilot.'/fixture-helper']['path'] ?? '';
    check(is_file($helper) && realpath($helper) === realpath('vendor/'.$package.'/assets/lib/fixture-helper.js'), 'Flex did not add the synthetic local import automatically');
    check($recipeLock[$package]['recipe'] === readJson('.fixture-recipe.json'), 'A package update unexpectedly replaced the recipe');
    check($controllers['controllers']['@symfony/ux-turbo'] === readJson('.fixture-turbo-policy.json'), 'Lifecycle changed unrelated controller policy');
    check(($controllers['entrypoints']['consumer'] ?? null) === 'app.js', 'Lifecycle changed the application entrypoint');
    if ('reinstalled' !== $phase) {
        check(otherLockedPackages($package) === readJson('.fixture-locked-packages.json'), 'Metadata upgrade changed unrelated locked dependencies');
    }
}

$kernel = new Kernel('prod', false);
foreach ([['/orders', 'ORD-001', 'ORD-002'], ['/orders?q=Bob', 'ORD-002', 'ORD-001']] as [$url, $present, $absent]) {
    $request = Request::create($url);
    $response = $kernel->handle($request);
    check(200 === $response->getStatusCode(), 'Container, autowiring or package rendering failed: '.$url);
    $html = $response->getContent();
    check(str_contains($html, $present) && !str_contains($html, $absent), 'Autowired application repository/table did not supply the expected row');
    check(str_contains($html, 'data-invoice') && str_contains($html, 'data-customer'), 'Application cell slots were not rendered');
    check(str_contains($html, 'data-consumer="flex-fixture"'), 'Component attributes were not forwarded');
    check(!str_contains($html, 'data-wrong-local-button'), 'Package nested component collided with the application namespace');
    check(!str_contains($html, '<script>alert(1)</script>'), 'Application content was not escaped');
    if ('ORD-001' === $present) {
        check(str_contains($html, 'Alice &lt;script&gt;alert(1)&lt;/script&gt;'), 'Autowired repository content missing');
    }
    $kernel->terminate($request, $response);
}
$loader = $kernel->getContainer()->get(AssetProbe::class)->controllerLoader();
check(str_contains($loader, '"application"'), 'Native Stimulus discovery lost the application controller');
$enabled = in_array($phase, ['installed', 'reinstalled'], true);
check(str_contains($loader, '"xormania--uxor-pilot--data-table"') === $enabled, 'Generated Stimulus loader did not honor package controller enablement');
if ('installed' !== $phase) {
    check(str_contains($loader, '"xormania--uxor-pilot--fixture-probe": () => import('), 'Generated Stimulus loader did not discover the new lazy controller');
}
$kernel->shutdown();
echo ucfirst($phase).": Flex registration, private app provider autowiring, package Twig namespace and generated controller loader passed.\n";
