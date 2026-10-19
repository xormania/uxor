<?php

namespace App\UXor\OAuth;

use Symfony\Component\DependencyInjection\Attribute\Exclude;

#[Exclude]
final class ProviderRegistry
{
    /** @var array<string, ProviderInterface> */
    private array $providers = [];

    /** @param iterable<ProviderInterface> $providers */
    public function __construct(iterable $providers)
    {
        foreach ($providers as $provider) {
            $key = $provider->key();
            if (!preg_match('/^[a-z][a-z0-9_-]{0,31}$/D', $key) || isset($this->providers[$key])) {
                throw new \InvalidArgumentException('Each provider needs a unique, valid key.');
            }
            $this->providers[$key] = $provider;
        }
    }

    public function get(string $key): ProviderInterface
    {
        return $this->providers[$key] ?? throw new \InvalidArgumentException('This sign-in provider is not configured.');
    }

    /** @return list<string> */
    public function keys(): array
    {
        return array_keys($this->providers);
    }
}
