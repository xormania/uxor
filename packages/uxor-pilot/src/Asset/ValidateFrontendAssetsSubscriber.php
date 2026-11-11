<?php

namespace UXor\Pilot\Asset;

use Symfony\Component\AssetMapper\Event\PreAssetsCompileEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/** Build guard only: Composer and Flex may already have changed installed metadata. */
final class ValidateFrontendAssetsSubscriber implements EventSubscriberInterface
{
    public function __construct(private readonly FrontendAssets $assets)
    {
    }

    /** @return array<class-string, array{string, int}> */
    public static function getSubscribedEvents(): array
    {
        return [PreAssetsCompileEvent::class => ['validate', 100]];
    }

    public function validate(PreAssetsCompileEvent $event): void
    {
        $this->assets->validate();
    }
}
