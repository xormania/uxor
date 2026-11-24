<?php

namespace App\Tests\Functional;

use App\Command\ExportStaticCommand;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** Runtime examples and application pages supplied to the published website. */
final class DemoExportTest extends WebTestCase
{
    private static function page(string $path): string
    {
        $client = static::createClient();
        $client->request('GET', $path);
        self::assertResponseIsSuccessful();

        return (string) $client->getResponse()->getContent();
    }

    public function testThePreviewIsNotIndexed(): void
    {
        $preview = self::page('/preview/button/default?theme=light');
        self::assertStringContainsString('<meta name="robots" content="noindex">', $preview);
        self::assertStringNotContainsString('rel="canonical"', $preview);
    }

    /**
     * The app layout's sidebar sticks at the top of the window, as tall as the window: the notice of a /demo page goes
     * in the column beside it, above the content, so the whole sidebar shows with it. Above the sidebar, it pushed the
     * sidebar's bottom out of the window.
     */
    public function testTheDemoNoticeLeavesTheSidebarTheWholeWindowHeight(): void
    {
        $html = ExportStaticCommand::addDemoNotice(self::page('/demo'), '/uxor');

        $notice = strpos($html, 'A static copy of the demo application');
        $sidebar = strpos($html, 'id="sidebar"');
        $main = strpos($html, '<main id="main"');
        self::assertNotFalse($notice);
        self::assertNotFalse($sidebar);
        self::assertNotFalse($main);
        self::assertGreaterThan($sidebar, $notice, 'the notice comes after the sidebar');
        self::assertLessThan($main, $notice, 'the notice comes before the content');
        self::assertSame(1, substr_count($html, 'A static copy of the demo application'));
        self::assertStringContainsString('<a href="/uxor/" class="underline hover:text-heading">Back to the gallery</a>', $html);
    }

    public function testTheDemoNoticeOpensAPageWithoutSidebar(): void
    {
        $html = ExportStaticCommand::addDemoNotice(self::page('/demo/login'), '');

        self::assertMatchesRegularExpression('#<body\b[^>]*><div [^>]*>A static copy of the demo application#', $html);
        self::assertSame(1, substr_count($html, 'A static copy of the demo application'));
    }
}
