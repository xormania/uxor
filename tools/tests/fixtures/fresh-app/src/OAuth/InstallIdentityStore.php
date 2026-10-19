<?php

namespace App\OAuth;

use App\UXor\OAuth\IdentityStoreInterface;
use App\UXor\OAuth\RemoteIdentity;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Security\Core\Exception\UnsupportedUserException;
use Symfony\Component\Security\Core\Exception\UserNotFoundException;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Security\Core\User\UserProviderInterface;

/**
 * The fresh application's account integration. Only the install sign-in is exercised here; the demo owns account
 * connection scenarios. This session-backed fixture is never copied into the kit download.
 *
 * @implements UserProviderInterface<InstallUser>
 */
final class InstallIdentityStore implements IdentityStoreInterface, UserProviderInterface
{
    private const USERS = '_uxor_install_users';

    public function __construct(private readonly RequestStack $requests)
    {
    }

    public function resolve(RemoteIdentity $identity): InstallUser
    {
        $identifier = $identity->provider.':'.$identity->subject;
        $users = $this->requests->getSession()->get(self::USERS, []);
        $users[$identifier] = $identity->displayName;
        $this->requests->getSession()->set(self::USERS, $users);

        return $this->loadUserByIdentifier($identifier);
    }

    public function loadUserByIdentifier(string $identifier): InstallUser
    {
        $users = $this->requests->getSession()->get(self::USERS, []);
        if (!isset($users[$identifier])) {
            $exception = new UserNotFoundException();
            $exception->setUserIdentifier($identifier);
            throw $exception;
        }

        return new InstallUser($identifier, $users[$identifier]);
    }

    public function refreshUser(UserInterface $user): InstallUser
    {
        if (!$user instanceof InstallUser) {
            throw new UnsupportedUserException('The install fixture only refreshes its own user.');
        }

        return $this->loadUserByIdentifier($user->getUserIdentifier());
    }

    public function supportsClass(string $class): bool
    {
        return InstallUser::class === $class;
    }

    public function link(UserInterface $user, RemoteIdentity $identity): void
    {
        throw new \LogicException('Account connection scenarios belong to the demo, outside the install smoke test.');
    }

    public function unlink(UserInterface $user, string $provider, string $subject): void
    {
        throw new \LogicException('Account connection scenarios belong to the demo, outside the install smoke test.');
    }
}
