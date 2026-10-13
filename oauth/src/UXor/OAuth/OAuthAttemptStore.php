<?php

namespace App\UXor\OAuth;

use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;

/** Server-side, expiring and single-use attempts; independent tabs keep independent state. */
final class OAuthAttemptStore
{
    private const SESSION_KEY = '_uxor_oauth_attempts';
    private const MAX_ATTEMPTS = 8;

    public function __construct(private readonly RequestStack $requests)
    {
    }

    public function begin(string $provider, string $target, string $intent = 'login', ?string $userIdentifier = null): OAuthAttempt
    {
        if (!in_array($intent, ['login', 'link'], true) || ($intent === 'link' && $userIdentifier === null)) {
            throw new \InvalidArgumentException('A link attempt requires an authenticated user.');
        }
        if (!self::isSafeTarget($target)) {
            throw new \InvalidArgumentException('The return location must be a local absolute path.');
        }

        $now = time();
        $records = $this->records();
        foreach ($records as $state => $record) {
            if ($record->expiresAt <= $now) {
                unset($records[$state]);
            }
        }
        while (count($records) >= self::MAX_ATTEMPTS) {
            array_shift($records);
        }

        $attempt = new OAuthAttempt(
            bin2hex(random_bytes(32)), $provider,
            rtrim(strtr(base64_encode(random_bytes(64)), '+/', '-_'), '='),
            bin2hex(random_bytes(32)), $intent, $target, $userIdentifier, $now + 600,
        );
        $records[$attempt->state] = $attempt;
        $this->requests->getSession()->set(self::SESSION_KEY, $records);

        return $attempt;
    }

    public function consume(string $state, string $provider): OAuthAttempt
    {
        $records = $this->records();
        $attempt = $records[$state] ?? null;
        // Consume before validating or exchanging a code: even a failed callback cannot be replayed.
        unset($records[$state]);
        $this->requests->getSession()->set(self::SESSION_KEY, $records);

        if ($attempt === null || $attempt->provider !== $provider || $attempt->expiresAt <= time()) {
            throw new CustomUserMessageAuthenticationException('This sign-in link expired or was already used. Please try again.');
        }

        return $attempt;
    }

    public static function isSafeTarget(string $target): bool
    {
        return str_starts_with($target, '/') && !str_starts_with($target, '//')
            && !str_contains($target, '\\') && !preg_match('/[\x00-\x20\x7f]/', $target);
    }

    /** @return array<string, OAuthAttempt> */
    private function records(): array
    {
        $records = $this->requests->getSession()->get(self::SESSION_KEY, []);
        if (!is_array($records)) {
            return [];
        }

        return array_filter($records, static fn (mixed $record): bool => $record instanceof OAuthAttempt);
    }
}
