<?php

namespace App\Tests\Functional;

use App\Command\ExportStaticCommand;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * The banner of the static copy (what app:export-static puts on each request as `_static_export`) names the branch the
 * site was built from, not always main.
 */
final class StaticExportBannerTest extends WebTestCase
{
    /**
     * @param array<string, mixed> $context
     */
    private static function banner(array $context, string $path = '/'): string
    {
        $kernel = static::bootKernel();
        $request = Request::create($path);
        $request->attributes->set('_static_export', $context + ['release' => null, 'latest_release' => '0.1.0', 'commit' => 'abc1234def', 'server_only' => []]);
        $response = $kernel->handle($request, HttpKernelInterface::MAIN_REQUEST, false);
        self::assertSame(200, $response->getStatusCode());

        return (string) $response->getContent();
    }

    public function testTheBannerNamesTheBranchTheSiteWasBuiltFrom(): void
    {
        self::assertStringContainsString('</a> on <code>dev</code>', self::banner(['branch' => 'dev']));
    }

    public function testTheBannerNamesMainWithoutABranch(): void
    {
        self::assertStringContainsString('</a> on <code>main</code>', self::banner([]));
    }

    /**
     * @return iterable<string, array{string, array<string, mixed>, string}>
     */
    public static function installCommands(): iterable
    {
        foreach (['/', '/r/button'] as $path) {
            yield $path.' branch' => [$path, ['branch' => 'dev'], '--kit=https://github.com/xormania/uxor:dev<'];
            yield $path.' release' => [$path, ['release' => '0.2.0', 'branch' => 'dev'], '--kit=https://github.com/xormania/uxor:0.2.0<'];
        }
    }

    /**
     * @param array<string, mixed> $context
     */
    #[DataProvider('installCommands')]
    public function testTheInstallCommandNamesTheReleaseOrElseTheBranch(string $path, array $context, string $expected): void
    {
        self::assertStringContainsString($expected, self::banner($context, $path));
    }

    /**
     * The app layout's sidebar sticks at the top of the window, as tall as the window: the notice of a /demo page goes
     * in the column beside it, above the content, so the whole sidebar shows with it. Above the sidebar, it pushed the
     * sidebar's bottom out of the window.
     */
    public function testTheDemoNoticeLeavesTheSidebarTheWholeWindowHeight(): void
    {
        $html = ExportStaticCommand::addDemoNotice(self::banner([], '/demo'), '/uxor');

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
        $html = ExportStaticCommand::addDemoNotice(self::banner([], '/demo/login'), '');

        self::assertMatchesRegularExpression('#<body\b[^>]*><div [^>]*>A static copy of the demo application#', $html);
        self::assertSame(1, substr_count($html, 'A static copy of the demo application'));
    }

    public function testTheLiveDemoNamesNoRef(): void
    {
        $client = static::createClient();
        $client->request('GET', '/r/button');

        self::assertStringContainsString('--kit=https://github.com/xormania/uxor<', (string) $client->getResponse()->getContent());
    }
}
