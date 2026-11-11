#!/usr/bin/env php
<?php

/** Snapshot policy and filesystem-adapter regressions share the production npm matcher. */

use UXor\Pilot\Asset\FrontendContractValidator;
use UXor\Pilot\Asset\FrontendSnapshot;
use UXor\Pilot\Asset\FrontendSnapshotReader;
use UXor\Pilot\Asset\StableNpmRange;

require dirname(__DIR__, 2).'/packages/uxor-pilot/src/Asset/StableNpmRange.php';
require dirname(__DIR__, 2).'/packages/uxor-pilot/src/Asset/FrontendSnapshot.php';
require dirname(__DIR__, 2).'/packages/uxor-pilot/src/Asset/FrontendSnapshotReader.php';
require dirname(__DIR__, 2).'/packages/uxor-pilot/src/Asset/FrontendContractValidator.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function packageFixture(string $work, string $owner, array $metadata): array
{
    $path = $work.'/'.str_replace('/', '-', $owner);
    if (!is_dir($path.'/assets')) {
        mkdir($path.'/assets', 0700, true);
    }
    $file = $path.'/assets/package.json';
    file_put_contents($file, json_encode($metadata, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");

    return ['owner' => $owner, 'version' => '1.0.0', 'reference' => str_repeat('a', 40), 'packagePath' => $path, 'metadataPath' => $file, 'metadata' => $metadata];
}

function registry(string $version, string $specifier, string $type = 'js'): array
{
    return ['version' => $version, 'package_specifier' => $specifier, 'type' => $type, 'entrypoint' => false];
}

function localFile(?string $path, bool $entrypoint = false): array
{
    return ['path' => $path, 'raw_path' => $path ?? 'missing-file.js', 'type' => 'js', 'entrypoint' => $entrypoint];
}

function fingerprint(string $directory): array
{
    $result = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file->isFile()) {
            $result[$file->getPathname()] = hash_file('sha256', $file->getPathname());
        }
    }
    ksort($result);

    return $result;
}

/** The filesystem integration path; pure cases call the validator directly below. */
function validateObserved(FrontendContractValidator $validator, array $packages, array $selections): array
{
    return $validator->validate((new FrontendSnapshotReader())->read($packages, $selections));
}

function failure(FrontendContractValidator $validator, array $packages, array $selections, array $messages): string
{
    try {
        validateObserved($validator, $packages, $selections);
    } catch (RuntimeException $error) {
        foreach ($messages as $message) {
            expect(str_contains($error->getMessage(), $message), 'Missing diagnostic '.$message.': '.$error->getMessage());
        }

        return $error->getMessage();
    }
    throw new RuntimeException('Invalid contract was accepted: '.implode(', ', $messages));
}

// These identities deliberately need no installed directories, metadata files, HTTP request, or container.
$policy = new FrontendContractValidator(new StableNpmRange());
$package = [
    'owner' => 'test/memory', 'version' => '1.0.0', 'reference' => 'memory-reference',
    'metadataSha256' => str_repeat('b', 64),
    'metadata' => ['symfony' => ['importmap' => ['shared-peer' => '^2.0.0']]],
    'localPaths' => [],
];
$memory = new FrontendSnapshot([$package], ['shared-peer' => registry('2.4.3', 'shared-peer')]);
$report = $policy->validate($memory);
expect($report['packages'][0]['metadataSha256'] === str_repeat('b', 64), 'Policy did not retain supplied provenance');
expect($report['imports'][0]['selection']['version'] === '2.4.3', 'Policy lost selected version');
$localPackage = [...$package,
    'metadata' => ['symfony' => ['importmap' => ['local-helper' => 'path:%PACKAGE%/helper.js']]],
    'localPaths' => ['path:%PACKAGE%/helper.js' => '/not-installed/uxor/helper.js'],
];
$localMemory = new FrontendSnapshot([$localPackage], ['local-helper' => localFile('/not-installed/uxor/helper.js')]);
expect($policy->validate($localMemory)['imports'][0]['kind'] === 'local', 'Policy consulted local filesystem instead of captured identity');
foreach ([
    [new FrontendSnapshot([$package], ['shared-peer' => registry('1.5.0', 'shared-peer')]), 'does not satisfy'],
    [new FrontendSnapshot([$localPackage], ['local-helper' => localFile('/not-installed/uxor/other.js')]), 'must select its declared package-owned file'],
    [new FrontendSnapshot([$localPackage], []), 'missing import'],
    [new FrontendSnapshot([], [], ['invalid-package-metadata: cannot hash "test/memory"']), 'cannot hash'],
] as [$snapshot, $message]) {
    try {
        $policy->validate($snapshot);
        throw new LogicException('Pure policy accepted invalid snapshot: '.$message);
    } catch (RuntimeException $error) {
        expect(str_contains($error->getMessage(), $message), 'Pure policy lost failure: '.$message);
    }
}
// Readonly properties alone are insufficient when a caller supplied references inside the arrays.
$rangeAlias = '^2.0.0';
$versionAlias = '2.4.3';
$errorAlias = 'observed failure';
$metadataAlias = ['symfony' => ['importmap' => ['shared-peer' => &$rangeAlias]]];
$packageAlias = [...$package, 'metadata' => &$metadataAlias];
$selectionAlias = ['version' => &$versionAlias, 'package_specifier' => 'shared-peer', 'type' => 'js', 'entrypoint' => false];
$errorList = [&$errorAlias];
$detached = new FrontendSnapshot([&$packageAlias], ['shared-peer' => &$selectionAlias], $errorList);
$rangeAlias = '^9.0.0';
$versionAlias = '9.1.0';
$errorAlias = 'changed';
$metadataAlias['extra'] = true;
$packageAlias['owner'] = 'test/changed';
expect($detached->packages[0]['owner'] === 'test/memory', 'Package reference changed captured owner');
expect($detached->packages[0]['metadata'] === ['symfony' => ['importmap' => ['shared-peer' => '^2.0.0']]], 'Nested metadata reference changed captured declaration');
expect($detached->selections['shared-peer']['version'] === '2.4.3', 'Selection reference changed captured version');
expect($detached->errors === ['observed failure'], 'Error reference changed captured observation');
$invalid = new FrontendSnapshot([[...$package, 'metadata' => ['symfony' => null]]], []);
try {
    $policy->validate($invalid);
    throw new LogicException('Snapshot copying normalized malformed metadata into a valid declaration');
} catch (RuntimeException $error) {
    expect(str_contains($error->getMessage(), 'unsupported-declaration'), 'Malformed declaration lost its diagnostic');
}
$cyclic = [];
$cyclic['self'] = &$cyclic;
foreach ([$cyclic, ['object' => new stdClass()]] as $unsupported) {
    try {
        new FrontendSnapshot($unsupported, []);
        throw new LogicException('Snapshot accepted mutable or cyclic facts');
    } catch (InvalidArgumentException) {
    }
}
echo "Frontend policy: registry, local identity, provenance and failed observations passed without filesystem fixtures.\n";
if (in_array('--policy-only', $argv, true)) {
    exit(0);
}

$work = sys_get_temp_dir().'/uxor-frontend-contract-'.bin2hex(random_bytes(8));
mkdir($work, 0700);
$validator = new FrontendContractValidator(new StableNpmRange());
$cases = 0;
try {
    $one = packageFixture($work, 'test/one', ['symfony' => ['importmap' => ['shared-peer' => '^1.0.0 || ^2.0.0']], 'peerDependencies' => ['shared-peer' => '^2.0.0']]);
    $two = packageFixture($work, 'test/two', ['symfony' => ['importmap' => ['shared-peer' => '~2.4.0']]]);
    $selections = ['shared-peer' => registry('2.4.3', 'shared-peer'), 'unrelated-app-import' => localFile(null), 'unrelated-registry' => registry('unvalidated-app-version', 'unrelated-package')];
    $before = fingerprint($work);
    $report = validateObserved($validator, [$one, $two], $selections);
    expect($report === validateObserved($validator, [$two, $one], array_reverse($selections, true)), 'Package/selection iteration changed valid evidence');
    expect(count($report['packages']) === 2 && count($report['imports']) === 1, 'Unrelated application import was included');
    expect(count($report['imports'][0]['requirements']) === 3, 'Import or peer origin was dropped');
    expect($report['packages'][0]['metadataSha256'] === hash_file('sha256', $one['metadataPath']), 'Actual metadata hash was lost');
    expect($before === fingerprint($work), 'Successful validation changed files');
    ++$cases;

    $one = packageFixture($work, 'test/one', ['symfony' => ['importmap' => ['shared-peer' => '^1.0.0']]]);
    $two = packageFixture($work, 'test/two', ['symfony' => ['importmap' => ['shared-peer' => '^2.0.0']]]);
    $before = fingerprint($work);
    $messages = ['requires-resolution', 'test/one', 'test/two', '^1.0.0', '^2.0.0', '1.5.0'];
    $error = failure($validator, [$one, $two], ['shared-peer' => registry('1.5.0', 'shared-peer')], $messages);
    expect($error === failure($validator, [$two, $one], ['shared-peer' => registry('1.5.0', 'shared-peer')], $messages), 'Package order changed conflict diagnostic');
    expect(!str_contains(strtolower($error), 'contradictory'), 'Selected-version rejection claimed range satisfiability');
    expect($before === fingerprint($work), 'Rejected validation changed files');
    ++$cases;

    $one = packageFixture($work, 'test/one', ['symfony' => ['importmap' => ['shared-peer' => '>=1.0.0 <3.0.0']]]);
    $two = packageFixture($work, 'test/two', ['symfony' => ['importmap' => ['shared-peer' => '^2.0.0']]]);
    failure($validator, [$one, $two], ['shared-peer' => registry('1.5.0', 'shared-peer')], ['requires-resolution', 'test/two']);
    validateObserved($validator, [$one, $two], ['shared-peer' => registry('2.1.0', 'shared-peer')]);
    failure($validator, [$one], [], ['requires-resolution', 'missing import', 'test/one']);
    failure($validator, [$one], ['shared-peer' => localFile(null)], ['unknown-compatibility', 'test/one']);
    failure($validator, [$one], ['shared-peer' => registry('2.0.0-beta.1', 'shared-peer')], ['unsupported-selection', 'test/one']);
    failure($validator, [$one], ['shared-peer' => [...registry('2.1.0', 'shared-peer'), 'entrypoint' => true]], ['unsupported-selection', 'cannot be an entrypoint']);
    $localSubpath = ['shared-peer' => registry('2.1.0', 'shared-peer'), 'shared-peer/extra.js' => localFile(null), 'application-helper' => localFile(null)];
    $error = failure($validator, [$one, $two], $localSubpath, ['unknown-compatibility', 'shared-peer/extra.js', 'test/one', 'test/two']);
    expect(!str_contains($error, 'application-helper'), 'Unrelated local name was treated as a package override');
    expect($error === failure($validator, [$two, $one], array_reverse($localSubpath, true), ['unknown-compatibility']), 'Named local subpath diagnostic changed with package/selection order');
    ++$cases;

    $scoped = packageFixture($work, 'test/scoped', [
        'symfony' => ['importmap' => [
            'renamed-runtime' => ['version' => '^3.2.0', 'package' => '@scope/runtime'],
            'theme-alias' => ['version' => '^3.2.0', 'package' => '@scope/runtime/dist/theme.css'],
        ]],
        'peerDependencies' => ['@scope/runtime' => '~3.4.0'],
    ]);
    $scopedSelections = ['renamed-runtime' => registry('3.4.2', '@scope/runtime'), 'theme-alias' => registry('3.4.2', '@scope/runtime/dist/theme.css', 'css')];
    $scopedReport = validateObserved($validator, [$scoped], $scopedSelections);
    expect(count($scopedReport['imports']) === 2 && count($scopedReport['imports'][1]['requirements']) === 2, 'Scoped/CSS peer requirements were omitted');
    $bad = $scopedSelections;
    $bad['theme-alias'] = registry('3.4.2', '@scope/runtime/dist/wrong.css', 'css');
    failure($validator, [$scoped], $bad, ['different npm package or subpath', 'test/scoped']);
    $bad = $scopedSelections;
    $bad['extra-alias'] = registry('3.4.3', '@scope/runtime/extra.js');
    failure($validator, [$scoped], $bad, ['inconsistent selected versions', 'extra-alias', '3.4.2', '3.4.3']);
    $bad = $scopedSelections;
    $bad['theme-alias'] = registry('3.5.0', '@scope/runtime/dist/theme.css', 'css');
    failure($validator, [$scoped], $bad, ['peerDependencies.@scope/runtime', '~3.4.0']);
    $collision = packageFixture($work, 'test/alias-collision', ['symfony' => ['importmap' => ['renamed-runtime' => ['version' => '^3.0.0', 'package' => '@other/runtime']]]]);
    failure($validator, [$scoped, $collision], $scopedSelections, ['declaration-collision', 'test/scoped', 'test/alias-collision']);
    ++$cases;

    $peer = packageFixture($work, 'test/peer', ['peerDependencies' => ['peer-only' => '^1.0.0']]);
    failure($validator, [$peer], [], ['missing npm peer', 'peerDependencies.peer-only']);
    $peer = packageFixture($work, 'test/peer', ['peerDependencies' => ['peer-only' => '^1.0.0'], 'peerDependenciesMeta' => ['peer-only' => ['optional' => true]]]);
    validateObserved($validator, [$peer], []);
    failure($validator, [$peer], ['peer-only' => registry('2.0.0', 'peer-only')], ['requires-resolution', 'peerDependencies.peer-only']);
    failure($validator, [$peer], ['peer-only' => localFile(null)], ['unknown-compatibility', 'peerDependencies.peer-only']);
    ++$cases;

    $local = packageFixture($work, 'test/local', ['symfony' => ['importmap' => ['local-helper' => ['version' => 'path:%PACKAGE%/helper.js', 'entrypoint' => true]]]]);
    file_put_contents($local['packagePath'].'/assets/helper.js', 'export const helper = true;');
    $helper = $local['packagePath'].'/assets/helper.js';
    $localReport = validateObserved($validator, [$local], ['local-helper' => localFile($helper, true)]);
    expect($localReport['imports'][0]['kind'] === 'local', 'Package-owned file was assigned a registry version');
    failure($validator, [$local], ['local-helper' => localFile($helper)], ['must remain an entrypoint', 'test/local']);
    failure($validator, [$local], ['local-helper' => localFile(null, true)], ['must select its declared package-owned file']);
    failure($validator, [$local], ['local-helper' => registry('1.0.0', 'local-helper')], ['must select its declared package-owned file']);
    file_put_contents($work.'/outside.js', 'export const outside = true;');
    failure($validator, [$local], ['local-helper' => localFile($work.'/outside.js', true)], ['must select its declared package-owned file']);
    $legacy = packageFixture($work, 'test/legacy', ['symfony' => ['importmap' => ['legacy' => 'entrypoint:%PACKAGE%/helper.js']]]);
    file_put_contents($legacy['packagePath'].'/assets/helper.js', 'export const legacy = true;');
    validateObserved($validator, [$legacy], ['legacy' => localFile($legacy['packagePath'].'/assets/helper.js', true)]);
    ++$cases;

    foreach (['path:%PACKAGE%/../../../outside.js', 'path:/tmp/outside.js', 'path:%PACKAGE%/missing.js'] as $path) {
        $escape = packageFixture($work, 'test/escape', ['symfony' => ['importmap' => ['escape' => $path]]]);
        failure($validator, [$escape], [], ['test/escape']);
    }
    $escape = packageFixture($work, 'test/escape', ['symfony' => ['importmap' => ['escape' => 'path:%PACKAGE%/linked.js']]]);
    symlink($work.'/outside.js', $escape['packagePath'].'/assets/linked.js');
    failure($validator, [$escape], [], ['invalid-package-path', 'test/escape']);
    unlink($escape['packagePath'].'/assets/linked.js');
    $inside = packageFixture($work, 'test/inside', ['symfony' => ['importmap' => ['inside' => 'path:%PACKAGE%/../helper.js']]]);
    file_put_contents($inside['packagePath'].'/helper.js', 'export const inside = true;');
    validateObserved($validator, [$inside], ['inside' => localFile($inside['packagePath'].'/helper.js')]);
    ++$cases;

    $otherLocal = packageFixture($work, 'test/other-local', ['symfony' => ['importmap' => ['local-helper' => 'path:%PACKAGE%/helper.js']]]);
    file_put_contents($otherLocal['packagePath'].'/assets/helper.js', 'export const helper = false;');
    $error = failure($validator, [$local, $otherLocal], ['local-helper' => localFile($helper, true)], ['declaration-collision', 'test/local', 'test/other-local']);
    expect($error === failure($validator, [$otherLocal, $local], ['local-helper' => localFile($helper, true)], ['declaration-collision']), 'Local collision order changed');
    $remote = packageFixture($work, 'test/remote', ['symfony' => ['importmap' => ['local-helper' => '^1.0.0']]]);
    failure($validator, [$local, $remote], ['local-helper' => localFile($helper, true)], ['declaration-collision']);
    $localPeer = packageFixture($work, 'test/local-peer', ['peerDependencies' => ['local-helper' => '^1.0.0']]);
    failure($validator, [$local, $localPeer], ['local-helper' => localFile($helper, true)], ['unknown-compatibility', 'package-owned local', 'explicit version evidence']);
    ++$cases;

    foreach ([null, false, 42, [], ['version' => null], ['version' => '^1.0.0', 'entrypoint' => 'true'], ['version' => '^1.0.0', 'package' => 'https://example.invalid/lib'], ['version' => '^1.0.0', 'unknown' => true], ['version' => '^1.0.0', 'entrypoint' => true], 'latest', '^1.0.0 || latest'] as $raw) {
        $invalid = packageFixture($work, 'test/invalid', ['symfony' => ['importmap' => ['invalid' => $raw]]]);
        failure($validator, [$invalid], [], ['unsupported-declaration', 'test/invalid']);
    }
    foreach ([['symfony' => null], ['symfony' => ['importmap' => null]], ['peerDependencies' => null], ['peerDependenciesMeta' => null], ['peerDependenciesMeta' => ['orphan' => ['optional' => 'true']]], ['peerDependencies' => ['bad/subpath' => '^1.0.0']], ['symfony' => ['importmap' => ['bad key' => '^1.0.0']]]] as $metadata) {
        $invalid = packageFixture($work, 'test/invalid', $metadata);
        failure($validator, [$invalid], [], ['unsupported-declaration', 'test/invalid']);
    }
    failure($validator, [$one, $one], ['shared-peer' => registry('2.1.0', 'shared-peer')], ['duplicate-owner']);
    ++$cases;

    $selectionPathAlias = $local['packagePath'].'/assets/./helper.js';
    $selectionInput = ['path' => &$selectionPathAlias, 'raw_path' => &$selectionPathAlias, 'type' => 'js', 'entrypoint' => true];
    $aliasedSelections = ['local-helper' => &$selectionInput];
    $originalPath = $selectionPathAlias;
    $observedAliases = (new FrontendSnapshotReader())->read([$local], $aliasedSelections);
    expect($selectionPathAlias === $originalPath && $selectionInput['path'] === $originalPath, 'Reader mutated caller-owned selection references');
    expect($observedAliases->selections['local-helper']['path'] === $helper, 'Reader did not capture canonical file identity');
    $selectionPathAlias = '/changed-after-capture.js';
    expect($observedAliases->selections['local-helper']['path'] === $helper, 'Caller changed the reader snapshot through a reference');

    $reader = new FrontendSnapshotReader();
    $captured = $reader->read([$local], ['local-helper' => localFile($helper, true)]);
    unlink($helper);
    // Captured facts remain stable; a fresh read observes the removed file and rejects it.
    $validator->validate($captured);
    failure($validator, [$local], ['local-helper' => localFile($helper, true)], ['invalid-package-path', 'test/local']);
    $missingMetadata = [...$one, 'metadataPath' => $work.'/missing.json'];
    failure($validator, [$missingMetadata], [], ['invalid-package-metadata', 'test/one']);
    $outsideMetadata = [...$one, 'metadataPath' => $work.'/outside.json'];
    file_put_contents($outsideMetadata['metadataPath'], '{}');
    failure($validator, [$outsideMetadata], [], ['invalid-package-metadata', 'inside its installed package']);
    chmod($one['metadataPath'], 0000);
    try {
        // The regular CI user cannot hash an unreadable file. Root can, so do not invent that failure there.
        if (!is_readable($one['metadataPath'])) {
            failure($validator, [$one], [], ['invalid-package-metadata', 'cannot hash', 'test/one']);
        }
    } finally {
        chmod($one['metadataPath'], 0600);
    }
    ++$cases;

    echo 'Frontend contract: '.$cases." scenario groups passed; compatibility, owner order, peers, aliases, scoped/CSS subpaths, package paths, malformed inputs and read-only behavior.\n";
} finally {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($work, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $file) {
        $file->isDir() && !$file->isLink() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    }
    rmdir($work);
}
