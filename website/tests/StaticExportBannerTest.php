<?php

namespace UXor\Website\Tests;

final class StaticExportBannerTest extends WebsiteTestCase
{
    public function testTheUnreleasedCopyNamesItsBranch(): void
    {
        self::assertStringContainsString('on <code>dev</code>', self::page('index.html', null, 'dev'));
        self::assertStringContainsString('on <code>main</code>', self::page('index.html', null));
    }

    public function testTheInstallCommandNamesTheReleaseOrElseTheBranch(): void
    {
        foreach (['index.html', 'r/button/index.html'] as $page) {
            foreach (['dev' => null, self::RELEASE => self::RELEASE] as $ref => $release) {
                self::assertMatchesRegularExpression('#--kit=https://github\.com/xormania/uxor:'.preg_quote($ref, '#').'\s*<#', self::page($page, $release, 'dev'));
            }
        }
    }

    public function testPageSourceLinksNameTheBuiltRevisionAndUseFileOrDirectoryUrls(): void
    {
        foreach ([
            [self::RELEASE, 'abc1234def', 'abc1234def'],
            [null, 'abc1234def', 'abc1234def'],
            [self::RELEASE, null, self::RELEASE],
            [null, null, 'dev'],
        ] as [$release, $commit, $expected]) {
            $root = 'https://github.com/xormania/uxor';
            $guide = self::page('composer/index.html', $release, 'dev', $commit);
            $recipe = self::page('r/button/index.html', $release, 'dev', $commit);
            $links = [
                [$guide, 'View source on GitHub', "$root/blob/$expected/".self::GUIDES['composer']['file']],
                [$recipe, 'README', "$root/blob/$expected/button/README.md"],
                [$recipe, 'Source', "$root/tree/$expected/button"],
            ];
            foreach ($links as [$html, $label, $url]) {
                $dom = \Dom\HTMLDocument::createFromString($html, LIBXML_NOERROR);
                $link = $dom->querySelector('main a[href="'.$url.'"]');
                self::assertNotNull($link, $url);
                self::assertSame($label, trim($link->textContent), $url);
            }
        }
    }

    public function testTheFooterLinksTheReleasesReadmeAndChangelog(): void
    {
        foreach (['README.md', 'CHANGELOG.md'] as $name) {
            self::assertStringContainsString('https://github.com/xormania/uxor/blob/0.4.0/'.$name.'"', self::page('index.html'));
            self::assertStringContainsString('https://github.com/xormania/uxor/blob/main/'.$name.'"', self::page('index.html', null, 'dev'));
        }
        self::assertStringContainsString('https://github.com/xormania/uxor/blob/main/SECURITY.md"', self::page('index.html'));
    }
}
