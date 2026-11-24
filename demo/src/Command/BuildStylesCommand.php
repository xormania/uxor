<?php

namespace App\Command;

use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand('app:build-styles', description: 'Build the example app and Toolkit fixture stylesheets')]
final class BuildStylesCommand extends Command
{
    protected function configure(): void
    {
        $this->addOption('minify', null, InputOption::VALUE_NONE, 'Minify the compiled CSS');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $build = $this->getApplication()->find('tailwind:build');
        foreach (['toolkit-fixtures', 'demo-app'] as $entrypoint) {
            $status = $build->run(new ArrayInput([
                'input_css' => "assets/styles/$entrypoint.css",
                '--minify' => $input->getOption('minify'),
            ]), $output);

            if (self::SUCCESS !== $status) {
                return $status;
            }
        }

        return self::SUCCESS;
    }
}
