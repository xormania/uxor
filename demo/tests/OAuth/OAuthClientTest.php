<?php

namespace App\Tests\OAuth;

use App\UXor\OAuth\OAuthAttemptStore;
use App\UXor\OAuth\OAuthClient;
use App\UXor\OAuth\ProviderInterface;
use App\UXor\OAuth\ProviderRegistry;
use App\UXor\OAuth\RemoteIdentity;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Routing\Generator\UrlGenerator;
use Symfony\Component\Routing\RequestContext;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;

final class OAuthClientTest extends TestCase
{
    private OAuthAttemptStore $attempts;
    private UrlGenerator $urls;

    protected function setUp(): void
    {
        $request = new Request();
        $request->setSession(new Session(new MockArraySessionStorage()));
        $requests = new RequestStack();
        $requests->push($request);
        $this->attempts = new OAuthAttemptStore($requests);
        $routes = new RouteCollection();
        $routes->add('uxor_oauth_check', new Route('/oauth/{provider}/check'));
        $this->urls = new UrlGenerator($routes, new RequestContext('/app', 'GET', 'uxor.test', 'https'));
    }

    public function testTheCallbackUsesTheExactVerifierNonceAndRedirectUriFromAuthorization(): void
    {
        $authorization = [];
        $identity = new RemoteIdentity('github', 'provider-user-1', null, false, 'Demo user');
        $provider = $this->createMock(ProviderInterface::class);
        $provider->method('key')->willReturn('github');
        $provider->expects(self::once())->method('authorizationUrl')->willReturnCallback(
            static function (string $state, string $verifier, string $nonce, string $redirectUri) use (&$authorization): string {
                $authorization = [$state, $verifier, $nonce, $redirectUri];

                return 'https://provider.test/authorize?state='.$state;
            },
        );
        $provider->expects(self::once())->method('exchange')->willReturnCallback(
            static function (string $code, string $verifier, string $nonce, string $redirectUri) use (&$authorization, $identity): RemoteIdentity {
                self::assertSame('code-from-provider', $code);
                self::assertSame([$authorization[1], $authorization[2], $authorization[3]], [$verifier, $nonce, $redirectUri]);

                return $identity;
            },
        );
        $client = $this->client($provider);

        $url = $client->start('github', '/projects?view=recent');
        self::assertSame('https://provider.test/authorize?state='.$authorization[0], $url);
        self::assertSame('https://uxor.test/app/oauth/github/check', $authorization[3]);
        $result = $client->complete($this->callbackRequest('github', ['state' => $authorization[0], 'code' => 'code-from-provider']));

        self::assertSame($identity, $result->identity);
        self::assertSame('/projects?view=recent', $result->attempt->target);
        self::assertSame($authorization[0], $result->attempt->state);
        $this->assertRejected($client, $this->callbackRequest('github', ['state' => $authorization[0], 'code' => 'code-from-provider']));
    }

    public function testCancellationConsumesTheAttemptAndNeverExchangesACode(): void
    {
        $provider = $this->providerWithoutExchange('github');
        $client = $this->client($provider);
        $attempt = $this->attempts->begin('github', '/projects');

        $this->assertRejected($client, $this->callbackRequest('github', ['state' => $attempt->state, 'error' => 'access_denied', 'code' => 'ignored-code']));
        $this->assertRejected($client, $this->callbackRequest('github', ['state' => $attempt->state, 'code' => 'replayed-code']));
    }

    /** @return iterable<string, array{string}> */
    public static function validOpaqueCodes(): iterable
    {
        yield 'URL punctuation' => ['code+/%2f=.~'];
        yield 'spaces are opaque' => [' code '];
        yield 'maximum length' => [str_repeat('a', 4096)];
    }

    #[DataProvider('validOpaqueCodes')]
    public function testAValidOpaqueCodeReachesTheProviderUnchanged(string $code): void
    {
        $provider = $this->createMock(ProviderInterface::class);
        $provider->method('key')->willReturn('github');
        $identity = new RemoteIdentity('github', 'provider-user-1', null, false, 'Demo user');
        $attempt = $this->attempts->begin('github', '/projects');
        $provider->expects(self::once())->method('exchange')
            ->with($code, $attempt->verifier, $attempt->nonce, 'https://uxor.test/app/oauth/github/check')
            ->willReturn($identity);

        $result = $this->client($provider)->complete($this->callbackRequest('github', ['state' => $attempt->state, 'code' => $code]));

        self::assertSame($identity, $result->identity);
    }

    /** @return iterable<string, array{mixed}> */
    public static function malformedStates(): iterable
    {
        yield 'missing state' => [null];
        yield 'array state' => [['state']];
        yield 'empty state' => [''];
        yield 'short state' => ['abcd'];
        yield 'non-hex state' => [str_repeat('z', 64)];
        yield 'uppercase state' => [str_repeat('A', 64)];
        yield 'state with newline' => [str_repeat('a', 64)."\n"];
    }

    #[DataProvider('malformedStates')]
    public function testMalformedStateNeverReachesTheProvider(mixed $state): void
    {
        $client = $this->client($this->providerWithoutExchange('github'));

        $this->assertRejected($client, $this->callbackRequest('github', ['state' => $state, 'code' => 'some-code']));
    }

    /** @return iterable<string, array{mixed}> */
    public static function malformedCodes(): iterable
    {
        yield 'missing code' => [null];
        yield 'array code' => [['code']];
        yield 'empty code' => [''];
        yield 'oversized code' => [str_repeat('a', 4097)];
        yield 'NUL in code' => ["code\0suffix"];
        yield 'newline in code' => ["code\n"];
        yield 'DEL in code' => ["code\x7f"];
        yield 'non-ASCII code' => ['codé'];
    }

    #[DataProvider('malformedCodes')]
    public function testAMalformedCodeConsumesTheAttemptBeforeAnyExchange(mixed $code): void
    {
        $client = $this->client($this->providerWithoutExchange('github'));
        $attempt = $this->attempts->begin('github', '/projects');

        $this->assertRejected($client, $this->callbackRequest('github', ['state' => $attempt->state, 'code' => $code]));
        $this->assertRejected($client, $this->callbackRequest('github', ['state' => $attempt->state, 'code' => 'later-valid-code']));
    }

    public function testAProviderExchangeFailureCannotBeRetriedWithTheSameState(): void
    {
        $provider = $this->createMock(ProviderInterface::class);
        $provider->method('key')->willReturn('github');
        $provider->expects(self::once())->method('exchange')->willThrowException(new CustomUserMessageAuthenticationException('The provider is unavailable.'));
        $client = $this->client($provider);
        $attempt = $this->attempts->begin('github', '/projects');
        $callback = $this->callbackRequest('github', ['state' => $attempt->state, 'code' => 'valid-code']);

        $this->assertRejected($client, $callback);
        $this->assertRejected($client, $callback);
    }

    public function testACallbackForAnotherProviderCannotExchangeOrReuseTheAttempt(): void
    {
        $client = $this->client($this->providerWithoutExchange('github'), $this->providerWithoutExchange('google'));
        $attempt = $this->attempts->begin('github', '/projects');

        $this->assertRejected($client, $this->callbackRequest('google', ['state' => $attempt->state, 'code' => 'valid-code']));
        $this->assertRejected($client, $this->callbackRequest('github', ['state' => $attempt->state, 'code' => 'valid-code']));
    }

    public function testAnIdentityForAnotherProviderIsRejectedAndTheAttemptCannotBeReplayed(): void
    {
        $provider = $this->createMock(ProviderInterface::class);
        $provider->method('key')->willReturn('github');
        $provider->expects(self::once())->method('exchange')->willReturn(new RemoteIdentity('google', 'other-user', null, false, 'Other user'));
        $client = $this->client($provider);
        $attempt = $this->attempts->begin('github', '/projects');
        $callback = $this->callbackRequest('github', ['state' => $attempt->state, 'code' => 'valid-code']);

        $this->assertRejected($client, $callback);
        $this->assertRejected($client, $callback);
    }

    private function client(ProviderInterface ...$providers): OAuthClient
    {
        return new OAuthClient(new ProviderRegistry($providers), $this->attempts, $this->urls);
    }

    private function providerWithoutExchange(string $key): ProviderInterface
    {
        $provider = $this->createMock(ProviderInterface::class);
        $provider->method('key')->willReturn($key);
        $provider->expects(self::never())->method('exchange');

        return $provider;
    }

    /** @param array<string, mixed> $query */
    private function callbackRequest(string $provider, array $query): Request
    {
        $request = new Request($query);
        $request->attributes->set('provider', $provider);

        return $request;
    }

    private function assertRejected(OAuthClient $client, Request $request): void
    {
        try {
            $client->complete($request);
            self::fail('An invalid callback must not authenticate the user.');
        } catch (CustomUserMessageAuthenticationException $failure) {
            self::assertNotSame('', $failure->getMessageKey());
        }
    }
}
