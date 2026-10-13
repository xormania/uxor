<?php

namespace App\Tests\OAuth;

use App\OAuth\DemoIdentityStore;
use App\UXor\OAuth\RemoteIdentity;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;

/** The real installed controller/authenticator/firewall against the demonstration provider boundary. */
final class OAuthFlowTest extends WebTestCase
{
    /** @return iterable<string, array{string}> */
    public static function providers(): iterable
    {
        foreach (['github', 'google', 'facebook'] as $provider) {
            yield $provider => [$provider];
        }
    }

    #[DataProvider('providers')]
    public function testAProviderRoundTripCreatesARealSessionForProtectedRequests(string $provider): void
    {
        $client = self::createClient();
        $client->request('GET', '/oauth-demo/account');
        self::assertResponseRedirects('/oauth-demo/login');

        $this->signIn($client, $provider);
        self::assertSelectorTextContains('#oauth-identity', $provider.'@example.test');
        $client->request('GET', '/oauth-demo/private');
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('turbo-frame#oauth-demo-private', 'The Symfony session grants access');

        $client->request('GET', '/oauth-demo/account');
        self::assertResponseIsSuccessful();
        $logout = $client->getCrawler()->selectButton('Sign out of provider demo')->form();
        $client->submit($logout);
        self::assertResponseRedirects('/oauth-demo/login');
        $client->request('GET', '/oauth-demo/private');
        self::assertResponseRedirects('/oauth-demo/login');
    }

    /** @return iterable<string, array{string, bool, string}> */
    public static function failures(): iterable
    {
        yield 'cancelled' => ['standard', false, 'Sign-in was cancelled.'];
        yield 'missing email' => ['missing-email', true, 'This provider did not share an email address.'];
        yield 'email collision' => ['email-collision', true, 'An account already uses this email address.'];
    }

    #[DataProvider('failures')]
    public function testRejectedProviderFlowsExplainTheNextActionWithoutCreatingASession(string $scenario, bool $approve, string $message): void
    {
        $client = self::createClient();
        $this->consent($client, $this->start($client, 'github'), $scenario, $approve);
        self::assertResponseRedirects();
        $client->followRedirect(); // the callback runs the authenticator
        self::assertResponseRedirects('/oauth-demo/login');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('body', $message);
        $client->request('GET', '/oauth-demo/account');
        self::assertResponseRedirects('/oauth-demo/login');
    }

    public function testAnArbitraryCallbackCannotAuthenticate(): void
    {
        $client = self::createClient();
        $client->request('GET', '/oauth/github/check?state=forged&code=forged');
        self::assertResponseRedirects('/oauth-demo/login');
        $client->request('GET', '/oauth-demo/account');
        self::assertResponseRedirects('/oauth-demo/login');
    }

    public function testAUserCanLinkAndUnlinkAProviderAndTheLastSignInHasNoUnlinkForm(): void
    {
        $client = self::createClient();
        $this->signIn($client, 'github');
        $client->submit($client->getCrawler()->filter('form[action="/oauth/google/link"]')->form());
        self::assertResponseRedirects();
        $this->consent($client, $client->followRedirect());
        $client->followRedirect();
        self::assertResponseRedirects('/oauth-demo/account');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorExists('form[action="/oauth/google/unlink"]');
        self::assertSelectorExists('form[action="/oauth/github/unlink"]');

        $client->submit($client->getCrawler()->filter('form[action="/oauth/google/unlink"]')->form());
        self::assertResponseRedirects('/oauth-demo/account');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorExists('form[action="/oauth/google/link"]');

        self::assertSelectorNotExists('form[action="/oauth/github/unlink"]');
        self::assertSelectorExists('button[disabled]');
        self::assertSelectorTextContains('body', 'Keep one provider connected so you can sign in again.');
        self::assertSelectorExists('#oauth-identity');
    }

    public function testTheDemoAccountStoreRejectsRemovingTheLastProvider(): void
    {
        $request = new Request();
        $request->setSession(new Session(new MockArraySessionStorage()));
        $requests = new RequestStack();
        $requests->push($request);
        $store = new DemoIdentityStore($requests);
        $identity = new RemoteIdentity('github', 'ada-github', 'github@example.test', true, 'Ada Example');
        $user = $store->resolve($identity);

        try {
            $store->unlink($user, 'github', 'ada-github');
            self::fail('Removing the only sign-in must be rejected.');
        } catch (CustomUserMessageAuthenticationException $exception) {
            self::assertSame('Keep at least one connected provider so you can sign in again.', $exception->getMessageKey());
        }
        self::assertCount(1, $store->connected($user));
        self::assertSame($user->getUserIdentifier(), $store->resolve($identity)->getUserIdentifier());
    }

    /** @return iterable<string, array{string, bool, string}> */
    public static function linkFailures(): iterable
    {
        yield 'owned identity' => ['other-account', true, 'This provider account is already connected to another account.'];
        yield 'cancelled linking' => ['standard', false, 'Sign-in was cancelled.'];
    }

    #[DataProvider('linkFailures')]
    public function testFailedLinkingReturnsToTheSameAccountWithoutTransferringAnIdentity(string $scenario, bool $approve, string $message): void
    {
        $client = self::createClient();
        $this->signIn($client, 'github');
        $client->submit($client->getCrawler()->filter('form[action="/oauth/google/link"]')->form());
        $this->consent($client, $client->followRedirect(), $scenario, $approve);
        $client->followRedirect();
        self::assertResponseRedirects('/oauth-demo/account');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('body', $message);
        self::assertSelectorTextContains('#oauth-identity', 'github@example.test');
        self::assertSelectorExists('form[action="/oauth/google/link"]');
    }

    public function testSignInReturnsToTheExactProtectedPathSavedByTheFirewall(): void
    {
        $client = self::createClient();
        $client->request('GET', '/oauth-demo/private?view=secure');
        self::assertResponseRedirects('/oauth-demo/login');
        $client->followRedirect();
        self::assertResponseIsSuccessful();

        $this->consent($client, $this->start($client, 'github'));
        $client->followRedirect();
        self::assertResponseRedirects('/oauth-demo/private?view=secure');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('turbo-frame#oauth-demo-private', 'The Symfony session grants access');
    }

    /** @return iterable<string, array{string}> */
    public static function unsafeTargets(): iterable
    {
        yield 'external origin' => ['returnTo=%2F%2Fexample.test%2Faccount'];
        yield 'malformed field' => ['returnTo%5Bpath%5D=%2Foauth-demo%2Faccount'];
    }

    #[DataProvider('unsafeTargets')]
    public function testAnUnsafeOrMalformedReturnTargetFallsBackToTheAccountPage(string $query): void
    {
        $client = self::createClient();
        $client->request('GET', '/oauth/github/start?'.$query);
        self::assertResponseRedirects();
        $this->consent($client, $client->followRedirect());
        $client->followRedirect();
        self::assertResponseRedirects('/oauth-demo/account');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
    }

    public function testUnknownProvidersReturnUsefulFeedbackOnStartAndLink(): void
    {
        $client = self::createClient();
        $client->request('GET', '/oauth/unknown/start');
        self::assertResponseRedirects('/oauth-demo/login');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('body', 'This sign-in provider is unavailable. Please choose another.');

        $this->signIn($client, 'github');
        $form = $client->getCrawler()->filter('form[action="/oauth/google/link"]')->form();
        $client->request('POST', '/oauth/unknown/link', $form->getPhpValues());
        self::assertResponseRedirects('/oauth-demo/account');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('body', 'This sign-in provider is unavailable. Please choose another.');
        self::assertSelectorTextContains('#oauth-identity', 'github@example.test');
    }

    /** @return iterable<string, array{string}> */
    public static function accountChanges(): iterable
    {
        yield 'link' => ['link'];
        yield 'unlink' => ['unlink'];
    }

    #[DataProvider('accountChanges')]
    public function testInvalidCsrfRejectsAccountChangesWithoutChangingConnections(string $action): void
    {
        $client = self::createClient();
        $this->signIn($client, 'github');
        $client->submit($client->getCrawler()->filter('form[action="/oauth/google/link"]')->form());
        $this->consent($client, $client->followRedirect());
        $client->followRedirect();
        self::assertResponseRedirects('/oauth-demo/account');
        $client->followRedirect();
        self::assertResponseIsSuccessful();

        $provider = 'link' === $action ? 'facebook' : 'google';
        $client->request('POST', '/oauth/'.$provider.'/'.$action, ['_csrf_token' => 'invalid', 'subject' => 'ada-google']);
        self::assertResponseStatusCodeSame(403);

        $client->request('GET', '/oauth-demo/account');
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('#oauth-identity', 'github@example.test');
        self::assertSelectorExists('form[action="/oauth/facebook/link"]');
        self::assertSelectorExists('form[action="/oauth/google/unlink"] input[name="subject"][value="ada-google"]');
        self::assertSelectorExists('form[action="/oauth/github/unlink"] input[name="subject"][value="ada-github"]');
    }

    public function testAPendingLinkCannotTransferAnIdentityAfterTheSignedInUserChanges(): void
    {
        $client = self::createClient();
        $this->signIn($client, 'github');
        $client->submit($client->getCrawler()->filter('form[action="/oauth/google/link"]')->form());
        self::assertResponseRedirects();
        $pendingAuthorization = $client->getResponse()->headers->get('Location');
        self::assertNotNull($pendingAuthorization);

        // A second provider round trip changes the authenticated account while the first consent remains pending.
        $this->signIn($client, 'github', 'other-account');
        self::assertSelectorTextContains('#oauth-identity', 'existing@example.test');
        $this->consent($client, $client->request('GET', $pendingAuthorization));
        $client->followRedirect();
        self::assertResponseRedirects('/oauth-demo/login');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('body', 'Sign in to the same account before connecting a provider.');

        $client->request('GET', '/oauth-demo/account');
        self::assertResponseIsSuccessful();
        self::assertSelectorTextContains('#oauth-identity', 'existing@example.test');
        self::assertSelectorExists('form[action="/oauth/google/unlink"] input[name="subject"][value="existing-google"]');
        self::assertSelectorNotExists('input[name="subject"][value="ada-google"]');
    }

    private function start(KernelBrowser $client, string $provider): Crawler
    {
        $client->request('GET', '/oauth/'.$provider.'/start');
        self::assertResponseRedirects();

        $page = $client->followRedirect();
        self::assertResponseIsSuccessful();

        return $page;
    }

    private function consent(KernelBrowser $client, Crawler $page, string $scenario = 'standard', bool $approve = true): void
    {
        self::assertResponseIsSuccessful();
        $form = $page->selectButton($approve ? 'Continue as Ada' : 'Cancel sign-in')->form();
        $form['form[scenario]'] = $scenario;
        $client->submit($form);
        self::assertResponseRedirects();
    }

    private function signIn(KernelBrowser $client, string $provider, string $scenario = 'standard'): void
    {
        $this->consent($client, $this->start($client, $provider), $scenario);
        $client->followRedirect();
        self::assertResponseRedirects('/oauth-demo/account');
        $client->followRedirect();
        self::assertResponseIsSuccessful();
    }
}
