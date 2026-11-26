<?php

namespace UXor\Website\Tests;

final class GuidePageTest extends WebsiteTestCase
{
    public function testEachRegisteredGuideHasOneTitleAndLinksItsMarkdown(): void
    {
        foreach (self::GUIDES as $slug => $guide) {
            $source = file(self::source().'/'.$guide['file'], FILE_IGNORE_NEW_LINES);
            self::assertIsArray($source);
            self::assertStringStartsWith('# ', $source[0]);
            $title = substr($source[0], 2);
            $html = self::page($slug.'/index.html');
            $dom = \Dom\HTMLDocument::createFromString($html, LIBXML_NOERROR);
            self::assertCount(1, $dom->querySelectorAll('h1'), $slug);
            $heading = $dom->querySelector('h1');
            self::assertSame($title, $heading->textContent, $slug);
            self::assertSame(strtolower(str_replace(' ', '-', $title)), $heading->getAttribute('id'), $slug);
            self::assertNotNull($dom->querySelector('a[type="text/markdown"][href="/uxor/'.$slug.'.md"]'), $slug);
            self::assertStringStartsWith('# '.$title."\n", self::page($slug.'.md'));

            preg_match_all('/(?<![\w-])id="([^"]+)"/', $html, $ids);
            self::assertSame(array_unique($ids[1]), $ids[1], $slug.': unique ids');
            foreach ($dom->querySelectorAll('a[href]') as $link) {
                self::assertMatchesRegularExpression('#^(?:https?:|mailto:|/|\#)#', $link->getAttribute('href'));
            }
            self::assertNotNull($dom->querySelector('nav[aria-label="Main"] a[href="/uxor/#guides"]'), $slug);
        }
    }

    public function testTheGuideDirectoryGroupsTheCatalogEntriesByTheirDeclaredSections(): void
    {
        $dom = \Dom\HTMLDocument::createFromString(self::page('index.html'), LIBXML_NOERROR);
        $directory = $dom->querySelector('main #guides');
        self::assertNotNull($directory);
        $expected = [];
        foreach (self::GUIDES as $slug => $guide) {
            $expected[$guide['section']][] = '/uxor/'.$slug.'/';
            $link = $directory->querySelector('a[href="/uxor/'.$slug.'/"]');
            self::assertNotNull($link, $slug);
            self::assertStringContainsString($guide['title'], $link->textContent);
            self::assertStringContainsString($guide['description'], $directory->textContent);
        }

        $actual = [];
        $current = '';
        foreach ($directory->querySelectorAll('h3, a[href]') as $element) {
            if ('h3' === $element->localName) {
                $current = trim($element->textContent);
            } elseif (str_starts_with($element->getAttribute('href'), '/uxor/')) {
                $actual[$current][] = $element->getAttribute('href');
            }
        }
        self::assertEqualsCanonicalizing($expected, $actual);
        $recipe = \Dom\HTMLDocument::createFromString(self::recipeHtml('button'), LIBXML_NOERROR);
        self::assertNotNull($recipe->querySelector('nav[aria-label="Main"] a[href="/uxor/#guides"]'));
    }

    public function testTheContentsLinksUseTheRenderedChapterHeadingsAndTheirUniqueIds(): void
    {
        $dom = \Dom\HTMLDocument::createFromString(self::page('advanced/index.html'), LIBXML_NOERROR);
        $headings = [];
        foreach ($dom->querySelectorAll('[data-testid="guide"] h2[id]') as $heading) {
            $headings['#'.$heading->getAttribute('id')] = trim($heading->textContent);
        }
        self::assertSame(['Local tools', 'Repeated heading', 'Repeated heading'], array_values($headings));
        $lists = $dom->querySelectorAll('nav[aria-label="On this page"] ul');
        self::assertGreaterThan(0, $lists->length);
        foreach ($lists as $list) {
            $links = [];
            foreach ($list->querySelectorAll('a') as $link) {
                $links[$link->getAttribute('href')] = trim($link->textContent);
            }
            self::assertSame($headings, $links);
        }
    }

    public function testTheInstallCommandsNameTheReleaseACopyOfOneShows(): void
    {
        foreach (['install/index.html', 'guide/index.html', 'install.md', 'guide.md'] as $page) {
            $content = self::page($page);
            self::assertStringContainsString('--kit=https://github.com/xormania/uxor:0.4.0', $content, $page);
            self::assertStringNotContainsString('uxor:&lt;version&gt;', $content);
            self::assertStringNotContainsString('uxor:<version>', $content);
        }
        self::assertStringContainsString('uxor:&lt;version&gt;', self::page('install/index.html', null, 'dev'));
        self::assertStringContainsString('uxor:<version>', self::page('install.md', null, 'dev'));
    }

    public function testTheGuidesLinksReachTheGallerysPagesOrGitHub(): void
    {
        $guide = self::page('guide/index.html');
        self::assertStringContainsString('href="/uxor/install/"', $guide);
        self::assertStringContainsString('href="/uxor/r/dropzone/#in-a-live-component"', $guide);
        self::assertStringContainsString('id="in-a-live-component"', self::recipeHtml('dropzone'));
        self::assertStringContainsString('href="https://github.com/xormania/uxor/blob/0.4.0/CHANGELOG.md"', $guide);
        $install = self::page('install/index.html');
        self::assertStringContainsString('href="/uxor/#recipes"', $install);
        self::assertStringContainsString('href="https://github.com/xormania/uxor/releases"', $install);
        self::assertStringContainsString('href="/uxor/application-testing/"', $install);
    }

    public function testNestedGuidesResolveSiblingAndRootLinksInHtmlAndMarkdown(): void
    {
        $start = self::page('composer/index.html');
        self::assertStringContainsString('href="/uxor/advanced/#local-tools"', $start);
        self::assertStringContainsString('id="local-tools"', self::page('advanced/index.html'));
        self::assertStringContainsString('href="/uxor/install/">Offline install guide</a>', $start);
        $portable = self::page('composer.md');
        self::assertStringContainsString('](advanced.md#local-tools)', $portable);
        self::assertStringContainsString('[Install](install.md)', $portable);
        self::assertStringContainsString('[Offline install guide](install.md)', $portable);
        self::assertStringContainsString('](composer.md)', self::page('advanced.md'));
    }

    public function testEachGuideIsPortableMarkdownBesideTheRecipes(): void
    {
        $markdown = self::page('guide.md');
        self::assertStringContainsString('](install.md)', $markdown);
        self::assertStringContainsString('](r/dropzone.md#in-a-live-component)', $markdown);
        self::assertStringContainsString('](https://github.com/xormania/uxor/blob/0.4.0/CHANGELOG.md)', $markdown);
        $guideSlugs = implode('|', array_keys(self::GUIDES));
        self::assertDoesNotMatchRegularExpression('#\]\((?!https?:|mailto:|/|\#|(?:'.$guideSlugs.')\.md|r/[a-z0-9-]+\.md)#', $markdown);
        $install = self::page('install.md');
        self::assertStringContainsString('](application-testing.md)', $install);
        foreach (['docs/RECIPES.md', 'docs/PROJECT-AGENTS-SNIPPET.md'] as $document) {
            self::assertStringContainsString('](https://github.com/xormania/uxor/blob/0.4.0/'.$document.')', $install);
        }
        self::assertStringContainsString('](https://github.com/xormania/uxor/releases)', $install);
    }
}
