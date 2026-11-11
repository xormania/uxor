<?php

namespace UXor\Pilot\Asset;

use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

final class ValidateFrontendAssetsCommand extends Command
{
    public function __construct(private readonly FrontendAssets $assets)
    {
        parent::__construct('uxor:assets:validate');
    }

    protected function configure(): void
    {
        $this->setDescription('Validate installed UX packages against current frontend selections without changing files.')
            ->addOption('json', null, InputOption::VALUE_NONE, 'Print a machine-readable report or diagnostic.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        try {
            $report = $this->assets->validate();
        } catch (\RuntimeException|\InvalidArgumentException $error) {
            if ($input->getOption('json')) {
                $output->writeln(json_encode(['format' => 1, 'valid' => false, 'error' => $error->getMessage()], \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES), OutputInterface::OUTPUT_RAW);
            } else {
                $errorOutput = $output instanceof ConsoleOutputInterface ? $output->getErrorOutput() : $output;
                (new SymfonyStyle($input, $errorOutput))->error(OutputFormatter::escape($error->getMessage()));
            }

            return self::FAILURE;
        }
        if ($input->getOption('json')) {
            $output->writeln(json_encode($report, \JSON_THROW_ON_ERROR | \JSON_PRETTY_PRINT | \JSON_UNESCAPED_SLASHES), OutputInterface::OUTPUT_RAW);
        } else {
            (new SymfonyStyle($input, $output))->success(sprintf('Validated %d frontend imports from %d installed UX packages.', count($report['imports']), count($report['packages'])));
        }

        return self::SUCCESS;
    }
}
