<?php

namespace App\Tests\Functional;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class DashboardRevenueTest extends WebTestCase
{
    /** @return iterable<string, array{string, string}> */
    public static function periods(): iterable
    {
        yield 'default' => ['/demo', 'This year'];
        yield 'week' => ['/demo?revenue=week', 'This week'];
        yield 'year' => ['/demo?revenue=year', 'This year'];
        yield 'all time' => ['/demo?revenue=all', 'All time'];
    }

    #[DataProvider('periods')]
    public function testTheServerSelectsTheRequestedTab(string $url, string $tab): void
    {
        $client = static::createClient();
        $client->request('GET', $url);

        self::assertResponseIsSuccessful();
        $selected = '[aria-label="Revenue period"] [role="tab"][aria-selected="true"]';
        self::assertSelectorCount(1, $selected);
        self::assertSelectorTextSame($selected, $tab);
    }

    public function testAnEmptyUnknownOrArrayPeriodIsRejected(): void
    {
        $client = static::createClient();
        foreach (['revenue=', 'revenue=month', 'revenue%5B%5D=week'] as $query) {
            $client->request('GET', '/demo?'.$query);
            self::assertResponseStatusCodeSame(400, $query);
        }
    }
}
