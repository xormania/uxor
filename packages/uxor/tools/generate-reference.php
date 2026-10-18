#!/usr/bin/env php
<?php

declare(strict_types=1);

// Generates the package's bundled references (packages/uxor/resources/uxor/) from this repository's working tree.
// --check regenerates into a temporary directory and compares it with the bundle byte for byte: it lists the stale
// files and fails, and never changes the bundle. Run from any directory; --source and --output are for tests.

use Xormania\UXor\Tools\ReferenceGenerator;

require __DIR__.'/ReferenceGenerator.php';

$options = getopt('', ['source:', 'output:', 'ref:', 'check', 'help'], $rest);
if (isset($options['help']) || $rest < $argc) {
    fwrite(isset($options['help']) ? STDOUT : STDERR, "Usage: php packages/uxor/tools/generate-reference.php [--ref=<branch or tag, default ".ReferenceGenerator::DEFAULT_REF.">] [--check]\n");
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
$ref = $options['ref'] ?? ReferenceGenerator::DEFAULT_REF;
$command = 'php packages/uxor/tools/generate-reference.php'.(isset($options['ref']) ? ' --ref='.$ref : '');

$generator = new ReferenceGenerator();
$temporary = null;
$status = 0;
try {
    $files = $generator->build($source, $ref);
    $index = json_decode($files['index.json'], true, 512, JSON_THROW_ON_ERROR);
    if (isset($options['check'])) {
        $temporary = sys_get_temp_dir().'/uxor-references-'.bin2hex(random_bytes(8));
        $generator->write($files, $temporary);
        $stale = ReferenceGenerator::compare($temporary, $output);
        if ([] !== $stale) {
            $lines = array_map(static fn (string $path, string $state): string => "  $state: $path", array_keys($stale), $stale);
            fwrite(STDERR, sprintf("The bundled references are stale: %d files differ from the ones the inputs make.\n%s\nRegenerate them with `%s` and commit the result.\n", count($stale), implode("\n", $lines), $command));
            $status = 1;
        } else {
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
