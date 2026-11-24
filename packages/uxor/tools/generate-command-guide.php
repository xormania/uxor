<?php

declare(strict_types=1);

use Symfony\Component\Console\Application as SymfonyApplication;
use Symfony\Component\Console\Input\InputDefinition;
use Symfony\Component\Filesystem\Filesystem;
use Xormania\UXor\Console\Application;

require dirname(__DIR__, 3).'/vendor/autoload.php';

$arguments = array_slice($argv, 1);
if ([] !== $arguments && ['--check'] !== $arguments) {
    fwrite(STDERR, "Usage: php packages/uxor/tools/generate-command-guide.php [--check]\n");
    exit(2);
}

$file = dirname(__DIR__).'/OPERATIONS.md';
$filesystem = new Filesystem();
$guide = $filesystem->readFile($file);
$begin = '<!-- BEGIN UXOR COMMAND REFERENCE -->';
$end = '<!-- END UXOR COMMAND REFERENCE -->';
$start = strpos($guide, $begin);
$stop = strpos($guide, $end);
if (1 !== substr_count($guide, $begin) || 1 !== substr_count($guide, $end) || $start >= $stop) {
    fwrite(STDERR, "OPERATIONS.md must have one ordered pair of command reference markers.\n");
    exit(1);
}

$commands = array_diff_key((new Application())->all(), (new SymfonyApplication())->all());
ksort($commands);
$lines = [];
foreach ($commands as $name => $command) {
    if ($name !== $command->getName() || $command->isHidden()) {
        continue;
    }
    $lines[] = '### `'.$name.'`';
    $lines[] = '';
    $lines[] = $command->getDescription();
    $lines[] = '';
    $definition = $command->getDefinition();
    foreach ([...array_values($definition->getArguments()), ...array_values($definition->getOptions())] as $input) {
        $syntax = (new InputDefinition([$input]))->getSynopsis();
        $lines[] = '- `'.$syntax.'` — '.$input->getDescription();
    }
    $lines[] = '';
}

$offset = $start + strlen($begin);
$updated = substr_replace($guide, "\n\n".implode("\n", $lines)."\n", $offset, $stop - $offset);
if ($guide === $updated) {
    exit(0);
}
if (['--check'] === $arguments) {
    fwrite(STDERR, "Stale CLI command reference. Run php packages/uxor/tools/generate-command-guide.php.\n");
    exit(1);
}
$filesystem->dumpFile($file, $updated);
