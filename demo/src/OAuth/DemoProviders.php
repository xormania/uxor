<?php

namespace App\OAuth;

use Symfony\Component\DependencyInjection\Attribute\AutowireIterator;

final class DemoProviders
{
    /** @param iterable<MockProvider> $providers */
    public function __construct(
        #[AutowireIterator('uxor.demo.oauth_provider')]
        private readonly iterable $providers,
    ) {
    }

    /** @return array<string, MockProvider> */
    public function all(): array
    {
        $providers = [];
        foreach ($this->providers as $provider) {
            $providers[$provider->key()] = $provider;
        }

        return $providers;
    }

    public function get(string $key): MockProvider
    {
        return $this->all()[$key] ?? throw new \InvalidArgumentException('Unknown demo provider.');
    }
}
