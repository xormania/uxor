<?php

declare(strict_types=1);

use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Extension\Extension;
use Symfony\Component\DependencyInjection\Extension\PrependExtensionInterface;

return static function (ContainerBuilder $container): void {
    // The prepend hook runs after every PHP/YAML import. Let the application's profiler configuration win,
    // including Symfony's implicit defaults when the application supplies only part of the profiler section.
    $container->registerExtension(new class extends Extension implements PrependExtensionInterface {
        public function getAlias(): string
        {
            return 'uxor_profiler_defaults';
        }

        public function prepend(ContainerBuilder $container): void
        {
            foreach ($container->getExtensionConfig('framework') as $config) {
                if (array_key_exists('profiler', $config)) {
                    return;
                }
            }
            $container->prependExtensionConfig('framework', ['profiler' => ['collect' => '%env(bool:default::PROFILER_COLLECT)%']]);
        }

        public function load(array $configs, ContainerBuilder $container): void
        {
        }
    });
};
