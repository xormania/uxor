<?php

namespace App\UXor\OAuth;

use Symfony\Component\Security\Core\User\UserInterface;

/** The application owns persistence, registration policy and local users. */
interface IdentityStoreInterface
{
    /** Resolve the provider + subject pair. Never silently link accounts by matching email. */
    public function resolve(RemoteIdentity $identity): UserInterface;

    /** Explicitly link to this authenticated user; reject an identity owned by another user. */
    public function link(UserInterface $user, RemoteIdentity $identity): void;

    /** Enforce ownership and retain another usable sign-in method before removing an identity. */
    public function unlink(UserInterface $user, string $provider, string $subject): void;
}
