#!/usr/bin/env php
<?php

declare(strict_types=1);

use Xormania\UXor\Tools\ReferenceGenerator;

require __DIR__.'/ReferenceGenerator.php';

$options = getopt('', ['source:', 'revision:', 'check']);
if (!isset($options['source'], $options['revision'])) {
    fwrite(STDERR, "Usage: php packages/uxor/tools/generate-reference.php --source=/path/to/uxor --revision=<full-commit-sha> [--check]\n");
    exit(2);
}

try {
    $files = (new ReferenceGenerator())->build($options['source'], $options['revision']);
    $directory = dirname(__DIR__).'/resources/uxor';
    $existing = [];
    if (is_link($directory)) {
        throw new RuntimeException('The generated bundle directory must not be a symbolic link.');
    }
    if (is_dir($directory)) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isLink()) {
                throw new RuntimeException('The generated bundle must not contain symbolic links.');
            }
            if ($file->isFile()) {
                $existing[] = substr($file->getPathname(), strlen($directory) + 1);
            }
        }
    }
    $stale = array_values(array_diff($existing, array_keys($files)));
    $different = array_filter(array_keys($files), static fn (string $path): bool => !is_file($directory.'/'.$path) || file_get_contents($directory.'/'.$path) !== $files[$path]);
    if (isset($options['check'])) {
        if ([] !== $stale || [] !== $different) {
            throw new RuntimeException('Reference bundle is stale: '.implode(', ', [...$stale, ...$different]));
        }
    } else {
        foreach ($files as $path => $content) {
            $parent = dirname($directory.'/'.$path);
            if (!is_dir($parent) && !mkdir($parent, 0777, true) && !is_dir($parent)) {
                throw new RuntimeException('Cannot create '.$parent);
            }
            if (false === file_put_contents($directory.'/'.$path, $content)) {
                throw new RuntimeException('Cannot write generated reference: '.$path);
            }
        }
        foreach ($stale as $path) {
            if (!unlink($directory.'/'.$path)) {
                throw new RuntimeException('Cannot remove obsolete generated reference: '.$path);
            }
        }
    }

    fwrite(STDOUT, sprintf("%s %d generated reference files at UXor %s.\n", isset($options['check']) ? 'Verified' : 'Wrote', count($files), $options['revision']));
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}
