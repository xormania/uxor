<?php

namespace App\UXor\OAuth;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;

#[Exclude]
final class OAuthClient
{
    public function __construct(
        private readonly ProviderRegistry $providers,
        private readonly OAuthAttemptStore $attempts,
        private readonly UrlGeneratorInterface $urls,
    ) {
    }

    public function start(string $provider, string $target, string $intent = 'login', ?string $userIdentifier = null): string
    {
        $client = $this->providers->get($provider);
        $attempt = $this->attempts->begin($provider, $target, $intent, $userIdentifier);

        return $client->authorizationUrl($attempt->state, $attempt->verifier, $attempt->nonce, $this->callbackUrl($provider));
    }

    /** @return list<array{provider: string, href: string}> */
    public function loginLinks(?string $returnTo = null): array
    {
        if ($returnTo !== null && !OAuthAttemptStore::isSafeTarget($returnTo)) {
            throw new \InvalidArgumentException('The return location must be a local absolute path.');
        }
        $links = [];
        foreach ($this->providers->keys() as $key) {
            $parameters = ['provider' => $key];
            if ($returnTo !== null) {
                $parameters['returnTo'] = $returnTo;
            }
            $links[] = ['provider' => $key, 'href' => $this->urls->generate('uxor_oauth_start', $parameters)];
        }

        return $links;
    }

    public function complete(Request $request): OAuthResult
    {
        $provider = $request->attributes->getString('provider');
        $query = $request->query->all();
        $state = $query['state'] ?? null;
        if (!is_string($state) || !preg_match('/^[a-f0-9]{64}$/D', $state)) {
            throw new CustomUserMessageAuthenticationException('This sign-in link expired or was already used. Please try again.');
        }
        $attempt = $this->attempts->consume($state, $provider);
        $request->attributes->set('_uxor_oauth_attempt', $attempt);
        if (isset($query['error'])) {
            throw new CustomUserMessageAuthenticationException('Sign-in was cancelled. You can choose a provider and try again.');
        }
        $code = $query['code'] ?? null;
        if (!is_string($code) || $code === '' || strlen($code) > 4096 || !preg_match('/^[\x20-\x7e]+$/D', $code)) {
            throw new CustomUserMessageAuthenticationException('The provider did not complete sign-in. Please try again.');
        }
        $identity = $this->providers->get($provider)->exchange($code, $attempt->verifier, $attempt->nonce, $this->callbackUrl($provider));
        if ($identity->provider !== $provider) {
            throw new CustomUserMessageAuthenticationException('The provider did not complete sign-in. Please try again.');
        }

        return new OAuthResult($identity, $attempt);
    }

    private function callbackUrl(string $provider): string
    {
        return $this->urls->generate('uxor_oauth_check', ['provider' => $provider], UrlGeneratorInterface::ABSOLUTE_URL);
    }
}
