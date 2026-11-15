<?php

/** Assertions around real console processes; no validator implementation is duplicated here. */

function frontendCheck(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function frontendJson(string $path): array
{
    return json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
}

function frontendWriteJson(string $path, array $value): void
{
    file_put_contents($path, json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
}

function frontendSnapshot(): array
{
    $application = [];
    foreach (['importmap.php', 'symfony.lock'] as $path) {
        $application[$path] = is_file($path) ? hash_file('sha256', $path) : null;
    }
    foreach (['src', 'templates', 'config', 'assets', 'styles', 'public/assets'] as $directory) {
        if (!is_dir($directory)) {
            continue;
        }
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if ($file->isFile()) {
                $application[$file->getPathname()] = hash_file('sha256', $file->getPathname());
            }
        }
    }
    ksort($application);
    $composer = [];
    foreach (['composer.json', 'composer.lock'] as $path) {
        $composer[$path] = hash_file('sha256', $path);
    }

    return ['application' => $application, 'composer' => $composer];
}

$phase = $argv[1] ?? '';
if ('initialize' === $phase) {
    // Source CSS gives byte-preservation checks a real stylesheet. This fixture
    // tests ownership and dependency validation, not Tailwind output or appearance.
    mkdir('assets/styles', recursive: true);
    file_put_contents('assets/styles/frontend-contract-fixture.css', ":root { --fixture-brand: #123456; }\n");
    exit;
}

if ('snapshot' === $phase) {
    frontendWriteJson($argv[2], frontendSnapshot());
    exit;
}

if ('prepare-conflict' === $phase) {
    mkdir('public/assets', recursive: true);
    foreach (['manifest.json', 'importmap.json', 'entrypoint.app.json'] as $name) {
        frontendWriteJson('public/assets/'.$name, ['fixture' => 'Preserve the previous published '.$name]);
    }
    file_put_contents('public/assets/published-fixture.css', ":root { --published-before-conflict: 1; }\n");
    frontendWriteJson($argv[2], frontendSnapshot());
    exit;
}

require __DIR__.'/vendor/autoload.php';
$package = 'xormania/uxor-pilot';
$installedVersion = Composer\InstalledVersions::getPrettyVersion($package);

if ('conflict-installed' === $phase) {
    $before = frontendJson($argv[2]);
    $after = frontendSnapshot();
    frontendCheck('0.0.3' === $installedVersion, 'Composer did not install the incompatible fixture release');
    frontendCheck($after['application'] === $before['application'], 'Skipped-script installation changed application source, frontend records or compiled outputs');
    frontendCheck($after['composer'] !== $before['composer'], 'Fixture must demonstrate that Composer state changed before build validation');
    $imports = require 'importmap.php';
    frontendCheck('3.2.2' === ($imports['@hotwired/stimulus']['version'] ?? null), 'Fixture did not preserve the application-selected Stimulus runtime');
    $metadata = frontendJson('vendor/'.$package.'/assets/package.json');
    frontendCheck('^4.0.0' === ($metadata['peerDependencies']['@hotwired/stimulus'] ?? null), 'The installed package does not contain the conflicting peer requirement');
    frontendCheck('^3.2.2' === ($metadata['symfony']['importmap']['@hotwired/stimulus'] ?? null), 'The conflict fixture must preserve the compatible Flex importmap declaration');
    frontendWriteJson($argv[3], $after);
    echo "Root scripts skipped: package and Composer state changed; frontend selections, app sources and published outputs did not.\n";
    exit;
}

if ('valid' === $phase) {
    $report = frontendJson($argv[2]);
    frontendCheck(frontendSnapshot() === frontendJson($argv[3]), 'Read-only frontend validation changed application or Composer files');
    frontendCheck(($report['format'] ?? null) === 1 && isset($report['packages'], $report['imports']), 'Frontend command did not return its successful machine-readable report');
    frontendCheck($installedVersion === $argv[4], 'Validation ran against the wrong package version');
    $packages = array_column($report['packages'], null, 'owner');
    frontendCheck(($packages[$package]['version'] ?? null) === $installedVersion, 'Frontend report did not identify the installed package release');
    frontendCheck(($packages[$package]['metadataSha256'] ?? null) === hash_file('sha256', 'vendor/'.$package.'/assets/package.json'), 'Frontend report did not identify the installed package metadata bytes');
    $imports = array_column($report['imports'], null, 'name');
    frontendCheck(isset($imports['@hotwired/stimulus']), 'Frontend report omitted the shared Stimulus import');
    $owners = array_column($imports['@hotwired/stimulus']['requirements'] ?? [], 'owner');
    foreach ([$package, 'symfony/stimulus-bundle', 'symfony/ux-turbo'] as $owner) {
        frontendCheck(in_array($owner, $owners, true), 'Frontend report omitted a shared requirement owner: '.$owner);
    }
    echo 'Validated installed frontend requirements for '.$installedVersion." without changing application or Composer files.\n";
    exit;
}

if ('rejected' === $phase) {
    $report = frontendJson($argv[2]);
    frontendCheck(($report['format'] ?? null) === 1 && ($report['valid'] ?? null) === false && is_string($report['error'] ?? null), 'Frontend command did not return its structured validation failure');
    $compileOutput = file_get_contents($argv[3]);
    foreach ([$package, '@hotwired/stimulus', '3.2.2', '^4.0.0'] as $detail) {
        frontendCheck(str_contains($report['error'], $detail), 'Frontend diagnostic omitted conflict detail: '.$detail);
        frontendCheck(str_contains($compileOutput, $detail), 'AssetMapper failure omitted conflict detail: '.$detail);
    }
    frontendCheck(frontendSnapshot() === frontendJson($argv[4]), 'Rejected frontend validation or AssetMapper compilation changed application, dependency records or published outputs');
    echo "Rejected incompatible installed requirements through the command and AssetMapper event; previous manifests and compiled bytes remain unchanged.\n";
    exit;
}

throw new RuntimeException('Unknown frontend fixture phase: '.$phase);
