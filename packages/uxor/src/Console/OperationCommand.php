<?php

declare(strict_types=1);

namespace Xormania\UXor\Console;

use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Xormania\UXor\Operations;

final class OperationCommand extends Command
{
    public function __construct(private readonly Operations $operations, private readonly string $operation)
    {
        parent::__construct($operation);
    }

    protected function configure(): void
    {
        $this->setDescription(match ($this->operation) {
            'catalog' => 'Find UXor component references.',
            'component' => 'Describe one component reference.',
            'reference' => 'Read a packaged UXor document.',
            'workflow' => 'Read a practical UXor-authored application workflow.',
            'inspect' => 'Inspect the selected application metadata.',
            'doctor' => 'Check setup, selected component wiring and runtime unknowns.',
            'tools' => 'Discover native Maker/Mate metadata by executing trusted project PHP (explicit opt-in).',
        })->addOption('format', null, InputOption::VALUE_REQUIRED, 'text or json', 'text');
        if (in_array($this->operation, ['inspect', 'doctor', 'tools'], true)) {
            $this->addOption('project-root', null, InputOption::VALUE_REQUIRED, 'Explicit application directory; defaults to current directory', getcwd());
        }
        if ('catalog' === $this->operation) {
            $this->addOption('query', null, InputOption::VALUE_REQUIRED, 'Component name or intent', '')
                ->addOption('category', null, InputOption::VALUE_REQUIRED, 'Exact category filter', '')
                ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Result limit (1–50)', 10)
                ->addOption('offset', null, InputOption::VALUE_REQUIRED, 'Result offset', 0);
        }
        if ('component' === $this->operation) {
            $this->addArgument('name', InputArgument::OPTIONAL, 'Exact component name');
        }
        if ('reference' === $this->operation) {
            $this->addArgument('path', InputArgument::OPTIONAL, 'Indexed document key, e.g. INSTALL.md')
                ->addOption('offset', null, InputOption::VALUE_REQUIRED, 'Byte offset', 0)
                ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Byte limit (1–24000)', 12000);
        }
        if ('workflow' === $this->operation) {
            $this->addArgument('name', InputArgument::OPTIONAL, 'Known workflow name: customer-management')
                ->addOption('offset', null, InputOption::VALUE_REQUIRED, 'Byte offset', 0)
                ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Byte limit (1–24000)', 12000);
        }
        if ('tools' === $this->operation) {
            $this->addOption('kind', null, InputOption::VALUE_REQUIRED, 'maker or mate', 'maker')
                ->addOption('name', null, InputOption::VALUE_REQUIRED, 'Exact name for native parameter definitions', '')
                ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'List limit (1–50)', 20)
                ->addOption('trust-project-code', null, InputOption::VALUE_NONE, 'Acknowledge that metadata discovery boots this trusted checkout and executes its PHP/autoload code');
        }
        if ('doctor' === $this->operation) {
            $this->addOption('component', null, InputOption::VALUE_REQUIRED, 'Installed component to check against its reference requirements', '')
                ->addOption('asset-profile', null, InputOption::VALUE_REQUIRED, 'auto, assetmapper, or custom', 'auto');
        }
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $arguments = [];
        foreach (['project-root', 'query', 'category', 'limit', 'offset', 'kind', 'name', 'component', 'asset-profile', 'trust-project-code'] as $name) {
            if ($this->getDefinition()->hasOption($name)) {
                $arguments[str_replace('-', '_', $name)] = $input->getOption($name);
            }
        }
        foreach (['name', 'path'] as $name) {
            if ($this->getDefinition()->hasArgument($name)) {
                $arguments[$name] = $input->getArgument($name);
            }
        }
        $format = $input->getOption('format');
        $invalid = !in_array($format, ['text', 'json'], true);
        foreach (['limit', 'offset'] as $name) {
            if (isset($arguments[$name]) && false === filter_var($arguments[$name], FILTER_VALIDATE_INT)) {
                $invalid = true;
            }
        }
        $result = $invalid ? ['operation' => $this->operation, 'status' => 'failed',
            'summary' => 'Use --format=text|json and integer limit/offset values.', 'error' => ['type' => 'invalid_input'], 'changes' => []]
            : $this->operations->run($this->operation, $arguments);
        if ('json' === $format) {
            $output->writeln(json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR), OutputInterface::OUTPUT_RAW);
        } else {
            $output->writeln(strtoupper($result['status']).': '.$result['summary'], OutputInterface::OUTPUT_RAW);
            if (isset($result['data'])) {
                $output->writeln(json_encode($result['data'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR), OutputInterface::OUTPUT_RAW);
            }
        }
        if ('failed' === $result['status']) {
            return Command::FAILURE;
        }
        if ('incomplete' === $result['status'] || ('doctor' === $this->operation && ($result['data']['counts']['fail'] ?? 0) > 0)) {
            return 2;
        }
        return Command::SUCCESS;
    }
}
