<?php

namespace App\Tests\OAuth;

use App\UXor\OAuth\OAuthAttempt;
use App\UXor\OAuth\OAuthAttemptStore;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;

final class AttemptStoreTest extends TestCase
{
    private Session $session;
    private OAuthAttemptStore $attempts;

    protected function setUp(): void
    {
        $this->session = new Session(new MockArraySessionStorage());
        $request = new Request();
        $request->setSession($this->session);
        $requests = new RequestStack();
        $requests->push($request);
        $this->attempts = new OAuthAttemptStore($requests);
    }

    public function testSeparateTabsAndProvidersKeepTheirOwnReturnPathsAndCredentials(): void
    {
        $first = $this->attempts->begin('github', '/projects/first');
        $second = $this->attempts->begin('google', '/projects/second');
        $third = $this->attempts->begin('github', '/projects/third');

        self::assertCount(3, array_unique([$first->state, $second->state, $third->state]));
        self::assertCount(3, array_unique([$first->verifier, $second->verifier, $third->verifier]));
        self::assertCount(3, array_unique([$first->nonce, $second->nonce, $third->nonce]));
        self::assertSame($second, $this->attempts->consume($second->state, 'google'));
        self::assertSame($first, $this->attempts->consume($first->state, 'github'));
        self::assertSame($third, $this->attempts->consume($third->state, 'github'));
    }

    public function testACompletedAttemptCannotBeUsedAgain(): void
    {
        $attempt = $this->attempts->begin('github', '/projects');
        $this->attempts->consume($attempt->state, 'github');

        $this->expectException(CustomUserMessageAuthenticationException::class);
        $this->attempts->consume($attempt->state, 'github');
    }

    public function testSendingAnAttemptToAnotherProviderConsumesOnlyThatAttempt(): void
    {
        $mismatched = $this->attempts->begin('github', '/projects');
        $otherTab = $this->attempts->begin('google', '/settings');

        $this->assertRejected($mismatched->state, 'google');
        $this->assertRejected($mismatched->state, 'github');
        self::assertSame($otherTab, $this->attempts->consume($otherTab->state, 'google'));
    }

    public function testAnExpiredAttemptCannotCompleteAndDoesNotDisplaceActiveAttempts(): void
    {
        $active = [];
        for ($tab = 0; $tab < 7; ++$tab) {
            $active[] = $this->attempts->begin('github', '/projects/'.$tab);
        }
        $expired = $this->attempts->begin('github', '/expired');
        $this->expire($expired);
        $newest = $this->attempts->begin('google', '/settings');

        $this->assertRejected($expired->state, 'github');
        foreach ($active as $attempt) {
            self::assertSame($attempt, $this->attempts->consume($attempt->state, 'github'));
        }
        self::assertSame($newest, $this->attempts->consume($newest->state, 'google'));
    }

    public function testExpiryIsCheckedAtTheCallbackEvenWithoutANewAttempt(): void
    {
        $attempt = $this->attempts->begin('github', '/projects');
        $this->expire($attempt);

        $this->assertRejected($attempt->state, 'github');
        $this->assertRejected($attempt->state, 'github');
    }

    public function testOnlyTheEightMostRecentAttemptsRemainUsable(): void
    {
        $attempts = [];
        for ($tab = 0; $tab < 9; ++$tab) {
            $attempts[] = $this->attempts->begin('github', '/projects/'.$tab);
        }

        $this->assertRejected($attempts[0]->state, 'github');
        foreach (array_slice($attempts, 1) as $attempt) {
            self::assertSame($attempt, $this->attempts->consume($attempt->state, 'github'));
        }
    }

    public function testALinkAttemptKeepsTheAuthenticatedAccountThatStartedIt(): void
    {
        $attempt = $this->attempts->begin('github', '/settings/accounts', 'link', 'local-user-42');
        $consumed = $this->attempts->consume($attempt->state, 'github');

        self::assertSame('link', $consumed->intent);
        self::assertSame('local-user-42', $consumed->userIdentifier);
        self::assertSame('/settings/accounts', $consumed->target);
    }

    public function testLinkingCannotStartWithoutAnAuthenticatedAccount(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->attempts->begin('github', '/settings/accounts', 'link');
    }

    /** @return iterable<string, array{string}> */
    public static function unsafeTargets(): iterable
    {
        yield 'external URL' => ['https://example.com/'];
        yield 'protocol relative URL' => ['//example.com/'];
        yield 'relative path' => ['projects'];
        yield 'empty path' => [''];
        yield 'backslash authority' => ['/\\example.com/'];
        yield 'backslash in path' => ['/projects\\other'];
        yield 'line feed' => ["/projects\nLocation:evil"];
        yield 'carriage return' => ["/projects\r"];
        yield 'NUL' => ["/projects\0"];
        yield 'tab' => ["/projects\t"];
        yield 'space' => ['/projects other'];
        yield 'DEL' => ["/projects\x7f"];
    }

    #[DataProvider('unsafeTargets')]
    public function testAnUnsafeReturnPathCannotBeSaved(string $target): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->attempts->begin('github', $target);
    }

    /** @return iterable<string, array{string}> */
    public static function localTargets(): iterable
    {
        yield 'root' => ['/'];
        yield 'path and query' => ['/projects?sort=name&page=2'];
        yield 'escaped query value' => ['/search?q=two%20words'];
        yield 'fragment' => ['/settings#accounts'];
        yield 'Unicode path' => ['/projects/café'];
    }

    #[DataProvider('localTargets')]
    public function testALocalReturnPathIsPreserved(string $target): void
    {
        $attempt = $this->attempts->begin('github', $target);

        self::assertSame($target, $this->attempts->consume($attempt->state, 'github')->target);
    }

    private function assertRejected(string $state, string $provider): void
    {
        try {
            $this->attempts->consume($state, $provider);
            self::fail('A failed or consumed sign-in attempt must not complete.');
        } catch (CustomUserMessageAuthenticationException $failure) {
            self::assertNotSame('', $failure->getMessageKey());
        }
    }

    private function expire(OAuthAttempt $attempt): void
    {
        // Model a session saved before expiry without sleeping or exposing a clock in the installed recipe.
        foreach ($this->session->all() as $key => $records) {
            if (!is_array($records) || !isset($records[$attempt->state])) {
                continue;
            }
            $records[$attempt->state] = new OAuthAttempt(
                $attempt->state, $attempt->provider, $attempt->verifier, $attempt->nonce,
                $attempt->intent, $attempt->target, $attempt->userIdentifier, time() - 1,
            );
            $this->session->set($key, $records);
        }
    }
}
