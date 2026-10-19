<?php

namespace App\UXor\OAuth;

use Firebase\JWT\CachedKeySet;
use Firebase\JWT\JWT;
use Psr\Cache\CacheItemPoolInterface;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestFactoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/** Google's pinned key endpoint and OIDC claims; JWT signature checks belong to the library. */
#[Exclude]
final class GoogleIdTokenVerifier
{
    private const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

    public function __construct(
        private readonly string $clientId,
        private readonly ClientInterface $httpClient,
        private readonly RequestFactoryInterface $requestFactory,
        private readonly CacheItemPoolInterface $cache,
    ) {
        if ('' === trim($clientId)) {
            throw new \InvalidArgumentException('Google sign-in needs its client identifier.');
        }
    }

    /** @return array<string, mixed> */
    public function verify(string $idToken, string $nonce): array
    {
        if ('' === $idToken || '' === $nonce) {
            throw new \UnexpectedValueException('Google sign-in needs an identity token and its nonce.');
        }

        // A fresh key set on each call observes the shared cache expiry in long-running workers.
        // The library refreshes unknown keys and limits refresh requests; the URI never comes from token data.
        $keys = new CachedKeySet(self::JWKS_URI, $this->httpClient, $this->requestFactory, $this->cache, 3600, true, 'RS256');
        $headers = new \stdClass();
        $claims = (array) JWT::decode($idToken, $keys, $headers);
        $audience = $claims['aud'] ?? null;
        $validAudience = is_string($audience)
            ? hash_equals($this->clientId, $audience)
            : (is_array($audience) && in_array($this->clientId, $audience, true));

        if ('RS256' !== ($headers->alg ?? null)
            || !in_array($claims['iss'] ?? null, ['https://accounts.google.com', 'accounts.google.com'], true)
            || !$validAudience
            || (isset($claims['azp']) && (!is_string($claims['azp']) || !hash_equals($this->clientId, $claims['azp'])))
            || (is_array($audience) && count($audience) > 1 && !isset($claims['azp']))
            || !is_int($claims['exp'] ?? null) || $claims['exp'] <= time()
            || !is_int($claims['iat'] ?? null) || $claims['iat'] > time()
            || !is_string($claims['nonce'] ?? null) || !hash_equals($nonce, $claims['nonce'])
            || !is_string($claims['sub'] ?? null) || !preg_match('/^[\x21-\x7e]{1,255}$/D', $claims['sub'])
        ) {
            throw new \UnexpectedValueException('Google returned an invalid identity token.');
        }

        return $claims;
    }
}
