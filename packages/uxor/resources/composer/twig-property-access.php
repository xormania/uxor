<?php

declare(strict_types=1);

use Composer\InstalledVersions;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

return static function (ContainerConfigurator $config): void {
    if (in_array($config->env(), ['dev', 'test'], true) && InstalledVersions::isInstalled('symfony/ux-twig-component')) {
        // TwigComponent requires property_accessor. Explicit application settings take precedence.
        $config->extension('framework', ['property_access' => true], true);
    }
};
