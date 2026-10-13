<?php

namespace App\UXor\OAuth;

use League\OAuth2\Client\Provider\AbstractProvider;
use League\OAuth2\Client\Provider\Exception\IdentityProviderException;
use League\OAuth2\Client\Token\AccessToken;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/** Opinionated social-login adapters backed by League's maintained OAuth clients. */
#[Exclude]
final class LeagueProvider implements ProviderInterface
{
    public function __construct(
        private readonly string $providerKey,
        private readonly AbstractProvider $client,
        private readonly ?GoogleIdTokenVerifier $googleVerifier = null,
    ) {
        if (!in_array($providerKey, ['github', 'google', 'facebook'], true)) {
            throw new \InvalidArgumentException('The League adapter supports GitHub, Google and Facebook.');
        }
        if ('google' === $providerKey && null === $googleVerifier) {
            throw new \InvalidArgumentException('Google sign-in requires identity-token verification.');
        }
    }

    public function key(): string
    {
        return $this->providerKey;
    }

    public function authorizationUrl(string $state, string $verifier, string $nonce, string $redirectUri): string
    {
        if ('' === $state || '' === $nonce) {
            throw new \InvalidArgumentException('Sign-in needs a state and a nonce.');
        }
        $options = ['state' => $state, 'redirect_uri' => $redirectUri];
        if ('facebook' !== $this->providerKey) {
            self::validateVerifier($verifier);
            $options['code_challenge'] = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
            $options['code_challenge_method'] = 'S256';
        }
        $options['scope'] = match ($this->providerKey) {
            'github' => ['user:email'],
            'google' => ['openid', 'email', 'profile'],
            'facebook' => ['public_profile', 'email'],
            default => throw new \LogicException('The sign-in provider is unsupported.'),
        };
        if ('google' === $this->providerKey) {
            $options['nonce'] = $nonce;
        }

        return $this->client->getAuthorizationUrl($options);
    }

    public function exchange(string $code, string $verifier, string $nonce, string $redirectUri): RemoteIdentity
    {
        if ('' === $code) {
            throw new \InvalidArgumentException('The provider authorization code is missing.');
        }
        $options = ['code' => $code, 'redirect_uri' => $redirectUri];
        if ('facebook' !== $this->providerKey) {
            self::validateVerifier($verifier);
            $options['code_verifier'] = $verifier;
        }
        $token = $this->client->getAccessToken('authorization_code', $options);
        if (!$token instanceof AccessToken) {
            throw new \UnexpectedValueException('The provider returned an unsupported access token.');
        }

        if ('google' === $this->providerKey) {
            $idToken = $token->getValues()['id_token'] ?? null;
            if (!is_string($idToken) || null === $this->googleVerifier) {
                throw new \UnexpectedValueException('Google returned no identity token.');
            }
            $claims = $this->googleVerifier->verify($idToken, $nonce);

            return new RemoteIdentity(
                'google', self::subject($claims['sub'] ?? null), self::optionalString($claims['email'] ?? null),
                true === ($claims['email_verified'] ?? false), self::displayName($claims), self::avatarUrl($claims['picture'] ?? null),
            );
        }

        if ('github' === $this->providerKey) {
            return $this->githubIdentity($token);
        }

        // League's Facebook client authenticates /me using its HMAC appsecret_proof.
        $profile = $this->client->getResourceOwner($token)->toArray();
        $picture = $profile['picture']['data']['url'] ?? null;

        return new RemoteIdentity(
            'facebook', self::subject($profile['id'] ?? null), self::optionalString($profile['email'] ?? null),
            false, self::displayName($profile), self::avatarUrl($picture),
        );
    }

    private function githubIdentity(AccessToken $token): RemoteIdentity
    {
        // Fetch the two documented resources directly: League's convenience method chooses an arbitrary email
        // and drops the verified/primary flags, which are needed for safe registration defaults.
        $url = $this->client->getResourceOwnerDetailsUrl($token);
        $profile = $this->client->getParsedResponse($this->client->getAuthenticatedRequest('GET', $url, $token));
        if (!is_array($profile)) {
            throw new \UnexpectedValueException('GitHub returned an invalid profile.');
        }
        $email = null;
        try {
            $addresses = $this->client->getParsedResponse($this->client->getAuthenticatedRequest('GET', $url.'/emails', $token));
            if (!is_array($addresses)) {
                throw new \UnexpectedValueException('GitHub returned invalid email addresses.');
            }
            foreach ($addresses as $address) {
                if (is_array($address) && true === ($address['verified'] ?? false) && true === ($address['primary'] ?? false)) {
                    $email = self::optionalString($address['email'] ?? null);
                    break;
                }
            }
        } catch (IdentityProviderException $exception) {
            // Identity remains usable when the user withheld the email permission.
            if (!in_array($exception->getCode(), [403, 404], true)) {
                throw $exception;
            }
        }

        return new RemoteIdentity(
            'github', self::subject($profile['id'] ?? null), $email,
            null !== $email, self::displayName($profile), self::avatarUrl($profile['avatar_url'] ?? null),
        );
    }

    private static function validateVerifier(string $verifier): void
    {
        if (!preg_match('/^[a-zA-Z0-9._~-]{43,128}$/D', $verifier)) {
            throw new \InvalidArgumentException('The sign-in verifier is invalid.');
        }
    }

    private static function subject(mixed $value): string
    {
        if ((!is_string($value) && !is_int($value)) || '' === (string) $value) {
            throw new \UnexpectedValueException('The provider account identifier is missing.');
        }

        return (string) $value;
    }

    private static function optionalString(mixed $value): ?string
    {
        return is_string($value) && '' !== trim($value) ? $value : null;
    }

    /** @param array<mixed> $profile */
    private static function displayName(array $profile): string
    {
        return self::optionalString($profile['name'] ?? null)
            ?? self::optionalString($profile['login'] ?? null)
            ?? 'Member';
    }

    private static function avatarUrl(mixed $value): ?string
    {
        $url = self::optionalString($value);
        if (null === $url || false === filter_var($url, FILTER_VALIDATE_URL)) {
            return null;
        }
        $parts = parse_url($url);

        return false !== $parts && 'https' === ($parts['scheme'] ?? null) && !isset($parts['user']) && !isset($parts['pass']) ? $url : null;
    }
}
