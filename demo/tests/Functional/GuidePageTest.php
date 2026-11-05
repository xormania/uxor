<?php

namespace App\Tests\Functional;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * The consumer guides the gallery publishes from the repository (App\Kit\GuideDocs): getting started (INSTALL.md) at
 * /install and the guide (docs/GUIDE.md) at /guide, each also as Markdown (/install.md, /guide.md). Their install
 * commands name the release a copy of one shows, and their links reach the gallery's pages or GitHub, never a path of
 * the repository the gallery does not serve.
 */
final class GuidePageTest extends WebTestCase
{
    /**
     * @param array<string, mixed>|null $export what app:export-static puts on each request; null for the dev server
     */
    private static function get(string $path, ?array $export = ['release' => '0.4.0']): Response
    {
        $kernel = static::bootKernel();
        $request = Request::create($path);
        if (null !== $export) {
            $request->attributes->set('_static_export', $export + ['release' => null, 'latest_release' => '0.4.0', 'commit' => 'abc1234def', 'branch' => 'main', 'server_only' => []]);
        }
        $response = $kernel->handle($request, HttpKernelInterface::MAIN_REQUEST, false);
        self::assertSame(200, $response->getStatusCode(), $path);

        return $response;
    }

    public function testEachGuideIsAPageUnderItsOwnTitle(): void
    {
        foreach (['/install' => 'Getting started', '/guide' => 'Guide'] as $path => $title) {
            $html = (string) self::get($path)->getContent();
            self::assertSame(1, substr_count($html, '<h1'), $path);
            self::assertStringContainsString(\sprintf('<h1 id="%s">%s</h1>', strtolower(str_replace(' ', '-', $title)), $title), $html);
            self::assertStringContainsString(\sprintf('<a href="%s.md" type="text/markdown">', $path), $html, 'it links its Markdown');

            preg_match_all('/(?<![\w-])id="([^"]+)"/', $html, $ids);
            self::assertSame(array_unique($ids[1]), $ids[1], "$path: every id on the page is unique");
        }
        // every gallery page links them
        self::assertStringContainsString('<a href="/install" class="underline hover:text-heading">Getting started</a>', (string) self::get('/r/button')->getContent());
        self::assertStringContainsString('<a href="/guide" class="underline hover:text-heading">Guide</a>', (string) self::get('/')->getContent());
    }

    public function testTheInstallCommandsNameTheReleaseACopyOfOneShows(): void
    {
        foreach (['/install', '/guide', '/install.md', '/guide.md'] as $path) {
            $content = (string) self::get($path)->getContent();
            self::assertStringContainsString('--kit=https://github.com/xormania/uxor:0.4.0', $content, $path);
            self::assertStringNotContainsString('uxor:&lt;version&gt;', $content, $path);
            self::assertStringNotContainsString('uxor:<version>', $content, $path);
        }
        // a copy of a branch, and the dev server, keep the placeholder: the guide says to name the latest release
        self::assertStringContainsString('uxor:&lt;version&gt;', (string) self::get('/install', ['branch' => 'dev'])->getContent());
        self::assertStringContainsString('uxor:&lt;version&gt;', (string) self::get('/install', null)->getContent());
    }

    public function testTheGuidesLinksReachTheGallerysPagesOrGitHub(): void
    {
        foreach (['/install', '/guide'] as $path) {
            preg_match_all('/<a href="([^"]*)"/', (string) self::get($path)->getContent(), $hrefs);
            foreach ($hrefs[1] as $href) {
                self::assertMatchesRegularExpression('#^(?:https?:|mailto:|/|\#)#', $href, "$path: no link left relative to the repository");
            }
        }

        $guide = (string) self::get('/guide')->getContent();
        self::assertStringContainsString('<a href="/install">', $guide, "INSTALL.md is the getting-started page");
        self::assertStringContainsString('<a href="/r/dropzone#in-a-live-component">', $guide, "a recipe's README is its page");
        self::assertStringContainsString('id="in-a-live-component"', (string) self::get('/r/dropzone')->getContent(), 'at a heading that exists there');
        self::assertStringContainsString('<a href="https://github.com/xormania/uxor/blob/0.4.0/CHANGELOG.md">', $guide, 'any other file, on GitHub at the release');
        self::assertStringContainsString('<a href="/#recipes">', (string) self::get('/install')->getContent(), 'the recipe list is the gallery');
    }

    public function testEachGuideIsPortableMarkdownBesideTheRecipes(): void
    {
        $response = self::get('/guide.md');
        self::assertSame('text/markdown; charset=UTF-8', $response->headers->get('Content-Type'));
        $markdown = (string) $response->getContent();

        self::assertStringStartsWith("# Guide\n", $markdown);
        self::assertStringContainsString('](install.md)', $markdown);
        self::assertStringContainsString('](r/dropzone.md#in-a-live-component)', $markdown);
        self::assertStringContainsString('](https://github.com/xormania/uxor/blob/0.4.0/CHANGELOG.md)', $markdown);
        self::assertDoesNotMatchRegularExpression('#\]\((?!https?:|mailto:|/|\#|install\.md|guide\.md|r/[a-z0-9-]+\.md)#', $markdown, 'no link relative to the repository');
    }
}
