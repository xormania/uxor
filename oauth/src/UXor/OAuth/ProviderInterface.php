<?php

namespace App\UXor\OAuth;

/** The external boundary shared by real clients and the demo's local providers. */
interface ProviderInterface
{
    public function key(): string;

    public function authorizationUrl(string $state, string $verifier, string $nonce, string $redirectUri): string;

    public function exchange(string $code, string $verifier, string $nonce, string $redirectUri): RemoteIdentity;
}
