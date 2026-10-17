<?php

namespace App\OAuth;

use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\Security\Core\User\UserInterface;

/** A value object that the fresh application's user provider reloads from its session-backed store. */
#[Exclude]
final readonly class InstallUser implements UserInterface
{
    public function __construct(private string $identifier, public string $displayName)
    {
    }

    public function getUserIdentifier(): string
    {
        return $this->identifier;
    }

    /** @return list<string> */
    public function getRoles(): array
    {
        return ['ROLE_USER'];
    }

    public function eraseCredentials(): void
    {
    }
}
