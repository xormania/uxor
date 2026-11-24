<?php

namespace UXor\Website\Tests;

use UXor\Website\Website;

final class SiteMetadataTest extends WebsiteTestCase
{
    public function testEachPublicPageNamesItsCanonicalUrlAndDescribesItself(): void
    {
        $descriptions = [];
        foreach (['', 'install/', 'guide/', 'composer/', 'advanced/', 'r/button/', 'r/data-table/'] as $path) {
            $html = self::page($path.'index.html');
            $dom = \Dom\HTMLDocument::createFromString($html, LIBXML_NOERROR);
            $url = self::SITE.'/'.$path;
            self::assertSame($url, $dom->querySelector('link[rel="canonical"]')?->getAttribute('href'), $path);
            self::assertSame($dom->querySelector('title')->textContent, $dom->querySelector('meta[property="og:title"]')?->getAttribute('content'), $path);
            self::assertSame($url, $dom->querySelector('meta[property="og:url"]')?->getAttribute('content'));
            $description = $dom->querySelector('meta[name="description"]')?->getAttribute('content');
            self::assertNotEmpty($description);
            self::assertSame($description, $dom->querySelector('meta[property="og:description"]')?->getAttribute('content'));
            self::assertStringNotContainsString('localhost', $html);
            self::assertStringNotContainsString('noindex', $html);
            self::assertStringNotContainsString('&amp;#', $html);
            $descriptions[$path] = $description;
        }
        self::assertSame(array_unique($descriptions), $descriptions);
        self::assertSame('Compare "debug" output for <draft> & release builds.', $descriptions['advanced/']);
        self::assertStringStartsWith('A server-driven table: search, filters', $descriptions['r/data-table/']);
    }

    public function testTheSitemapListsThePublicPagesAtTheirCanonicalUrls(): void
    {
        $xml = simplexml_load_string(self::page('sitemap.xml'));
        self::assertNotFalse($xml);
        $locations = [];
        foreach ($xml->children('http://www.sitemaps.org/schemas/sitemap/0.9') as $url) {
            $locations[] = (string) $url->loc;
        }
        $expected = [self::SITE.'/'];
        foreach (['composer', 'advanced', 'install', 'guide'] as $slug) {
            $expected[] = self::SITE.'/'.$slug.'/';
        }
        foreach (array_keys(self::kit()->getRecipes()) as $name) {
            $expected[] = self::SITE.'/r/'.$name.'/';
        }
        self::assertEqualsCanonicalizing($expected, $locations, 'Only the website index, guides and recipe pages are indexed.');
    }

    public function testTheSitesLlmsTxtPointsAtTheMarkdownItRenders(): void
    {
        $llms = self::page('llms.txt');
        self::assertStringStartsWith("# UXor\n", $llms);
        foreach (['composer', 'advanced', 'install', 'guide'] as $slug) {
            self::assertSame(1, substr_count($llms, '('.self::SITE.'/'.$slug.'.md)'));
            self::assertStringStartsWith('# ', self::page($slug.'.md'));
        }
        foreach (array_keys(self::kit()->getRecipes()) as $name) {
            self::assertStringNotContainsString('/'.$name.'/README.md)', $llms);
            self::assertStringContainsString('('.self::SITE.'/r/'.$name.'.md)', $llms);
            self::assertStringStartsWith('# ', self::page('r/'.$name.'.md'));
        }
    }

    public function testThePublicUrlIsTheRepositorysGitHubPagesSite(): void
    {
        self::assertSame(self::SITE, Website::pagesUrl('https://github.com/xormania/uxor', '/uxor'));
        self::assertSame('https://xormania.github.io', Website::pagesUrl('https://github.com/XorMania/uxor', ''));
        $this->expectException(\InvalidArgumentException::class);
        Website::pagesUrl('https://gitlab.com/xormania/uxor', '/uxor');
    }
}
