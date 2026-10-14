<?php

namespace App\UXor\OAuth;

use Symfony\Component\DependencyInjection\Attribute\Exclude;

#[Exclude]
final readonly class OAuthResult
{
    public function __construct(public RemoteIdentity $identity, public OAuthAttempt $attempt)
    {
    }
}
