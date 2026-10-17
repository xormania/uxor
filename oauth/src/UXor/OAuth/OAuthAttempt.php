<?php

namespace App\UXor\OAuth;

use Symfony\Component\DependencyInjection\Attribute\Exclude;

#[Exclude]
final readonly class OAuthAttempt
{
    public function __construct(
        public string $state,
        public string $provider,
        public string $verifier,
        public string $nonce,
        public string $intent,
        public string $target,
        public ?string $userIdentifier,
        public int $expiresAt,
    ) {
    }
}
