<?php

namespace App\OAuth;

use App\UXor\OAuth\IdentityStoreInterface;
use App\UXor\OAuth\RemoteIdentity;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;
use Symfony\Component\Security\Core\Exception\UnsupportedUserException;
use Symfony\Component\Security\Core\Exception\UserNotFoundException;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Security\Core\User\UserProviderInterface;

/**
 * Demonstrates the application-owned persistence contract without a database or shared test accounts.
 * Each browser session owns its users and provider identities. Never use this fixture in an application.
 *
 * @implements UserProviderInterface<DemoUser>
 */
final class DemoIdentityStore implements IdentityStoreInterface, UserProviderInterface
{
    private const USERS = 'uxor_demo_oauth_users';
    private const IDENTITIES = 'uxor_demo_oauth_identities';

    public function __construct(private readonly RequestStack $requests)
    {
    }

    public function resolve(RemoteIdentity $identity): UserInterface
    {
        $key = $this->identityKey($identity->provider, $identity->subject);
        $identities = $this->identities();
        if (isset($identities[$key])) {
            return $this->loadUserByIdentifier($identities[$key]['user']);
        }
        if (null === $identity->email || '' === $identity->email) {
            throw new CustomUserMessageAuthenticationException('This provider did not share an email address. Sign in before linking it, or choose another provider.');
        }
        foreach ($this->users() as $account) {
            if (0 === strcasecmp($account['email'], $identity->email)) {
                throw new CustomUserMessageAuthenticationException('An account already uses this email address. Sign in to that account before connecting this provider.');
            }
        }

        $identifier = 'oauth-demo:'.$identity->provider.':'.$identity->subject;
        $users = $this->users();
        $users[$identifier] = ['email' => $identity->email, 'name' => $identity->displayName];
        $this->requests->getSession()->set(self::USERS, $users);
        $user = $this->loadUserByIdentifier($identifier);
        $this->link($user, $identity);

        return $user;
    }

    public function link(UserInterface $user, RemoteIdentity $identity): void
    {
        $this->loadUserByIdentifier($user->getUserIdentifier());
        $key = $this->identityKey($identity->provider, $identity->subject);
        $identities = $this->identities();
        if (isset($identities[$key]) && $identities[$key]['user'] !== $user->getUserIdentifier()) {
            throw new CustomUserMessageAuthenticationException('This provider account is already connected to another account. Choose a different provider account.');
        }
        foreach ($identities as $linked) {
            if ($linked['user'] === $user->getUserIdentifier() && $linked['provider'] === $identity->provider && $linked['subject'] !== $identity->subject) {
                throw new CustomUserMessageAuthenticationException('Disconnect the existing account for this provider before connecting another one.');
            }
        }
        $identities[$key] = [
            'user' => $user->getUserIdentifier(),
            'provider' => $identity->provider,
            'subject' => $identity->subject,
            'name' => $identity->displayName,
        ];
        $this->requests->getSession()->set(self::IDENTITIES, $identities);
    }

    public function unlink(UserInterface $user, string $provider, string $subject): void
    {
        $identities = $this->identities();
        $key = $this->identityKey($provider, $subject);
        if (!isset($identities[$key]) || $identities[$key]['user'] !== $user->getUserIdentifier()) {
            throw new CustomUserMessageAuthenticationException('That provider account is not connected to your account.');
        }
        if (\count($this->connected($user)) <= 1) {
            throw new CustomUserMessageAuthenticationException('Keep at least one connected provider so you can sign in again.');
        }
        unset($identities[$key]);
        $this->requests->getSession()->set(self::IDENTITIES, $identities);
    }

    public function loadUserByIdentifier(string $identifier): DemoUser
    {
        $users = $this->users();
        if (!isset($users[$identifier])) {
            $exception = new UserNotFoundException();
            $exception->setUserIdentifier($identifier);
            throw $exception;
        }

        return new DemoUser($identifier, $users[$identifier]['email'], $users[$identifier]['name']);
    }

    public function refreshUser(UserInterface $user): DemoUser
    {
        if (!$user instanceof DemoUser) {
            throw new UnsupportedUserException('The OAuth demo only refreshes its own fixture users.');
        }

        return $this->loadUserByIdentifier($user->getUserIdentifier());
    }

    public function supportsClass(string $class): bool
    {
        return DemoUser::class === $class;
    }

    /** @return list<array{user: string, provider: string, subject: string, name: string}> */
    public function connected(UserInterface $user): array
    {
        return array_values(array_filter($this->identities(), static fn (array $identity): bool => $identity['user'] === $user->getUserIdentifier()));
    }

    /** @return array<string, array{email: string, name: string}> */
    private function users(): array
    {
        return $this->requests->getSession()->get(self::USERS, [
            'oauth-demo:existing' => ['email' => 'existing@example.test', 'name' => 'Existing account'],
        ]);
    }

    /** @return array<string, array{user: string, provider: string, subject: string, name: string}> */
    private function identities(): array
    {
        $defaults = [];
        foreach (['github', 'google', 'facebook'] as $provider) {
            $defaults[$this->identityKey($provider, 'existing-'.$provider)] = [
                'user' => 'oauth-demo:existing', 'provider' => $provider, 'subject' => 'existing-'.$provider, 'name' => 'Existing account',
            ];
        }

        return $this->requests->getSession()->get(self::IDENTITIES, $defaults);
    }

    private function identityKey(string $provider, string $subject): string
    {
        return $provider.':'.$subject;
    }
}
