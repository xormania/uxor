#!/usr/bin/env php
<?php

/** Direct Composer range-contract tests against the actual pinned semver implementation. */

use Composer\InstalledVersions;
use Composer\Semver\Intervals;
use Composer\Semver\VersionParser;

function verifyContract(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function composerRequirement(string $owner, string $requirement): array
{
    return ['owner' => $owner, 'type' => 'composer', 'requirement' => $requirement];
}

/** @param string[] $fragments */
function rejectsContract(array $requirements, array $package, array $fragments): string
{
    try {
        validatePackageComposerRequirements($requirements, $package);
    } catch (RuntimeException $error) {
        foreach ($fragments as $fragment) {
            verifyContract(str_contains($error->getMessage(), $fragment), 'Missing diagnostic '.json_encode($fragment).': '.$error->getMessage());
        }

        return $error->getMessage();
    }
    throw new RuntimeException('Invalid Composer contract was accepted: '.json_encode([$requirements, $package]));
}

/** @return array{int, string, string} */
function runContractCli(string $script, string $autoload, string $json): array
{
    $process = proc_open([PHP_BINARY, $script, $autoload], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    verifyContract(is_resource($process), 'Cannot execute Composer contract CLI');
    fwrite($pipes[0], $json);
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);

    return [proc_close($process), $stdout, $stderr];
}

verifyContract(2 === $argc && is_file($argv[1]), 'Usage: php tools/tests/package-composer-contract.php AUTOLOAD');
$autoload = realpath($argv[1]);
require $autoload;
$script = dirname(__DIR__).'/package-composer-contract.php';
require $script;

$cases = [
    ['exact pin', ['vendor/library:1.2.3'], '1.2.3'],
    ['narrowing', ['vendor/library:^1.0', 'vendor/library:>=1.5 <2'], '^1.7'],
    ['OR intersection', ['vendor/library:^1 || ^3', 'vendor/library:^2 || ^3'], '^3.2'],
    ['OR remains OR', ['vendor/library:^1 || ^3'], '^1.5 || ^3.2'],
    ['inclusive boundary', ['vendor/library:>=1.0 <=2.0'], '2.0'],
    ['excluded value respected', ['vendor/library:>=1 <3 !=2.0'], '>=2.1 <2.5'],
    ['hyphen range', ['vendor/library:1.0 - 2.0'], '1.7.*'],
    ['unconstrained bare name', ['vendor/library'], '^9.1'],
    ['wildcard', ['vendor/library:*'], '*'],
    ['opaque branch identity', ['vendor/library:dev-main'], 'dev-main'],
    ['numeric branch', ['vendor/library:1.x-dev'], '1.x-dev'],
];
foreach ($cases as [$label, $declarations, $selected]) {
    $requirements = array_map(static fn (string $requirement): array => composerRequirement('recipe:test', $requirement), $declarations);
    $report = validatePackageComposerRequirements($requirements, ['require' => ['vendor/library' => $selected]]);
    verifyContract(1 === count($report['dependencies']) && $selected === $report['dependencies'][0]['package_constraint'], $label.' lost its package constraint');
    verifyContract(count($declarations) === count($report['dependencies'][0]['requirements']), $label.' lost original declarations');
}

$requirements = [
    composerRequirement('recipe:z', 'vendor/library:^1 || ^3'),
    composerRequirement('recipe:a', 'vendor/library:>=1.5 <2 || ^3'),
    composerRequirement('kit', 'php:>=8.4'),
    composerRequirement('kit', 'ext-mbstring'),
    composerRequirement('kit', 'lib-curl:>=7'),
    composerRequirement('kit', 'composer-runtime-api:^2'),
    ['owner' => 'kit', 'type' => 'importmap', 'requirement' => '@scope/npm@^999'],
    ['owner' => 'recipe:a', 'type' => 'recipe', 'requirement' => 'primitive'],
];
$package = ['require' => [
    'vendor/library' => '^1.7 || ^3.2', 'php' => '>=8.5', 'ext-mbstring' => '*',
    'lib-curl' => '^8', 'composer-runtime-api' => '^2.2', 'vendor/additional' => '^7',
]];
$report = validatePackageComposerRequirements($requirements, $package);
verifyContract(1 === $report['format'], 'Evidence format changed');
verifyContract(['package' => 'composer/semver', 'version' => InstalledVersions::getPrettyVersion('composer/semver'), 'reference' => InstalledVersions::getReference('composer/semver')] === $report['semver'], 'Evidence omits actual semver identity');
verifyContract(['composer-runtime-api', 'ext-mbstring', 'lib-curl', 'php', 'vendor/library'] === array_column($report['dependencies'], 'name'), 'Dependencies are not sorted or non-Composer declarations participated');
$reordered = ['require' => array_reverse($package['require'], true)];
verifyContract($report === validatePackageComposerRequirements(array_reverse($requirements), $reordered), 'Record or declaration order changes successful evidence');
verifyContract(['recipe:a', 'recipe:z'] === array_column($report['dependencies'][4]['requirements'], 'owner'), 'Origin ordering is not deterministic');

$require = [composerRequirement('recipe:widget', 'vendor/library:^1.5')];
rejectsContract($require, ['require' => ['vendor/library' => '^1.0']], ['vendor/library', 'recipe:widget', '^1.5', '^1.0', 'not a subset']);
rejectsContract($require, ['require' => ['vendor/library' => '^1.5 || ^2.0']], ['not a subset']);
rejectsContract($require, ['require' => ['vendor/library' => '^2.0']], ['not a subset']);
rejectsContract([composerRequirement('kit', 'vendor/library:>=1 <2')], ['require' => ['vendor/library' => '2.0']], ['not a subset']);
rejectsContract([composerRequirement('kit', 'vendor/library:>=1 <=3 !=2.0')], ['require' => ['vendor/library' => '2.0']], ['not a subset']);
rejectsContract([composerRequirement('kit', 'vendor/library:dev-main')], ['require' => ['vendor/library' => 'dev-other']], ['not a subset']);
rejectsContract($require, ['require' => []], ['missing direct require', 'vendor/library', 'recipe:widget']);
rejectsContract($require, ['require-dev' => ['vendor/library' => '^1.5'], 'provide' => ['vendor/library' => '^1.5'], 'replace' => ['vendor/library' => '^1.5']], ['missing direct require']);

$conflict = [composerRequirement('recipe:b', 'vendor/library:^2'), composerRequirement('recipe:a', 'vendor/library:^1')];
$message = rejectsContract($conflict, ['require' => ['vendor/library' => '*']], ['Contradictory', 'recipe:a', 'recipe:b', '^1', '^2']);
verifyContract($message === rejectsContract(array_reverse($conflict), ['require' => ['vendor/library' => '*']], ['Contradictory']), 'Reordering requirements changes conflict diagnostics');

// Every pair intersects, but the full three-way intersection is empty. Pairwise validation is insufficient.
$parser = new VersionParser();
$ranges = ['^1 || ^2', '^2 || ^3', '^1 || ^3'];
foreach ([[0, 1], [0, 2], [1, 2]] as [$left, $right]) {
    verifyContract(Intervals::haveIntersections($parser->parseConstraints($ranges[$left]), $parser->parseConstraints($ranges[$right])), 'Three-way fixture no longer has pairwise intersections');
}
$threeWay = array_map(static fn (int $index): array => composerRequirement('recipe:'.$index, 'vendor/library:'.$ranges[$index]), array_keys($ranges));
rejectsContract($threeWay, ['require' => ['vendor/library' => '*']], ['Contradictory', 'recipe:0', 'recipe:1', 'recipe:2']);
rejectsContract([composerRequirement('kit', 'vendor/library:>=2 <1')], ['require' => ['vendor/library' => '*']], ['Contradictory']);
rejectsContract([composerRequirement('kit', 'vendor/library')], ['require' => ['vendor/library' => '>=2 <1']], ['permits no versions', 'kit']);
rejectsContract([], ['require' => ['vendor/additional' => '>=2 <1']], ['permits no versions', 'vendor/additional']);

foreach (['^1@dev', '^1@stable', 'dev-main#abcdef', '1.x-dev#abcdef', 'dev-main as 1.0.0', 'dev-main AS 1.0.0'] as $unsupported) {
    rejectsContract([composerRequirement('recipe:unsupported', 'vendor/library:'.$unsupported)], ['require' => ['vendor/library' => '*']], ['unsupported', 'recipe:unsupported']);
    rejectsContract($require, ['require' => ['vendor/library' => $unsupported]], ['unsupported', 'recipe:widget']);
}
foreach (['', 'not-a-version', '^', "^1\n", '>=', ':^1'] as $invalid) {
    rejectsContract([composerRequirement('recipe:invalid', 'vendor/library:'.$invalid)], ['require' => ['vendor/library' => '*']], []);
    rejectsContract([], ['require' => ['vendor/additional' => $invalid]], []);
}
foreach (['Vendor/library', 'vendor/', 'library', 'vendor//library', 'vendor/lib name', '../vendor/library', 'php-unknown', 'ext-', ' vendor/library'] as $invalid) {
    rejectsContract([composerRequirement('recipe:invalid', $invalid.':^1')], ['require' => []], ['invalid package name']);
    rejectsContract([], ['require' => [$invalid => '^1']], ['invalid package name']);
}
foreach ([null, 1, true, []] as $invalid) {
    rejectsContract([], ['require' => ['vendor/library' => $invalid]], ['Composer constraint']);
}
foreach ([null, 'vendor/library', 1] as $invalid) {
    rejectsContract([], ['require' => $invalid], ['require must be an object']);
}
foreach ([['owner' => 'kit'], ['owner' => '', 'type' => 'composer', 'requirement' => 'vendor/library'], ['owner' => 'kit', 'type' => null, 'requirement' => 'vendor/library'], ['owner' => 'kit', 'type' => 'composer', 'requirement' => []], 'invalid'] as $invalid) {
    rejectsContract([$invalid], ['require' => []], ['Every requirement']);
}
rejectsContract(['key' => composerRequirement('kit', 'vendor/library')], ['require' => []], ['must be a list']);

[$status, $stdout, $stderr] = runContractCli($script, $autoload, json_encode(['requirements' => $requirements, 'package' => $package], JSON_THROW_ON_ERROR));
verifyContract(0 === $status && '' === $stderr && $report === json_decode($stdout, true, flags: JSON_THROW_ON_ERROR), 'CLI changed evidence or polluted successful output: '.$stderr);
[$status, $stdout, $stderr] = runContractCli($script, $autoload, json_encode(['requirements' => $require, 'package' => ['require' => ['vendor/library' => '^2']]], JSON_THROW_ON_ERROR));
verifyContract(1 === $status && '' === $stdout && str_starts_with($stderr, 'package-composer-contract: ') && str_contains($stderr, 'recipe:widget'), 'CLI failure did not separate diagnostics from JSON evidence');
foreach (['not json', '[]', '{}', '{"requirements":{},"package":{}}', '{"requirements":[],"package":[]}', '{"requirements":[],"package":{"require":[]}}'] as $invalid) {
    [$status, $stdout, $stderr] = runContractCli($script, $autoload, $invalid);
    verifyContract(1 === $status && '' === $stdout && '' !== $stderr, 'Malformed CLI input was accepted: '.$invalid);
}
$work = sys_get_temp_dir().'/uxor-composer-contract-'.bin2hex(random_bytes(8));
mkdir($work, 0700);
try {
    file_put_contents($work.'/empty-autoload.php', "<?php\n");
    [$status, $stdout, $stderr] = runContractCli($script, $work.'/empty-autoload.php', '{"requirements":[],"package":{}}');
    verifyContract(1 === $status && '' === $stdout && str_contains($stderr, 'must provide composer/semver'), 'Missing semver was not rejected');
    // Substitute only version metadata for the version-gate test; all interval tests use real semver.
    file_put_contents($work.'/unsupported-autoload.php', <<<'PHP'
        <?php
        namespace Composer {
            final class InstalledVersions {
                public static function isInstalled(string $package): bool { return true; }
                public static function getVersion(string $package): string { return '99.0.0.0'; }
                public static function getPrettyVersion(string $package): string { return '99.0.0'; }
                public static function getReference(string $package): string { return 'unsupported-test-reference'; }
            }
        }
        PHP
        .'namespace { require '.var_export($autoload, true).'; }');
    [$status, $stdout, $stderr] = runContractCli($script, $work.'/unsupported-autoload.php', '{"requirements":[],"package":{}}');
    verifyContract(1 === $status && '' === $stdout && str_contains($stderr, 'Unsupported composer/semver version "99.0.0"'), 'Untested semver version was accepted');
} finally {
    foreach (glob($work.'/*') as $path) {
        unlink($path);
    }
    rmdir($work);
}

echo "Composer package contract: real semver subsets, full intersections, platform requirements, provenance, determinism and CLI rejection cases passed.\n";
