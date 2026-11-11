#!/usr/bin/env php
<?php

/** Native PHP tests and a batch protocol for the independent node-semver oracle. No vendor required. */

use UXor\Pilot\Asset\StableNpmRange;

require dirname(__DIR__, 2).'/packages/uxor-pilot/src/Asset/StableNpmRange.php';
$matcher = new StableNpmRange();

if (['--oracle'] === array_slice($argv, 1)) {
    $cases = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    if (!is_array($cases) || !array_is_list($cases)) {
        throw new RuntimeException('Oracle input must be a list of version/range records.');
    }
    $results = [];
    foreach ($cases as $case) {
        if (!is_array($case) || !isset($case['version'], $case['range']) || !is_string($case['version']) || !is_string($case['range'])) {
            throw new RuntimeException('Oracle cases require version and range strings.');
        }
        try {
            $results[] = ['matches' => $matcher->matches($case['version'], $case['range'])];
        } catch (InvalidArgumentException $error) {
            $results[] = ['error' => $error->getMessage()];
        }
    }
    echo json_encode($results, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES)."\n";
    exit(0);
}

if (1 !== $argc) {
    throw new RuntimeException('Usage: php tools/tests/frontend-npm-ranges.php [--oracle]');
}

$checks = 0;
$verify = static function (bool $condition, string $message) use (&$checks): void {
    ++$checks;
    if (!$condition) {
        throw new RuntimeException($message);
    }
};
$cases = [
    ['1.2.3', '1.2.3', true], ['1.2.4', '1.2.3', false], ['0.0.0', '*', true],
    ['3.2.2', '^3.0.0', true], ['3.2.2', '^3.2.2', true], ['4.0.0', '^3.2.2', false],
    ['8.0.23', '^7.1.0 || ^8.0', true], ['7.0.0', '^7.1.0 || ^8.0', false],
    ['4.0.0', '^3.4.1 || ^4.0', true], ['4.0.2', '^4.0.2', true],
    ['1.9.9', '^1', true], ['2.0.0', '^1', false],
    ['0.9.9', '^0', true], ['1.0.0', '^0', false],
    ['0.0.9', '^0.0', true], ['0.1.0', '^0.0', false],
    ['0.0.0', '^0.0.0', true], ['0.0.1', '^0.0.0', false],
    ['0.2.9', '^0.2', true], ['0.3.0', '^0.2', false],
    ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false],
    ['0.2.3', '^0.2.3', true], ['0.2.2', '^0.2.3', false],
    ['1.2.99', '~1.2', true], ['1.3.0', '~1.2', false],
    ['1.9.99', '~1', true], ['2.0.0', '~1', false],
    ['1.2.3', '~1.2.3', true], ['1.2.2', '~1.2.3', false], ['1.3.0', '~1.2.3', false],
    ['0.0.99', '~0.0.1', true], ['0.1.0', '~0.0.1', false],
    ['1.2.3', '>1.2.3', false], ['1.2.4', '>1.2.3', true],
    ['1.2.3', '>=1.2.3', true], ['1.2.2', '>=1.2.3', false],
    ['1.2.3', '<1.2.3', false], ['1.2.2', '<1.2.3', true],
    ['1.2.3', '<=1.2.3', true], ['1.2.4', '<=1.2.3', false],
    ['1.2.3', '=1.2.3', true], ['1.2.4', '=1.2.3', false],
    ['1.5.0', '>=1.0.0 <2.0.0', true], ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['1.5.0', '>=2.0.0 <1.0.0', false], ['3.0.0', '>=2.0.0 <1.0.0 || ^3', true],
    ['1.2.3', "  >= \t1.2.3\n<=1.2.3\r\n", true], ['1.2.3', '^ 1.2 ~ 1.2.3', true],
    ['1.2.3', '* >=1.0.0', true], ['1.2.3', '* >2.0.0', false],
];
foreach ($cases as [$version, $range, $expected]) {
    $verify($expected === $matcher->matches($version, $range), 'Wrong stable npm result: '.json_encode([$version, $range, $expected]));
}

foreach (['', '1', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', 'v1.2.3', '=1.2.3', '1.2.3-beta.1', '1.2.3+build', ' 1.2.3', "1.2.3\n", '-1.2.3', '9007199254740992.0.0', '999999999999999999999999.0.0'] as $version) {
    try {
        $matcher->matches($version, '*');
        throw new RuntimeException('Unsupported selected version accepted: '.json_encode($version));
    } catch (InvalidArgumentException) {
        $verify(true, 'Expected unsupported selected version');
    }
}
$unsupported = [
    '', ' ', '1', '1.2', '=1.2', '>1', '<=1.2', '^', '~', '>=', '^01.2',
    '^1.2.3-beta', '~1.2.3+build', '1.2.3@stable', 'dev-main#abc', 'latest',
    '1.x', '1.*', '^1.x', '^*', '~*', '>=*', '1.2.3 - 2.3.4', '!=1.2.3',
    '^1|^2', '^1 ||', '|| ^1', '^1 || || ^2', '>=1.0.0, <2.0.0', '===1.2.3',
    '^1~2', '^1.2.3.4', 'npm:other@1.2.3', 'https://example.test/mod.js',
    'file:./module.js', 'workspace:*', "^1\0", "\0^1", str_repeat('* ', 2049),
    // Syntax must be checked even when an earlier OR matches or an earlier AND is already false.
    '* || latest', '1.2.3 || ^1.2-beta', '<0.0.0 latest', '* ||',
    '^9007199254740991.0.0', '~1.9007199254740991.0', '^0.0.9007199254740991',
];
foreach ($unsupported as $range) {
    try {
        $matcher->matches('1.2.3', $range);
        throw new RuntimeException('Unsupported range accepted: '.json_encode($range));
    } catch (InvalidArgumentException) {
        $verify(true, 'Expected unsupported range');
    }
}
if (PHP_INT_SIZE >= 8) {
    $verify($matcher->matches('9007199254740991.0.0', '>=9007199254740991.0.0'), 'Largest npm-safe component rejected');
    $verify(!$matcher->matches('9007199254740990.0.0', '>=9007199254740991.0.0'), 'Large integers lost precision');
    $verify($matcher->matches('9007199254740990.9.9', '^9007199254740990.0.0'), 'Largest valid caret expansion rejected');
    $verify(!$matcher->matches('9007199254740991.0.0', '^9007199254740990.0.0'), 'Caret upper boundary became inclusive');
}
echo "Stable npm ranges: $checks native PHP grammar and boundary checks passed.\n";
