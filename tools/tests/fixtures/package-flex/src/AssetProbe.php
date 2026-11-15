<?php

namespace Consumer;

use Symfony\Component\AssetMapper\AssetMapperInterface;

/** Read the real generated Stimulus loader without running a browser. */
final class AssetProbe
{
    public function __construct(private readonly AssetMapperInterface $assets)
    {
    }

    public function controllerLoader(): string
    {
        return $this->assets->getAsset('@symfony/stimulus-bundle/controllers.js')?->content ?? '';
    }
}
