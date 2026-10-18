<?php

use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

return static function (ContainerConfigurator $container): void {
    $native = '1' === getenv('UXOR_DEV_NATIVE');
    $container->parameters()
        ->set('mate.invocation', 'python3 ../run.py '.($native ? '--native ' : '').'exec vendor/bin/mate')
        ->set('mate.php_version', null);
};
