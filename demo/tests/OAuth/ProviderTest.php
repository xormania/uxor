<?php

namespace App\Tests\OAuth;

use App\UXor\OAuth\GoogleIdTokenVerifier;
use App\UXor\OAuth\LeagueProvider;
use App\UXor\OAuth\ProviderRegistry;
use App\UXor\OAuth\RemoteIdentity;
use Firebase\JWT\JWT;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\HttpFactory;
use GuzzleHttp\Psr7\Response;
use League\OAuth2\Client\Provider\Facebook;
use League\OAuth2\Client\Provider\Github;
use League\OAuth2\Client\Provider\Google;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;
use Symfony\Component\Cache\Adapter\ArrayAdapter;

/** Real client exchanges and JWT signatures, with only the external HTTP transport replaced. */
final class ProviderTest extends TestCase
{
    private const CLIENT_ID = 'test-client.apps.googleusercontent.com';
    private const NONCE = 'test-transaction-nonce';
    private const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const CALLBACK = 'https://application.example/oauth/google/check';

    private static string $privateKey = '';
    /** @var array<string, mixed> */
    private static array $jwk;

    public static function setUpBeforeClass(): void
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
        if (false === $key || !openssl_pkey_export($key, self::$privateKey)) {
            throw new \RuntimeException('Unable to create a local JWT test key.');
        }
        $details = openssl_pkey_get_details($key);
        if (false === $details || !isset($details['rsa'])) {
            throw new \RuntimeException('Unable to read the local JWT test key.');
        }
        self::$jwk = [
            'kty' => 'RSA', 'kid' => 'fixture-key', 'use' => 'sig', 'alg' => 'RS256',
            'n' => JWT::urlsafeB64Encode($details['rsa']['n']),
            'e' => JWT::urlsafeB64Encode($details['rsa']['e']),
        ];
    }

    public function testGoogleAcceptsARealSignedTokenWithMatchingClaims(): void
    {
        $claims = self::claims();
        $verifier = self::googleVerifier();

        self::assertSame($claims, $verifier->verify(self::token($claims), self::NONCE));
    }

    /** @return iterable<string, array{array<string, mixed>}> */
    public static function invalidClaims(): iterable
    {
        yield 'wrong issuer' => [['iss' => 'https://attacker.example']];
        yield 'wrong audience' => [['aud' => 'another-client']];
        yield 'wrong presenter' => [['azp' => 'another-client']];
        yield 'multiple audiences without presenter' => [['aud' => [self::CLIENT_ID, 'another-client']]];
        yield 'expired' => [['exp' => time() - 60]];
        yield 'missing expiry' => [['exp' => null]];
        yield 'expiry has the wrong type' => [['exp' => (string) (time() + 3600)]];
        yield 'issued in the future' => [['iat' => time() + 3600]];
        yield 'missing issued time' => [['iat' => null]];
        yield 'wrong nonce' => [['nonce' => 'other-transaction']];
        yield 'missing nonce' => [['nonce' => null]];
        yield 'missing subject' => [['sub' => null]];
        yield 'empty subject' => [['sub' => '']];
    }

    /** @param array<string, mixed> $overrides */
    #[DataProvider('invalidClaims')]
    public function testGoogleRejectsIncorrectClaims(array $overrides): void
    {
        $this->expectException(\UnexpectedValueException::class);

        self::googleVerifier()->verify(self::token(array_replace(self::claims(), $overrides)), self::NONCE);
    }

    public function testGoogleRejectsATamperedSignature(): void
    {
        $token = self::token(self::claims());
        [$header, $payload, $signature] = explode('.', $token);
        $signature[0] = 'A' === $signature[0] ? 'B' : 'A';
        $this->expectException(\UnexpectedValueException::class);

        self::googleVerifier()->verify($header.'.'.$payload.'.'.$signature, self::NONCE);
    }

    public function testGoogleUsesThePinnedKeyEndpointAndCachedKeys(): void
    {
        $requests = [];
        $handler = new MockHandler([
            static function (RequestInterface $request) use (&$requests): Response {
                $requests[] = (string) $request->getUri();

                return self::json(['keys' => [self::$jwk]]);
            },
        ]);
        $verifier = new GoogleIdTokenVerifier(self::CLIENT_ID, self::client($handler), new HttpFactory(), new ArrayAdapter());
        $token = self::token(self::claims());
        $verifier->verify($token, self::NONCE);
        $verifier->verify($token, self::NONCE);

        self::assertSame(['https://www.googleapis.com/oauth2/v3/certs'], $requests);
    }

    public function testGoogleRefreshesItsCachedKeysWhenTheSigningKeyChanges(): void
    {
        $rotated = self::$jwk;
        $rotated['kid'] = 'rotated-key';
        $handler = new MockHandler([
            self::json(['keys' => [self::$jwk]]),
            self::json(['keys' => [$rotated]]),
        ]);
        $verifier = new GoogleIdTokenVerifier(self::CLIENT_ID, self::client($handler), new HttpFactory(), new ArrayAdapter());
        $verifier->verify(self::token(self::claims()), self::NONCE);
        $token = JWT::encode(self::claims(), self::$privateKey, 'RS256', 'rotated-key');

        self::assertSame('stable-google-subject', $verifier->verify($token, self::NONCE)['sub']);
        self::assertCount(0, $handler);
    }

    public function testGoogleRejectsAnIdentityTokenUsingASymmetricAlgorithm(): void
    {
        $token = JWT::encode(self::claims(), 'fixture-signing-secret-at-least-32-bytes', 'HS256', 'fixture-key');
        $this->expectException(\UnexpectedValueException::class);

        self::googleVerifier()->verify($token, self::NONCE);
    }

    public function testGoogleCannotBeConfiguredWithoutAnIdentityTokenVerifier(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new LeagueProvider('google', new Google(['clientId' => self::CLIENT_ID, 'clientSecret' => 'fixture-secret']));
    }

    public function testGoogleExchangeVerifiesTheIdTokenAndKeepsTheStableSubject(): void
    {
        $claims = self::claims();
        $handler = new MockHandler([
            static function (RequestInterface $request) use ($claims): Response {
                parse_str((string) $request->getBody(), $body);
                self::assertSame(self::VERIFIER, $body['code_verifier']);
                self::assertSame(self::CALLBACK, $body['redirect_uri']);

                return self::json(['access_token' => 'fixture-access-token', 'token_type' => 'Bearer', 'id_token' => self::token($claims)]);
            },
        ]);
        $client = new Google(['clientId' => self::CLIENT_ID, 'clientSecret' => 'fixture-secret'], ['httpClient' => self::client($handler)]);
        $provider = new LeagueProvider('google', $client, self::googleVerifier());
        $identity = $provider->exchange('fixture-code', self::VERIFIER, self::NONCE, self::CALLBACK);

        self::assertSame('stable-google-subject', $identity->subject);
        self::assertSame('member@example.com', $identity->email);
        self::assertTrue($identity->emailVerified);
    }

    public function testPkceMatchesThePublishedS256ExampleForGoogleAndGithub(): void
    {
        $providers = [
            new LeagueProvider('google', new Google(['clientId' => self::CLIENT_ID, 'clientSecret' => 'fixture-secret']), self::googleVerifier()),
            new LeagueProvider('github', new Github(['clientId' => 'fixture-client', 'clientSecret' => 'fixture-secret'])),
        ];
        foreach ($providers as $provider) {
            $url = $provider->authorizationUrl('fixture-state', self::VERIFIER, self::NONCE, self::CALLBACK);
            parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

            self::assertSame('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', $query['code_challenge']);
            self::assertSame('S256', $query['code_challenge_method']);
            self::assertSame('fixture-state', $query['state']);
            self::assertSame(self::CALLBACK, $query['redirect_uri']);
        }
    }

    public function testGithubSelectsTheVerifiedPrimaryEmailInsteadOfTheFirstAddress(): void
    {
        $handler = new MockHandler([
            self::json(['access_token' => 'fixture-access-token', 'token_type' => 'Bearer']),
            self::json(['id' => 42, 'login' => 'member', 'email' => 'public-but-unverified@example.com']),
            self::json([
                ['email' => 'unverified@example.com', 'verified' => false, 'primary' => false],
                ['email' => 'member@example.com', 'verified' => true, 'primary' => true],
            ]),
        ]);
        $provider = new LeagueProvider('github', new Github(['clientId' => 'fixture-client', 'clientSecret' => 'fixture-secret'], ['httpClient' => self::client($handler)]));
        $identity = $provider->exchange('fixture-code', self::VERIFIER, self::NONCE, self::CALLBACK);

        self::assertSame('42', $identity->subject);
        self::assertSame('member@example.com', $identity->email);
        self::assertTrue($identity->emailVerified);
    }

    public function testGithubMissingEmailDoesNotInventARegistrationAddress(): void
    {
        $handler = new MockHandler([
            self::json(['access_token' => 'fixture-access-token', 'token_type' => 'Bearer']),
            self::json(['id' => 42, 'login' => 'member', 'email' => 'public@example.com']),
            self::json([['email' => 'unverified@example.com', 'verified' => false, 'primary' => true]]),
        ]);
        $provider = new LeagueProvider('github', new Github(['clientId' => 'fixture-client', 'clientSecret' => 'fixture-secret'], ['httpClient' => self::client($handler)]));
        $identity = $provider->exchange('fixture-code', self::VERIFIER, self::NONCE, self::CALLBACK);

        self::assertNull($identity->email);
        self::assertFalse($identity->emailVerified);
    }

    public function testFacebookUsesConfidentialExchangeAndAppSecretProofWithoutClaimingPkce(): void
    {
        $handler = new MockHandler([
            static function (RequestInterface $request): Response {
                parse_str((string) $request->getBody(), $body);
                self::assertSame('fixture-secret', $body['client_secret']);
                self::assertArrayNotHasKey('code_verifier', $body);

                return self::json(['access_token' => 'fixture-access-token', 'token_type' => 'Bearer']);
            },
            static function (RequestInterface $request): Response {
                parse_str($request->getUri()->getQuery(), $query);
                self::assertSame(hash_hmac('sha256', 'fixture-access-token', 'fixture-secret'), $query['appsecret_proof']);

                return self::json(['id' => 'facebook-subject', 'name' => 'Member', 'email' => 'member@example.com']);
            },
        ]);
        $client = new Facebook([
            'clientId' => 'fixture-client', 'clientSecret' => 'fixture-secret', 'graphApiVersion' => 'v23.0',
            'fields' => ['id', 'name', 'email', 'picture'],
        ], ['httpClient' => self::client($handler)]);
        $provider = new LeagueProvider('facebook', $client);
        parse_str((string) parse_url($provider->authorizationUrl('fixture-state', self::VERIFIER, self::NONCE, self::CALLBACK), PHP_URL_QUERY), $query);
        self::assertArrayNotHasKey('code_challenge', $query);
        $identity = $provider->exchange('fixture-code', self::VERIFIER, self::NONCE, self::CALLBACK);

        self::assertSame('facebook-subject', $identity->subject);
        self::assertFalse($identity->emailVerified);
    }

    public function testRegistryRejectsDuplicateProviderKeys(): void
    {
        $provider = new LeagueProvider('github', new Github(['clientId' => 'fixture-client', 'clientSecret' => 'fixture-secret']));
        $this->expectException(\InvalidArgumentException::class);

        new ProviderRegistry([$provider, $provider]);
    }

    public function testRegistryRejectsAnUnconfiguredProvider(): void
    {
        $registry = new ProviderRegistry([]);
        $this->expectException(\InvalidArgumentException::class);

        $registry->get('unknown');
    }

    public function testRemoteIdentityRejectsAVerifiedEmailWithoutAnAddress(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new RemoteIdentity('github', '42', null, true, 'Member');
    }

    /** @return array<string, mixed> */
    private static function claims(): array
    {
        return [
            'iss' => 'https://accounts.google.com', 'aud' => self::CLIENT_ID,
            'sub' => 'stable-google-subject', 'iat' => time() - 60, 'exp' => time() + 3600,
            'nonce' => self::NONCE, 'email' => 'member@example.com', 'email_verified' => true, 'name' => 'Member',
        ];
    }

    /** @param array<string, mixed> $claims */
    private static function token(array $claims): string
    {
        return JWT::encode($claims, self::$privateKey, 'RS256', 'fixture-key');
    }

    private static function googleVerifier(): GoogleIdTokenVerifier
    {
        $handler = new MockHandler([self::json(['keys' => [self::$jwk]])]);

        return new GoogleIdTokenVerifier(self::CLIENT_ID, self::client($handler), new HttpFactory(), new ArrayAdapter());
    }

    private static function client(MockHandler $handler): Client
    {
        return new Client(['handler' => HandlerStack::create($handler)]);
    }

    /** @param array<mixed> $data */
    private static function json(array $data): Response
    {
        return new Response(200, ['Content-Type' => 'application/json'], json_encode($data, JSON_THROW_ON_ERROR));
    }
}
