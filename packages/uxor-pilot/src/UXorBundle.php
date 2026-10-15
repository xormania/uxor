<?php

namespace UXor\Pilot;

use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;
use UXor\Pilot\Asset\FrontendAssets;
use UXor\Pilot\Asset\FrontendContractValidator;
use UXor\Pilot\Asset\InstalledFrontendPackages;
use UXor\Pilot\Asset\StableNpmRange;
use UXor\Pilot\Asset\ValidateFrontendAssetsCommand;
use UXor\Pilot\Asset\ValidateFrontendAssetsSubscriber;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;

/** Experimental registration; table subclasses and application policy stay in the consumer. */
final class UXorBundle extends AbstractBundle
{
    /** @param array<string, mixed> $config */
    public function loadExtension(array $config, ContainerConfigurator $configurator, ContainerBuilder $container): void
    {
        $services = $configurator->services();
        $services->set(InstalledFrontendPackages::class);
        $services->set(StableNpmRange::class);
        $services->set(FrontendContractValidator::class)->args([service(StableNpmRange::class)]);
        $services->set(FrontendAssets::class)->args([
            service(InstalledFrontendPackages::class),
            service('asset_mapper.importmap.config_reader'),
            service('asset_mapper.repository'),
            service(FrontendContractValidator::class),
        ]);
        $services->set(ValidateFrontendAssetsCommand::class)->args([service(FrontendAssets::class)])
            ->tag('console.command', ['command' => 'uxor:assets:validate']);
        $services->set(ValidateFrontendAssetsSubscriber::class)->args([service(FrontendAssets::class)])
            ->tag('kernel.event_subscriber');
    }

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
