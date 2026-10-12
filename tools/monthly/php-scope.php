#!/usr/bin/env php
<?php

/*
 * The scope of the monthly job's PHP coverage and mutation testing (docs/TESTING.md, *Monthly job*): the recipes'
 * own src/ directories, which the demo's autoloader maps App\UXor\… to (demo/composer.json), so what the demo's
 * PHPUnit tests run is the recipes' code. The demo's own code, its gitignored copies of the recipes
 * (demo/src/UXor/) and the tests' fixtures are left out.
 *
 * Writes, into <out dir>:
 * - phpunit.xml: demo/phpunit.dist.xml with absolute paths and its <source> replaced by the recipes' src/, so a
 *   coverage report covers exactly them (`bin/phpunit --configuration <out dir>/phpunit.xml` from demo/);
 * - infection.json5: Infection on the same directories, with that configuration, logs in <out dir>/infection/.
 *
 * Usage: php tools/monthly/php-scope.php [--timeout=<seconds per mutant>] <out dir>
 */

$options = getopt('', ['timeout:'], $rest);
$out = $argv[$rest] ?? null;
if (null === $out) {
    fwrite(STDERR, "Usage: php tools/monthly/php-scope.php [--timeout=<seconds per mutant>] <out dir>\n");
    exit(64);
}

$root = dirname(__DIR__, 2);
$demo = $root.'/demo';
if (!is_dir($out) && !mkdir($out, 0777, true) && !is_dir($out)) {
    fail(sprintf('cannot create "%s"', $out));
}
$out = realpath($out);

$sources = [];
foreach (glob($root.'/*/manifest.json') ?: [] as $manifest) {
    $recipe = dirname($manifest);
    if (is_dir($recipe.'/src')) {
        $sources[] = $recipe.'/src';
    }
}
sort($sources, SORT_STRING);
if ([] === $sources) {
    fail('no recipe has a src/ directory');
}

$document = new DOMDocument();
$document->preserveWhiteSpace = false;
$document->formatOutput = true;
if (!$document->load($demo.'/phpunit.dist.xml')) {
    fail('cannot read demo/phpunit.dist.xml');
}
$phpunit = $document->documentElement;
$phpunit->setAttribute('bootstrap', $demo.'/'.$phpunit->getAttribute('bootstrap'));
$phpunit->setAttribute('cacheDirectory', $out.'/phpunit-cache');
// the schema location is relative to the file, and Infection accepts only a relative one: none is needed here
$phpunit->removeAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation');
foreach ($document->getElementsByTagName('testsuite') as $suite) {
    foreach ($suite->getElementsByTagName('directory') as $directory) {
        $directory->nodeValue = $demo.'/'.$directory->nodeValue;
    }
}
$source = $document->getElementsByTagName('source')->item(0) ?? fail('demo/phpunit.dist.xml has no <source>');
foreach (['include', 'exclude'] as $name) {
    while ($node = $source->getElementsByTagName($name)->item(0)) {
        $source->removeChild($node);
    }
}
$include = $document->createElement('include');
foreach ($sources as $directory) {
    $include->appendChild($document->createElement('directory', $directory))->setAttribute('suffix', '.php');
}
$source->insertBefore($include, $source->firstChild);
$document->save($out.'/phpunit.xml') ?: fail('cannot write phpunit.xml');

$timeout = (int) ($options['timeout'] ?? 30);
$infection = [
    'source' => ['directories' => $sources],
    'phpUnit' => ['configDir' => $out, 'customPath' => $demo.'/vendor/phpunit/phpunit/phpunit'],
    'tmpDir' => $out.'/infection/tmp',
    'timeout' => $timeout,
    'logs' => [
        'text' => $out.'/infection/infection.log',
        'summary' => $out.'/infection/summary.log',
        'json' => $out.'/infection/infection.json',
        'html' => $out.'/infection/infection.html',
    ],
    'mutators' => ['@default' => true],
];
file_put_contents($out.'/infection.json5', json_encode($infection, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n") ?: fail('cannot write infection.json5');

fwrite(STDOUT, sprintf("Scope: %s\nWrote %s/phpunit.xml and %s/infection.json5\n", implode(', ', array_map(static fn (string $d): string => substr($d, strlen($root) + 1), $sources)), $out, $out));

function fail(string $message): never
{
    fwrite(STDERR, 'php-scope: '.$message."\n");
    exit(1);
}
