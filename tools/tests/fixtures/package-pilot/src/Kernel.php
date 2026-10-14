<?php

namespace Consumer;

use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Kernel as BaseKernel;
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;

final class Kernel extends BaseKernel
{
    use MicroKernelTrait;

    public function registerBundles(): iterable
    {
        foreach ([
            \Symfony\Bundle\FrameworkBundle\FrameworkBundle::class,
            \Symfony\Bundle\TwigBundle\TwigBundle::class,
            \Symfony\UX\TwigComponent\TwigComponentBundle::class,
            \Symfony\UX\StimulusBundle\StimulusBundle::class,
            \Symfony\UX\Turbo\TurboBundle::class,
            \Symfony\UX\Icons\UXIconsBundle::class,
            \Twig\Extra\TwigExtraBundle\TwigExtraBundle::class,
            \TalesFromADev\Twig\Extra\Tailwind\Bridge\Symfony\Bundle\TalesFromADevTwigExtraTailwindBundle::class,
            \UXor\Pilot\UXorBundle::class,
        ] as $class) {
            yield new $class();
        }
    }

    protected function configureContainer(ContainerConfigurator $container): void
    {
        $container->extension('framework', [
            'secret' => 'package-pilot-fixture',
            'http_method_override' => false,
            'router' => ['utf8' => true],
            'asset_mapper' => ['paths' => ['assets/']],
        ]);
        $container->extension('twig', ['default_path' => '%kernel.project_dir%/templates']);
        $container->extension('twig_component', [
            'anonymous_template_directory' => 'components/',
            'defaults' => ['Consumer\\Twig\\Components\\' => 'components/'],
        ]);
        $container->services()->set(OrdersController::class)->autowire()->autoconfigure()->public();
    }

    protected function configureRoutes(RoutingConfigurator $routes): void
    {
        $routes->add('orders', '/orders')->controller([OrdersController::class, '__invoke']);
    }
}
