<?php

namespace UXor\Pilot;

use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

/** Experimental registration; table subclasses and application policy stay in the consumer. */
final class UXorBundle extends AbstractBundle
{
    public function prependExtension(ContainerConfigurator $configurator, ContainerBuilder $container): void
    {
        $configurator->extension('framework', [
            'asset_mapper' => ['paths' => [$this->getPath().'/assets' => '@xormania/uxor-pilot']],
        ]);
        $configurator->extension('ux_icons', [
            'icon_sets' => ['uxor-pilot' => ['path' => $this->getPath().'/assets/icons/flowbite']],
        ]);
    }
}
