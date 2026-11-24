<?php

declare(strict_types=1);

namespace Xormania\UXor\Console;

use Composer\Autoload\ClassLoader;
use Composer\InstalledVersions;
use Symfony\AI\Mate\App;
use Symfony\AI\Mate\Container\ContainerFactory;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\ArgvInput;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

final class MateCommand extends Command
{
    protected function configure(): void
    {
        $this->setName('mate')->setDescription('Run the installed Symfony AI Mate in the consuming application.')
            ->addArgument('arguments', InputArgument::IS_ARRAY, 'Mate command and its arguments or options');
        $this->ignoreValidationErrors();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        if (!$input instanceof ArgvInput) {
            throw new \InvalidArgumentException('Run uxor mate from the application CLI.');
        }
        $root = realpath(InstalledVersions::getRootPackage()['install_path']);
        // The root may contain an unrelated vendor tree (even one sharing a symlinked Mate package).
        // Only accept the complete dependency directory that supplied this application's autoloader.
        $vendor = false === $root ? false : realpath($root.'/vendor');
        $loaders = ClassLoader::getRegisteredLoaders();
        if (false === $vendor || !isset($loaders[$vendor])) {
            throw new \RuntimeException('Mate needs vendor to resolve to the configured Composer dependencies. Inspect the existing vendor path and run composer install again.');
        }
        $forwarded = new ArgvInput(['mate', ...$input->getRawTokens(true)]);
        $forwarded->setInteractive($input->isInteractive());
        $forwarded->setStream($input->getStream());
        $app = App::build((new ContainerFactory($root))->create(), $forwarded->getFirstArgument());
        $app->setAutoExit(false);
        return $app->run($forwarded, $output);
    }
}
