<?php

namespace App\Tests\Functional;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class StylesheetBoundaryTest extends WebTestCase
{
    /** @return iterable<string, array{string, string, int}> */
    public static function pages(): iterable
    {
        yield 'demo dashboard' => ['/demo', 'demo-app', 200];
        yield 'demo settings layout' => ['/demo/settings/profile', 'demo-app', 200];
        yield 'demo sign-in layout' => ['/demo/login', 'demo-app', 200];
        yield 'demo blank layout' => ['/demo/blank', 'demo-app', 200];
        yield 'demo error layout' => ['/demo/not-found', 'demo-app', 404];
        yield 'forms fixture' => ['/forms', 'toolkit-fixtures', 200];
        yield 'lab with an additional stylesheet' => ['/lab/dropdown-turbo/two', 'toolkit-fixtures', 200];
        yield 'recipe preview' => ['/preview/button/default?theme=light', 'toolkit-fixtures', 200];
        yield 'OAuth sign-in fixture' => ['/oauth-demo/login', 'toolkit-fixtures', 200];
    }

    #[DataProvider('pages')]
    public function testEachPageLoadsItsOwnStylesheet(string $url, string $expected, int $status): void
    {
        $client = self::createClient();
        $page = $client->request('GET', $url);

        self::assertResponseStatusCodeSame($status);
        $links = $page->filter('head link[rel="stylesheet"][href^="/assets/styles/app-"], head link[rel="stylesheet"][href^="/assets/styles/demo-app-"], head link[rel="stylesheet"][href^="/assets/styles/toolkit-fixtures-"]');
        self::assertCount(1, $links);
        self::assertStringStartsWith('/assets/styles/'.$expected.'-', (string) $links->attr('href'));
        self::assertSame('dynamic', $links->attr('data-turbo-track'));
    }
}
