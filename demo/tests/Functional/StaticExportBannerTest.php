<?php

namespace App\Tests\Functional;

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
    private static function banner(array $context): string
    {
        $kernel = static::bootKernel();
        $request = Request::create('/');
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
}
