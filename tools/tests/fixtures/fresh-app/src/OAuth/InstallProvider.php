<?php

namespace App\OAuth;

use App\UXor\OAuth\ProviderInterface;
use App\UXor\OAuth\RemoteIdentity;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;

/** Only the external provider is mocked. The installed callback and Symfony authenticator establish the session. */
final class InstallProvider implements ProviderInterface
{
    private const GRANTS = '_uxor_install_grants';

    public function __construct(private readonly RequestStack $requests)
    {
    }

    public function key(): string
    {
        return 'github';
    }

    public function authorizationUrl(string $state, string $verifier, string $nonce, string $redirectUri): string
    {
        $code = bin2hex(random_bytes(24));
        $grants = $this->requests->getSession()->get(self::GRANTS, []);
        $grants[$code] = [
            'challenge' => hash('sha256', $verifier), 'nonce' => $nonce,
            'redirect' => $redirectUri, 'expires' => time() + 60,
        ];
        $this->requests->getSession()->set(self::GRANTS, $grants);

        // The smoke test needs no consent UI: approve this server-issued grant at the mocked remote boundary.
        return $redirectUri.'?'.http_build_query(['state' => $state, 'code' => $code], '', '&', PHP_QUERY_RFC3986);
    }

    public function exchange(string $code, string $verifier, string $nonce, string $redirectUri): RemoteIdentity
    {
        $grants = $this->requests->getSession()->get(self::GRANTS, []);
        $grant = $grants[$code] ?? null;
        unset($grants[$code]);
        $this->requests->getSession()->set(self::GRANTS, $grants);
        if (!\is_array($grant) || $grant['expires'] <= time()
            || !hash_equals($grant['challenge'], hash('sha256', $verifier))
            || !hash_equals($grant['nonce'], $nonce) || $grant['redirect'] !== $redirectUri) {
            throw new CustomUserMessageAuthenticationException('The installation provider rejected this sign-in.');
        }

        return new RemoteIdentity('github', 'installed-user', 'installed@example.test', true, 'Installed user');
    }
}
