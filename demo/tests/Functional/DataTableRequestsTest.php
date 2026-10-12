<?php

namespace App\Tests\Functional;

use App\Demo\DataTableCollector;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpKernel\Profiler\Profile;
use Symfony\UX\LiveComponent\Test\InteractsWithLiveComponents;

/**
 * What one request makes the demo's data tables do, read from the request's profile: the demo's DataTableCollector
 * records each countRows() and loadRows() call. A table request counts once and loads one page once, whatever it
 * asks for; a Live action that read the page does not read it again to render. And what such a request renders: a
 * URL the table does not accept still gets a valid table, a search matching nothing the empty state (the browser
 * tests keep the journeys that use what was rendered).
 */
final class DataTableRequestsTest extends WebTestCase
{
    use InteractsWithLiveComponents;

    /**
     * @return list<string>
     */
    private static function calls(KernelBrowser $client): array
    {
        $profile = $client->getProfile();
        self::assertInstanceOf(Profile::class, $profile, 'the request has a profile: enableProfiler() before it');
        $collector = $profile->getCollector(DataTableCollector::class);
        self::assertInstanceOf(DataTableCollector::class, $collector);

        return $collector->getCalls();
    }

    public function testATablePageCountsOnceAndLoadsOnePageOnce(): void
    {
        $client = static::createClient();
        $client->enableProfiler();

        $client->request('GET', '/lab/data-table-frame?page=2');

        self::assertResponseIsSuccessful();
        self::assertSame(['OrdersTable: count', 'OrdersTable: rows@10'], self::calls($client));
    }

    public function testAPagePastTheEndLoadsOnlyTheLastPage(): void
    {
        $client = static::createClient();
        $client->enableProfiler();

        $client->request('GET', '/lab/data-table-frame?page=1000000&size=50');

        self::assertResponseIsSuccessful();
        self::assertSame(['OrdersTable: count', 'OrdersTable: rows@50'], self::calls($client), '57 rows: the 2nd page of 50');
    }

    public function testALiveTablePageCountsOnceAndLoadsOnce(): void
    {
        $client = static::createClient();
        $client->enableProfiler();

        $client->request('GET', '/lab/data-table-live');

        self::assertResponseIsSuccessful();
        self::assertSame(['LiveOrdersTable: count', 'LiveOrdersTable: rows@0'], self::calls($client));
    }

    public function testALiveActionThatReadThePageDoesNotReadItAgainToRender(): void
    {
        $client = static::createClient();
        $table = $this->createLiveComponent('OrdersTable', [], $client)->refresh();

        $client->enableProfiler();
        $table->call('selectPage');

        self::assertSame(['LiveOrdersTable: count', 'LiveOrdersTable: rows@0'], self::calls($client));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function tablesReadingTheUrl(): iterable
    {
        // an unknown sort, direction and filter value, a page past the end, a page size not offered, a search that is
        // not a string
        yield 'in a Turbo Frame' => ['/lab/data-table-frame?sort=bogus&dir=up&page=999&size=7&f%5Bstatus%5D=nope&q%5B%5D=1'];
        yield 'Live' => ['/lab/data-table-live?sort=bogus&dir=up&page=999&size=7&f%5Bstatus%5D=nope'];
    }

    #[DataProvider('tablesReadingTheUrl')]
    public function testAUrlWithValuesTheTableDoesNotAcceptRendersAValidTable(string $url): void
    {
        $client = static::createClient();
        $crawler = $client->request('GET', $url);

        self::assertResponseIsSuccessful();
        self::assertSame('Showing 51–57 of 57', self::rowsShown($crawler), 'page 999 shows the last page, of 10 rows');
        self::assertCount(7, $crawler->filter('tbody tr'));
        self::assertSame('descending', $crawler->filter('th:contains("Order")')->attr('aria-sort'), 'the default sort');
        self::assertNull($crawler->filter('th:contains("Customer")')->attr('aria-sort'));
        self::assertSame(['10'], $crawler->filter('#orders-size option[selected]')->each(static fn (Crawler $option) => $option->attr('value')));
        self::assertCount(0, $crawler->filter('#orders-filter-status option[selected]'), 'no filter: the first option, All');
        self::assertSame('page', $crawler->filter('[aria-label="Page 6"]')->attr('aria-current'));
    }

    public function testAPageNumberTooLargeForAnOffsetShowsTheLastPage(): void
    {
        $client = static::createClient();
        $client->enableProfiler();

        $crawler = $client->request('GET', '/lab/data-table-frame?page='.\PHP_INT_MAX);

        self::assertResponseIsSuccessful();
        self::assertSame('Showing 51–57 of 57', self::rowsShown($crawler));
        self::assertSame(['OrdersTable: count', 'OrdersTable: rows@50'], self::calls($client));
    }

    public function testASearchMatchingNothingShowsTheEmptyState(): void
    {
        $client = static::createClient();
        $crawler = $client->request('GET', '/lab/data-table-frame?q=nobody');

        self::assertResponseIsSuccessful();
        self::assertSame('No matching rows', $crawler->filter('turbo-frame#orders h2')->text());
        self::assertCount(0, $crawler->filter('table'));
        self::assertSame('No rows', self::rowsShown($crawler));
    }

    private static function rowsShown(Crawler $crawler): string
    {
        $status = $crawler->filter('[role="status"]')->reduce(static fn (Crawler $node) => 1 === preg_match('/^(Showing|No rows)/', trim($node->text())));
        self::assertCount(1, $status, 'one status of the rows shown');

        return trim($status->text());
    }
}
