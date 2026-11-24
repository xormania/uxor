#!/usr/bin/env php
<?php

declare(strict_types=1);

// Generates the package's bundled references (packages/uxor/resources/uxor/) from this repository's working tree.
// --check regenerates into a temporary directory and compares it with the bundle byte for byte: it lists the stale
// files and fails, and never changes the bundle. Run from any directory; --source and --output are for tests.

use Xormania\UXor\Tools\ReferenceGenerator;
use Xormania\UXor\Tools\PackageInstallGuide;

require __DIR__.'/ReferenceGenerator.php';
require __DIR__.'/PackageInstallGuide.php';

$options = getopt('', ['source:', 'output:', 'ref:', 'check', 'help'], $rest);
if (isset($options['help']) || $rest < $argc) {
    fwrite(isset($options['help']) ? STDOUT : STDERR, "Usage: php packages/uxor/tools/generate-reference.php [--ref=<tag or branch, default: the latest version in CHANGELOG.md>] [--check]\n");
    exit(isset($options['help']) ? 0 : 2);
}
foreach (['source', 'output', 'ref'] as $name) {
    if (isset($options[$name]) && !is_string($options[$name])) {
        fwrite(STDERR, "--$name is given more than once.\n");
        exit(2);
    }
}
$source = $options['source'] ?? ReferenceGenerator::repositoryRoot();
$output = $options['output'] ?? dirname(__DIR__).'/resources/uxor';
$command = 'php packages/uxor/tools/generate-reference.php'.(isset($options['ref']) ? ' --ref='.$options['ref'] : '');

$generator = new ReferenceGenerator();
$temporary = null;
$status = 0;
try {
    $guide = realpath($source).'/packages/uxor/README.md';
    if (realpath($guide) !== $guide || !is_file($guide)) {
        throw new RuntimeException('Package guide is not a regular file of the source.');
    }
    $markdown = file_get_contents($guide);
    $expected = PackageInstallGuide::render(
        $markdown,
        json_decode(file_get_contents($source.'/composer.json'), true, flags: JSON_THROW_ON_ERROR),
        json_decode(file_get_contents($source.'/composer.lock'), true, flags: JSON_THROW_ON_ERROR),
        ReferenceGenerator::releaseRef($source),
    );
    if ($markdown !== $expected) {
        if (isset($options['check'])) {
            fwrite(STDERR, "The install command in packages/uxor/README.md is stale. Regenerate it with `$command`.\n");
            $status = 1;
        } elseif (false === file_put_contents($guide, $expected)) {
            throw new RuntimeException('Cannot update the package install guide.');
        }
    }
    $files = $generator->build($source, $options['ref'] ?? null);
    $index = json_decode($files['index.json'], true, 512, JSON_THROW_ON_ERROR);
    $ref = $index['source']['ref'];
    if (isset($options['check'])) {
        $temporary = sys_get_temp_dir().'/uxor-references-'.bin2hex(random_bytes(8));
        $generator->write($files, $temporary);
        $stale = ReferenceGenerator::compare($temporary, $output);
        if ([] !== $stale) {
            $lines = array_map(static fn (string $path, string $state): string => "  $state: $path", array_keys($stale), $stale);
            fwrite(STDERR, sprintf("The bundled references are stale: %d files differ from the ones the inputs make.\n%s\nRegenerate them with `%s` and commit the result.\n", count($stale), implode("\n", $lines), $command));
            $status = 1;
        } elseif (0 === $status) {
            fwrite(STDOUT, sprintf("Verified %d generated reference files: inputs %s, links at %s.\n", count($files), $index['source']['inputs_sha256'], $ref));
        }
    } else {
        $generator->write($files, $output);
        fwrite(STDOUT, sprintf("Wrote %d generated reference files: inputs %s, links at %s.\n", count($files), $index['source']['inputs_sha256'], $ref));
    }
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    $status = 1;
} finally {
    if (null !== $temporary && is_dir($temporary)) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($temporary, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($iterator as $entry) {
            $entry->isDir() && !$entry->isLink() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
        }
        rmdir($temporary);
    }
}

exit($status);
