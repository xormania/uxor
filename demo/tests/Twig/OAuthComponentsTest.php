<?php

namespace App\Tests\Twig;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\UX\TwigComponent\Test\InteractsWithTwigComponents;
use Symfony\UX\TwigComponent\Test\RenderedComponent;
use Twig\Markup;

final class OAuthComponentsTest extends KernelTestCase
{
    use InteractsWithTwigComponents;

    public function testTheProviderHandoffCannotBeChangedByCallerAttributes(): void
    {
        $rendered = $this->renderTwigComponent('OAuthProviderButton', [
            'provider' => 'github', 'href' => '/oauth/github/start', 'as' => 'button',
            'DATA-TURBO' => 'true', 'data-turbo-frame' => 'partial', 'data-turbo-prefetch' => 'true',
            'target' => '_blank', 'download' => 'identity', 'HREF' => 'javascript:alert(1)',
            'aria-label' => 'Misleading', 'onclick' => 'alert(1)',
        ]);
        $link = $rendered->crawler()->filter('a');

        self::assertCount(1, $link);
        self::assertCount(0, $rendered->crawler()->filter('button'));
        self::assertSame('/oauth/github/start', $link->attr('href'));
        self::assertSame('_self', $link->attr('target'));
        self::assertSame('false', $link->attr('data-turbo'));
        self::assertSame('false', $link->attr('data-turbo-prefetch'));
        self::assertSame('Continue with GitHub', $link->attr('aria-label'));
        self::assertNull($link->attr('download'));
        self::assertNull($link->attr('data-turbo-frame'));
        self::assertNull($link->attr('onclick'));
    }

    public function testGoogleUsesTheLocalApprovedArtworkAndMatchingLabel(): void
    {
        $rendered = $this->renderTwigComponent('OAuthProviderButton', [
            'provider' => 'google', 'href' => '/oauth/google/start', 'label' => 'Arbitrary text',
        ]);
        $link = $rendered->crawler()->filter('a');
        $images = $link->filter('img');

        self::assertSame('Sign in with Google', $link->attr('aria-label'));
        self::assertCount(2, $images);
        foreach ($images->extract(['src']) as $src) {
            self::assertIsString($src);
            self::assertStringStartsWith('/assets/images/uxor-oauth-google-', $src);
        }
        self::assertSame(['', ''], $images->extract(['alt']));
        self::assertSame(['180', '180'], $images->extract(['width']));
        self::assertSame(['40', '40'], $images->extract(['height']));
    }

    public function testTheRegistrationCardEscapesFeedbackAndProviderLabels(): void
    {
        $rendered = $this->renderTwigComponent('SocialLogin', [
            'mode' => 'signup', 'feedback' => '<script>alert(1)</script>',
            'providers' => [['provider' => 'github', 'href' => '/oauth/github/start', 'label' => '<img src=x>']],
            'alternativeHref' => '/login',
        ]);
        $crawler = $rendered->crawler();

        self::assertSame('Create your account', $crawler->filter('h1')->text());
        self::assertSame('Registration providers', $crawler->filter('ul')->attr('aria-label'));
        self::assertSame('<script>alert(1)</script>', $crawler->filter('[role="alert"]')->text());
        self::assertSame('<img src=x>', $crawler->filter('ul a')->text());
        self::assertSame('/login', $crawler->filter('p a')->attr('href'));
        self::assertCount(0, $crawler->filter('script, img'));
    }

    public function testTheOptionalPasswordSlotRendersOnceWithASeparatorOnlyBesideProviders(): void
    {
        $twig = self::getContainer()->get('twig');
        foreach ([[], [['provider' => 'github', 'href' => '/oauth/github/start']]] as $providers) {
            $html = $twig->createTemplate(<<<'TWIG'
                <twig:SocialLogin :providers="providers">
                    <form action="/login" method="post"><button type="submit">Sign in with email</button></form>
                </twig:SocialLogin>
                TWIG)->render(['providers' => $providers]);
            $crawler = (new RenderedComponent($html))->crawler();

            self::assertCount(1, $crawler->filter('form'));
            self::assertSame((bool) $providers, str_contains($crawler->text(), 'Or use your email'));
        }
    }

    public function testConnectionFormsSeparateTheActionsAndBindDisconnectionToItsSubject(): void
    {
        $rendered = $this->renderTwigComponent('ConnectedAccounts', ['returnTo' => '/account/connections?tab=providers', 'accounts' => [
            ['provider' => 'github', 'connected' => false, 'connectAction' => '/oauth/github/link', 'connectToken' => 'connect'],
            ['provider' => 'google', 'connected' => true, 'identity' => 'alex@example.com', 'subject' => 'google-123', 'disconnectAction' => '/oauth/google/unlink', 'disconnectToken' => 'disconnect'],
        ]]);
        $forms = $rendered->crawler()->filter('form');

        self::assertCount(2, $forms);
        self::assertSame(['/oauth/github/link', '/oauth/google/unlink'], $forms->extract(['action']));
        self::assertSame(['post', 'post'], $forms->extract(['method']));
        self::assertSame(['false', 'false'], $forms->extract(['data-turbo']));
        self::assertSame(['connect', 'disconnect'], $forms->filter('input[name="_csrf_token"]')->extract(['value']));
        self::assertSame(['/account/connections?tab=providers', '/account/connections?tab=providers'], $forms->filter('input[name="returnTo"]')->extract(['value']));
        self::assertCount(0, $forms->eq(0)->filter('input[name="subject"]'));
        self::assertSame('google-123', $forms->eq(1)->filter('input[name="subject"]')->attr('value'));
    }

    public function testMarkupObjectsCannotBypassEscapingInFormAttributesOrLabels(): void
    {
        $payload = new Markup('"><script>alert(1)</script>', 'UTF-8');
        $rendered = $this->renderTwigComponent('ConnectedAccounts', ['accounts' => [[
            'provider' => 'github', 'connected' => true, 'label' => $payload,
            'subject' => $payload, 'disconnectAction' => $payload, 'disconnectToken' => $payload,
        ]], 'feedback' => $payload, 'returnTo' => $payload]);
        $crawler = $rendered->crawler();

        self::assertCount(0, $crawler->filter('script'));
        self::assertCount(1, $crawler->filter('form'));
        self::assertSame((string) $payload, $crawler->filter('form')->attr('action'));
        self::assertSame([(string) $payload, (string) $payload, (string) $payload], $crawler->filter('input')->extract(['value']));
    }

    /** @return iterable<string, array{array<string, mixed>, array<string, mixed>}> */
    public static function unavailableActions(): iterable
    {
        yield 'read only' => [[], ['readOnly' => true]];
        yield 'last sign-in method' => [['cannotRemove' => true], []];
        yield 'missing action' => [['disconnectAction' => null], []];
        yield 'missing CSRF token' => [['disconnectToken' => null], []];
        yield 'missing provider subject' => [['subject' => null], []];
        yield 'script action' => [['disconnectAction' => 'javascript:alert(1)'], []];
        yield 'obfuscated script action' => [['disconnectAction' => " \tJaVa\tScRiPt:alert(1)"], []];
        yield 'non-HTTP action' => [['disconnectAction' => 'mailto:example@example.com'], []];
    }

    /**
     * @param array<string, mixed> $account
     * @param array<string, mixed> $props
     */
    #[DataProvider('unavailableActions')]
    public function testUnavailableActionsExposeAnExplanationWithoutAnyMutationForm(array $account, array $props): void
    {
        $account += ['provider' => 'github', 'connected' => true, 'subject' => '123', 'disconnectAction' => '/oauth/github/unlink', 'disconnectToken' => 'csrf'];
        $rendered = $this->renderTwigComponent('ConnectedAccounts', ['accounts' => [$account]] + $props);
        $crawler = $rendered->crawler();
        $button = $crawler->filter('button');

        self::assertCount(0, $crawler->filter('form, input'));
        self::assertCount(1, $button);
        self::assertNotNull($button->attr('disabled'));
        self::assertNotSame('', $crawler->filter('#'.$button->attr('aria-describedby'))->text());
    }
}
