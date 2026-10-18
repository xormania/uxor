<?php

declare(strict_types=1);

use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Xormania\UXor\Mate\Capabilities;
use Xormania\UXor\NativeTools;
use Xormania\UXor\Operations;
use Xormania\UXor\ProjectDoctor;
use Xormania\UXor\ProjectInspector;
use Xormania\UXor\ReferenceBundle;

return static function (ContainerConfigurator $container): void {
    $services = $container->services();
    foreach ([ReferenceBundle::class, ProjectInspector::class, ProjectDoctor::class, NativeTools::class, Operations::class] as $class) {
        $services->set($class)->autowire();
    }
    // public: at the repository root Mate registers its handlers before this file and set() replaces the definition
    $services->set(Capabilities::class)->autowire()->public()->arg('$projectRoot', '%mate.root_dir%');
};
