<?php

namespace App\Tests\Security;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Response;

/**
 * The demo's browser hardening headers and its enforced Content Security Policy on the pages the kit renders
 * (demo/src/EventListener/SecurityHeadersListener.php), and the nonces the markup carries: every `<script>` of the
 * page the policy's script nonce, the layouts' `<meta name="csp-nonce">` its style nonce (Turbo gives that one to its
 * progress bar's `<style>`). Each page as the server answers it, parsed as a browser parses it (PHP's
 * Dom\HTMLDocument, an HTML5 parser).
 *
 * The policy's enforcement is the browsers': the Playwright fixtures fail every test, in every engine, on a violation
 * (tests/e2e/fixtures.ts, recordCspViolations), and tests/e2e/csp.spec.ts keeps what a blocked inline script or style
 * would silently break (the theme before the first paint, Turbo's progress bar, the Progress bars) and the error pages.
 */
final class SecurityHeadersTest extends WebTestCase
{
    /** A page of each kind and of each recipe with a controller of its own: demo app, forms, lab and recipe previews. */
    private const PAGES = [
        '/lab', '/preview/button/default?theme=light', '/preview/dropdown/default?theme=light', '/demo', '/demo/login',
        '/lab/live-table', '/lab/popover-turbo', '/preview/popover/default?theme=light', '/lab/calendar-turbo',
        '/preview/calendar/default?theme=light', '/lab/date-picker-turbo', '/preview/date-picker/default?theme=light',
        '/lab/chart-turbo', '/preview/chart/default?theme=light', '/lab/dropzone-turbo', '/preview/dropzone/default?theme=light',
        '/forms', '/lab/dropzone-form', '/lab/live-dropzone', '/lab/editor-turbo', '/preview/editor/default?theme=light',
        '/lab/markdown-turbo', '/preview/markdown-editor/default?theme=light', '/lab/side-nav', '/preview/side-nav/default?theme=light',
        '/lab/mobile-nav', '/preview/mobile-nav/default?theme=light', '/lab/nav-menu', '/preview/nav-menu/default?theme=light',
        '/lab/dropdown-turbo', '/lab/modal-turbo', '/lab/drawer-turbo', '/lab/section-nav', '/preview/section-nav/default?theme=light',
        '/preview/tabs/vertical?theme=light', '/demo/settings/notifications',
    ];

    /** @return iterable<string, array{string}> */
    public static function pages(): iterable
    {
        foreach (self::PAGES as $path) {
            yield $path => [$path];
        }
    }

    #[DataProvider('pages')]
    public function testThePageAnswersWithTheHardeningHeadersAndANonceBasedPolicyItsScriptsCarry(string $path): void
    {
        $client = static::createClient();
        $client->request('GET', $path);
        $response = $client->getResponse();
        self::assertSame(200, $response->getStatusCode(), $path);

        self::assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        // not no-referrer: same-origin POSTs would send `Origin: null`, which the stateless CSRF check rejects
        self::assertSame('same-origin', $response->headers->get('Referrer-Policy'));
        self::assertStringContainsString('camera=()', (string) $response->headers->get('Permissions-Policy'));
        self::assertFalse($response->headers->has('Content-Security-Policy-Report-Only'));

        $policy = self::policy($response);
        self::assertSame(["'self'"], $policy['frame-ancestors'] ?? null, 'frame-ancestors');
        self::assertSame(["'none'"], $policy['object-src'] ?? null, 'object-src');
        self::assertSame(["'none'"], $policy['base-uri'] ?? null, 'base-uri');
        self::assertSame(["'self'"], $policy['form-action'] ?? null, 'form-action');
        self::assertCount(2, $policy['script-src'] ?? [], 'script-src');
        self::assertContains("'strict-dynamic'", $policy['script-src']);
        self::assertCount(2, $policy['style-src'] ?? [], 'style-src');
        self::assertContains("'self'", $policy['style-src']);
        // style attributes: none at all, README previews included (tools/docs-lint.mjs keeps them out of the examples)
        self::assertArrayNotHasKey('style-src-attr', $policy);
        $script = self::nonce($policy['script-src']);
        $style = self::nonce($policy['style-src']);
        self::assertNotSame($script, $style, 'the script and style nonces differ');

        $document = \Dom\HTMLDocument::createFromString((string) $response->getContent(), \LIBXML_NOERROR);
        $scripts = array_map(static fn (\Dom\Element $element): ?string => $element->getAttribute('nonce'), iterator_to_array($document->querySelectorAll('script')));
        self::assertNotEmpty($scripts, 'the page has scripts');
        self::assertSame([$script], array_values(array_unique($scripts, \SORT_REGULAR)), 'every script carries the script nonce');
        $meta = $document->querySelectorAll('meta[name="csp-nonce"]');
        self::assertCount(1, $meta, 'one csp-nonce meta');
        self::assertSame($style, $meta->item(0)?->getAttribute('nonce'), 'the csp-nonce meta carries the style nonce');
    }

    /** @return array<string, list<string>> each directive of the enforced policy, with its sources */
    private static function policy(Response $response): array
    {
        $policy = [];
        foreach (explode(';', (string) $response->headers->get('Content-Security-Policy')) as $directive) {
            $parts = preg_split('/\s+/', trim($directive), -1, \PREG_SPLIT_NO_EMPTY) ?: [];
            if ($parts) {
                $policy[array_shift($parts)] = $parts;
            }
        }

        return $policy;
    }

    /** @param list<string> $sources */
    private static function nonce(array $sources): string
    {
        $nonces = array_values(array_filter($sources, static fn (string $source): bool => 1 === preg_match("/^'nonce-[\\w-]+'$/", $source)));
        self::assertCount(1, $nonces, 'one nonce in '.implode(' ', $sources));

        return substr($nonces[0], \strlen("'nonce-"), -1);
    }
}
