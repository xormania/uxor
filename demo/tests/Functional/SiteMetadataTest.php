<?php

namespace App\Tests\Functional;

use App\Command\ExportStaticCommand;
use App\Kit\KitReader;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * What the static copy tells search engines and agents (docs/PLAN-docs-automation.md, Stage 3): each public page's
 * canonical URL, description and sharing metadata at the site's public URL, the previews out of the index, the sitemap
 * of the public pages, and the site's llms.txt pointing at the Markdown it renders.
 */
final class SiteMetadataTest extends WebTestCase
{
    private const SITE = 'https://xormania.github.io/uxor';

    /**
     * A page as app:export-static requests it: under the base path, with the site's public URL; or, without $export,
     * as the dev server answers it.
     */
    private static function get(string $path, bool $export = true): string
    {
        $kernel = static::bootKernel();
        $request = $export
            ? Request::create('/uxor'.$path, server: ['SCRIPT_NAME' => '/uxor/index.php', 'SCRIPT_FILENAME' => \dirname(__DIR__, 2).'/public/index.php'])
            : Request::create($path);
        if ($export) {
            $request->attributes->set('_static_export', ['release' => '0.4.0', 'latest_release' => '0.4.0', 'commit' => 'abc1234def', 'branch' => 'main', 'server_only' => [], 'site_url' => self::SITE]);
        }
        $response = $kernel->handle($request, HttpKernelInterface::MAIN_REQUEST, false);
        self::assertSame(200, $response->getStatusCode(), $path);

        return (string) $response->getContent();
    }

    public function testEachPublicPageNamesItsCanonicalUrlAndDescribesItself(): void
    {
        $descriptions = [];
        foreach (['/' => '/', '/install' => '/install/', '/guide' => '/guide/', '/r/button' => '/r/button/', '/r/data-table' => '/r/data-table/'] as $path => $canonical) {
            $html = self::get($path);
            self::assertSame(1, substr_count($html, 'rel="canonical"'), $path);
            self::assertStringContainsString(\sprintf('<link rel="canonical" href="%s%s">', self::SITE, $canonical), $html);
            self::assertStringContainsString(\sprintf('<meta property="og:url" content="%s%s">', self::SITE, $canonical), $html);
            self::assertStringNotContainsString('localhost', $html, "$path: no export request's origin");
            self::assertStringNotContainsString('noindex', $html, "$path: a public page is indexed");

            preg_match('/<meta name="description" content="([^"]+)">/', $html, $description);
            self::assertArrayHasKey(1, $description, $path);
            self::assertStringContainsString(\sprintf('<meta property="og:description" content="%s">', $description[1]), $html);
            self::assertStringNotContainsString('&amp;#', $description[1], "$path: escaped once");
            $descriptions[$path] = $description[1];
        }
        self::assertSame(array_unique($descriptions), $descriptions, 'each page its own description');
        // a recipe's is its README's first paragraph, as text
        self::assertStringStartsWith('A server-driven table: search, filters', $descriptions['/r/data-table']);

        // the dev server's pages name no canonical URL: they are not the published ones
        self::assertStringNotContainsString('rel="canonical"', self::get('/r/button', false));
    }

    public function testAPreviewIsNotIndexedItsRecipePageIs(): void
    {
        self::assertStringContainsString('<meta name="robots" content="noindex">', self::get('/preview/button/default?theme=light'));
    }

    public function testTheSitemapListsThePublicPagesAtTheirCanonicalUrls(): void
    {
        $xml = simplexml_load_string(self::get('/sitemap.xml'));
        self::assertNotFalse($xml);
        $locs = [];
        foreach ($xml->children('http://www.sitemaps.org/schemas/sitemap/0.9') as $url) {
            $locs[] = (string) $url->loc;
        }

        $expected = [self::SITE.'/', self::SITE.'/install/', self::SITE.'/guide/'];
        foreach (array_keys(static::getContainer()->get(KitReader::class)->getRecipes()) as $recipe) {
            $expected[] = self::SITE.'/r/'.$recipe.'/';
        }
        self::assertSame($expected, $locs, 'the index, the guides and every recipe page; no preview, demo page or Markdown copy');
    }

    public function testTheSitesLlmsTxtPointsAtTheMarkdownItRenders(): void
    {
        $llms = self::get('/llms.txt');
        self::assertStringStartsWith("# UXor\n", $llms);

        foreach (array_keys(static::getContainer()->get(KitReader::class)->getRecipes()) as $recipe) {
            self::assertStringNotContainsString('/'.$recipe.'/README.md)', $llms, "$recipe: its Markdown on the site, not its README on GitHub");
        }
        self::assertStringContainsString('(https://xormania.github.io/uxor/r/button.md)', $llms);
        self::assertStringContainsString('(https://xormania.github.io/uxor/install.md)', $llms);
        self::assertStringContainsString('(https://xormania.github.io/uxor/guide.md)', $llms);

        // every Markdown it links is one the site answers: a guide's or an existing recipe's (RecipePageTest and
        // GuidePageTest request them)
        preg_match_all('#\(https://xormania\.github\.io/uxor(/[^)]+\.md)\)#', $llms, $paths);
        self::assertGreaterThanOrEqual(66, \count($paths[1]));
        $recipes = static::getContainer()->get(KitReader::class)->getRecipes();
        foreach (array_unique($paths[1]) as $path) {
            self::assertTrue(\in_array($path, ['/install.md', '/guide.md'], true) || (preg_match('#^/r/([a-z0-9-]+)\.md$#', $path, $recipe) && isset($recipes[$recipe[1]])), $path);
        }
    }

    public function testThePublicUrlIsTheRepositorysGitHubPagesSite(): void
    {
        self::assertSame('https://xormania.github.io/uxor', ExportStaticCommand::pagesUrl('https://github.com/xormania/uxor', '/uxor'));
        self::assertSame('https://xormania.github.io', ExportStaticCommand::pagesUrl('https://github.com/XorMania/uxor', ''));
        $this->expectException(\InvalidArgumentException::class);
        ExportStaticCommand::pagesUrl('https://gitlab.com/xormania/uxor', '/uxor');
    }
}
