<?php

namespace Consumer;

use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Kernel as BaseKernel;
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;

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
        // Ordinary application discovery: no package-specific service registration or aliases.
        $container->services()->load('Consumer\\', __DIR__.'/')
            ->exclude(__FILE__)->autowire()->autoconfigure();
        $container->services()->set(OrdersController::class)->autowire()->autoconfigure()->public();
        $container->services()->set(AssetProbe::class)->autowire()->public();
    }

    protected function configureRoutes(RoutingConfigurator $routes): void
    {
        $routes->add('orders', '/orders')->controller([OrdersController::class, '__invoke']);
    }
}
