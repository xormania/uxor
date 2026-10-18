<?php

declare(strict_types=1);

namespace Xormania\UXor\Console;

use Symfony\Component\Console\Application as BaseApplication;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Xormania\UXor\Operations;

final class Application extends BaseApplication
{
    public function __construct(?Operations $operations = null)
    {
        parent::__construct('UXor');
        $operations ??= Operations::create();
        foreach (['catalog', 'component', 'reference', 'workflow', 'inspect', 'doctor', 'tools'] as $name) {
            $this->addCommand(new OperationCommand($operations, $name));
        }
    }

    public function doRun(InputInterface $input, OutputInterface $output): int
    {
        $json = 'json' === $input->getParameterOption('--format', 'text');
        if ($json) {
            $input->setInteractive(false);
        }
        try {
            return parent::doRun($input, $output);
        } catch (\Throwable $e) {
            if (!$json) {
                throw $e;
            }
            $output->writeln(json_encode(['operation' => $input->getFirstArgument(), 'status' => 'failed',
                'summary' => $e->getMessage(), 'error' => ['type' => 'invalid_input'], 'changes' => []],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR), OutputInterface::OUTPUT_RAW);
            return 1;
        }
    }
}
