<?php

use App\Controller\CustomerController;
use App\Table\CustomersTable;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

return static function (ContainerConfigurator $container): void {
    // Keep Toolkit available before the fixture's source-installation step.
    if (!is_file(dirname(__DIR__).'/src/UXor/DataTable/AbstractDataTable.php')) {
        return;
    }
    $services = $container->services()->defaults()->autowire()->autoconfigure();
    $services->set(CustomersTable::class);
    $services->set(CustomerController::class)->tag('controller.service_arguments');
};
