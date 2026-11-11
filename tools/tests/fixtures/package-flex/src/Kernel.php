<?php

namespace Consumer;

use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Kernel as BaseKernel;
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;
use UXor\Pilot\DataTable\AbstractDataTable;

final class Kernel extends BaseKernel
{
    use MicroKernelTrait;

    protected function configureContainer(ContainerConfigurator $container): void
    {
        $container->extension('framework', [
            'secret' => 'package-flex-fixture',
            'http_method_override' => false,
            'router' => ['utf8' => true],
            'asset_mapper' => ['paths' => ['assets/']],
        ]);
        $container->extension('twig', ['default_path' => '%kernel.project_dir%/templates']);
        $container->extension('twig_component', [
            'anonymous_template_directory' => 'components/',
            'defaults' => ['Consumer\\Twig\\Components\\' => 'components/'],
        ]);
        // Keep the app bootable while the optional package is removed: Flex 2.12 executes
        // importmap:remove in that state. Otherwise a swallowed kernel failure would make
        // import preservation appear to pass without exercising the removal behavior.
        $excluded = [__FILE__];
        if (!class_exists(AbstractDataTable::class)) {
            $excluded[] = __DIR__.'/OrdersTable.php';
            $excluded[] = __DIR__.'/OrdersController.php';
        }
        // Ordinary application discovery, with application-owned optional-feature registration.
        $container->services()->load('Consumer\\', __DIR__.'/')
            ->exclude($excluded)->autowire()->autoconfigure();
        if (class_exists(AbstractDataTable::class)) {
            $container->services()->set(OrdersController::class)->autowire()->autoconfigure()->public();
        }
        $container->services()->set(AssetProbe::class)->autowire()->public();
    }

    protected function configureRoutes(RoutingConfigurator $routes): void
    {
        if (class_exists(AbstractDataTable::class)) {
            $routes->add('orders', '/orders')->controller([OrdersController::class, '__invoke']);
        }
    }
}
