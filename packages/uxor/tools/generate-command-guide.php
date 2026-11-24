<?php

declare(strict_types=1);

use Symfony\Component\Console\Application as SymfonyApplication;
use Symfony\Component\Console\Input\InputDefinition;
use Symfony\Component\Filesystem\Filesystem;
use Xormania\UXor\Console\Application;
use Xormania\UXor\Tools\ConfigurationGuide;

$arguments = array_slice($argv, 1);
$usage = <<<'HELP'
    Usage: php packages/uxor/tools/generate-command-guide.php [--check]

    Generate the CLI reference in packages/uxor/OPERATIONS.md and the Composer requirements,
    development setup and provider defaults in docs/COMPOSER-CONFIGURATION.md. With --check, report stale
    guides and exit with status 1 without writing to either file.
    HELP;
if (['--help'] === $arguments || ['-h'] === $arguments) {
    fwrite(STDOUT, $usage."\n");
    exit(0);
}
if ([] !== $arguments && ['--check'] !== $arguments) {
    fwrite(STDERR, $usage."\n");
    exit(2);
}

require dirname(__DIR__, 3).'/vendor/autoload.php';
require __DIR__.'/ConfigurationGuide.php';

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

$application = new Application();
$commands = array_diff_key($application->all(), (new SymfonyApplication())->all());
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
$configurationFile = dirname(__DIR__, 3).'/docs/COMPOSER-CONFIGURATION.md';
$configuration = ConfigurationGuide::render(
    $application->find('setup')->getNativeDefinition(),
    dirname(__DIR__).'/bin/uxor-mago',
    json_decode($filesystem->readFile(dirname(__DIR__, 3).'/composer.json'), true, flags: JSON_THROW_ON_ERROR),
);
$targets = [
    'CLI command reference' => [$file, $updated],
    'Composer configuration guide' => [$configurationFile, $configuration],
];
$status = 0;
foreach ($targets as $name => [$target, $expected]) {
    if (is_file($target) && $filesystem->readFile($target) === $expected) {
        continue;
    }
    if (['--check'] === $arguments) {
        fwrite(STDERR, "Stale $name. Run php packages/uxor/tools/generate-command-guide.php.\n");
        $status = 1;
    } else {
        $filesystem->dumpFile($target, $expected);
    }
}
exit($status);
