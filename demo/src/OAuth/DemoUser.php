<?php

namespace App\OAuth;

use Symfony\Component\Security\Core\User\UserInterface;

/** A session-backed fixture user; consuming applications supply their own account model. */
final readonly class DemoUser implements UserInterface
{
    /** @var non-empty-string */
    private string $identifier;

    public function __construct(
        string $identifier,
        public string $email,
        public string $displayName,
    ) {
        if ('' === $identifier) {
            throw new \InvalidArgumentException('A demonstration user needs a nonempty identifier.');
        }
        $this->identifier = $identifier;
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
