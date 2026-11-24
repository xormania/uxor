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

    public function testTheFooterLinksTheReleasesReadmeAndChangelog(): void
    {
        foreach (['README.md', 'CHANGELOG.md'] as $name) {
            self::assertStringContainsString('https://github.com/xormania/uxor/blob/0.4.0/'.$name.'"', self::page('index.html'));
            self::assertStringContainsString('https://github.com/xormania/uxor/blob/main/'.$name.'"', self::page('index.html', null, 'dev'));
        }
        self::assertStringContainsString('https://github.com/xormania/uxor/blob/main/SECURITY.md"', self::page('index.html'));
    }
}
