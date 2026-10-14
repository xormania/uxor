<?php

namespace App\OAuth;

use App\UXor\OAuth\ProviderInterface;
use App\UXor\OAuth\RemoteIdentity;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;

/**
 * The offline provider boundary: the browser sees a local consent page, while exchange reads a one-use grant.
 * There is no HTTP loopback into the demo's single-process PHP server, and the actual authenticator still runs.
 */
final class MockProvider implements ProviderInterface
{
    private const AUTHORIZATIONS = 'uxor_demo_oauth_authorizations';
    private const GRANTS = 'uxor_demo_oauth_grants';

    public function __construct(
        private readonly string $provider,
        private readonly RequestStack $requests,
        private readonly UrlGeneratorInterface $urls,
    ) {
    }

    public function key(): string
    {
        return $this->provider;
    }

    public function authorizationUrl(string $state, string $verifier, string $nonce, string $redirectUri): string
    {
        $ticket = bin2hex(random_bytes(24));
        $authorizations = $this->requests->getSession()->get(self::AUTHORIZATIONS, []);
        $authorizations[$ticket] = [
            'provider' => $this->provider,
            'state' => $state,
            'challenge' => hash('sha256', $verifier),
            'nonce' => $nonce,
            'redirect' => $redirectUri,
            'expires' => time() + 300,
        ];
        $this->requests->getSession()->set(self::AUTHORIZATIONS, $authorizations);

        return $this->urls->generate('app_oauth_demo_authorize', ['provider' => $this->provider, 'ticket' => $ticket]);
    }

    /** @return array{provider: string, state: string, challenge: string, nonce: string, redirect: string, expires: int} */
    public function authorization(string $ticket): array
    {
        $authorizations = $this->requests->getSession()->get(self::AUTHORIZATIONS, []);
        $authorization = $authorizations[$ticket] ?? null;
        if (!\is_array($authorization)) {
            throw new CustomUserMessageAuthenticationException('This demonstration sign-in expired. Start again.');
        }
        $provider = $authorization['provider'] ?? null;
        $state = $authorization['state'] ?? null;
        $challenge = $authorization['challenge'] ?? null;
        $nonce = $authorization['nonce'] ?? null;
        $redirect = $authorization['redirect'] ?? null;
        $expires = $authorization['expires'] ?? null;
        if (!\is_string($provider) || $provider !== $this->provider || !\is_string($state) || '' === $state
            || !\is_string($challenge) || '' === $challenge || !\is_string($nonce) || '' === $nonce
            || !\is_string($redirect) || '' === $redirect || !\is_int($expires) || $expires < time()) {
            throw new CustomUserMessageAuthenticationException('This demonstration sign-in expired. Start again.');
        }

        return ['provider' => $provider, 'state' => $state, 'challenge' => $challenge, 'nonce' => $nonce, 'redirect' => $redirect, 'expires' => $expires];
    }

    public function finish(string $ticket, bool $approve, string $scenario): string
    {
        $authorization = $this->authorization($ticket);
        $authorizations = $this->requests->getSession()->get(self::AUTHORIZATIONS, []);
        unset($authorizations[$ticket]);
        $this->requests->getSession()->set(self::AUTHORIZATIONS, $authorizations);

        $parameters = ['state' => $authorization['state']];
        if (!$approve) {
            $parameters['error'] = 'access_denied';
        } else {
            $code = bin2hex(random_bytes(24));
            $grants = $this->requests->getSession()->get(self::GRANTS, []);
            $grants[$code] = $authorization + ['scenario' => $scenario];
            $this->requests->getSession()->set(self::GRANTS, $grants);
            $parameters['code'] = $code;
        }

        return $authorization['redirect'].'?'.http_build_query($parameters, '', '&', PHP_QUERY_RFC3986);
    }

    public function exchange(string $code, string $verifier, string $nonce, string $redirectUri): RemoteIdentity
    {
        $grants = $this->requests->getSession()->get(self::GRANTS, []);
        $grant = $grants[$code] ?? null;
        unset($grants[$code]);
        $this->requests->getSession()->set(self::GRANTS, $grants);
        if (!\is_array($grant) || ($grant['provider'] ?? null) !== $this->provider || ($grant['expires'] ?? 0) < time()
            || !hash_equals($grant['challenge'], hash('sha256', $verifier))
            || !hash_equals($grant['nonce'], $nonce) || $grant['redirect'] !== $redirectUri) {
            throw new CustomUserMessageAuthenticationException('The demonstration provider rejected this sign-in. Start again.');
        }

        $scenario = $grant['scenario'];
        $subject = 'other-account' === $scenario ? 'existing-'.$this->provider : 'ada-'.$this->provider;
        if ('email-collision' === $scenario) {
            $subject = 'unrelated-'.$this->provider;
        }
        $email = match ($scenario) {
            'missing-email' => null,
            'email-collision', 'other-account' => 'existing@example.test',
            default => $this->provider.'@example.test',
        };

        return new RemoteIdentity($this->provider, $subject, $email, null !== $email, 'Ada Example', null);
    }
}
