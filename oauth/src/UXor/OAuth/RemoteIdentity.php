<?php

namespace App\UXor\OAuth;

use Symfony\Component\DependencyInjection\Attribute\Exclude;

/** A provider account, identified independently of its changeable email address. */
#[Exclude]
final readonly class RemoteIdentity
{
    public function __construct(
        public string $provider,
        public string $subject,
        public ?string $email,
        public bool $emailVerified,
        public string $displayName,
        public ?string $avatarUrl = null,
    ) {
        if (!preg_match('/^[a-z][a-z0-9_-]{0,31}$/D', $provider)) {
            throw new \InvalidArgumentException('The provider key is invalid.');
        }
        if ('' === $subject || strlen($subject) > 255 || preg_match('/[\x00-\x1f\x7f]/', $subject)) {
            throw new \InvalidArgumentException('The provider account identifier is invalid.');
        }
        if (null !== $email && (strlen($email) > 254 || false === filter_var($email, FILTER_VALIDATE_EMAIL))) {
            throw new \InvalidArgumentException('The provider email address is invalid.');
        }
        if ($emailVerified && null === $email) {
            throw new \InvalidArgumentException('A verified email address must be present.');
        }
        if ('' === trim($displayName) || strlen($displayName) > 1024 || 1 !== preg_match('/^[^\x00-\x1f\x7f]+$/uD', $displayName)) {
            throw new \InvalidArgumentException('The provider display name is invalid.');
        }
        if (null !== $avatarUrl) {
            $parts = parse_url($avatarUrl);
            if (false === $parts || 'https' !== ($parts['scheme'] ?? null) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || false === filter_var($avatarUrl, FILTER_VALIDATE_URL)) {
                throw new \InvalidArgumentException('The provider avatar URL must use HTTPS.');
            }
        }
    }
}
