<?php

namespace App\Tests\DataTable;

use App\UXor\DataTable\DataTableView;
use App\Tests\DataTable\Fixtures\ProductsTable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;

/**
 * What DataTableView gives the template: the page numbers to link, at the first, last and capped pages too; URLs that
 * change one table's state and keep the URL's other parameters, other tables' included, encoded as RFC 3986 (`%20`,
 * never `+`); and the search form's hidden fields, nested and prefixed parameters flattened to field names.
 */
final class DataTableViewTest extends TestCase
{
    private static function view(string $uri, string $prefix = '', int $total = 100): DataTableView
    {
        return (new ProductsTable(prefix: $prefix, total: $total))->handleRequest(Request::create($uri));
    }

    /**
     * @return iterable<string, array{int, int, list<int|null>}>
     */
    public static function windows(): iterable
    {
        yield 'no row' => [0, 1, [1]];
        yield 'one page' => [1, 1, [1]];
        yield 'seven pages, all linked' => [7, 7, [1, 2, 3, 4, 5, 6, 7]];
        yield 'eight pages, the first' => [8, 1, [1, 2, 3, 4, 5, 6, null, 8]];
        yield 'eight pages, the last' => [8, 8, [1, null, 3, 4, 5, 6, 7, 8]];
        yield 'twenty pages, the 4th: no gap after the first' => [20, 4, [1, 2, 3, 4, 5, 6, null, 20]];
        yield 'twenty pages, the 5th' => [20, 5, [1, null, 3, 4, 5, 6, 7, null, 20]];
        yield 'twenty pages, the 6th (the docblock)' => [20, 6, [1, null, 4, 5, 6, 7, 8, null, 20]];
        yield 'twenty pages, the 17th: no gap before the last' => [20, 17, [1, null, 15, 16, 17, 18, 19, 20]];
        yield 'twenty pages, the last' => [20, 20, [1, null, 15, 16, 17, 18, 19, 20]];
    }

    /**
     * @param list<int|null> $window
     */
    #[DataProvider('windows')]
    public function testThePageWindow(int $pages, int $page, array $window): void
    {
        self::assertSame($window, self::view('/?page='.$page, total: $pages * 10)->pageWindow());
    }

    public function testThePageWindowOfACappedTableEndsAtTheLastPageThatCanBeReached(): void
    {
        // a million rows, 10 a page: maxRows() (10,000) makes page 1,000 the last
        $view = self::view('/?page=5000', total: 1_000_000);

        self::assertTrue($view->isCapped());
        self::assertSame([1, null, 995, 996, 997, 998, 999, 1_000], $view->pageWindow());
    }

    public function testEveryPageWindowLinksTheEndsAndTheCurrentPageInOrderWithoutAdjacentGaps(): void
    {
        for ($pages = 1; $pages <= 30; ++$pages) {
            for ($page = 1; $page <= $pages; ++$page) {
                $window = self::view('/?page='.$page, total: $pages * 10)->pageWindow();
                $numbers = array_values(array_filter($window, static fn (?int $number): bool => null !== $number));
                $context = \sprintf('%d pages, page %d: %s', $pages, $page, json_encode($window));

                self::assertSame(1, $window[0], $context);
                self::assertSame($pages, $window[\count($window) - 1], $context);
                self::assertContains($page, $window, $context);
                self::assertLessThanOrEqual(9, \count($window), $context);
                $sorted = $numbers;
                sort($sorted);
                self::assertSame(array_values(array_unique($sorted)), $numbers, $context);
                foreach ($window as $i => $number) {
                    if (null === $number) {
                        $before = $window[$i - 1];
                        $after = $window[$i + 1];
                        self::assertIsInt($before, $context);
                        self::assertIsInt($after, $context);
                        self::assertGreaterThan(1, $after - $before, $context.': a gap leaves out a page');
                    }
                }
            }
        }
    }

    public function testAPrefixedTablesUrlKeepsTheOtherTablesAndParameters(): void
    {
        $view = self::view('/shop?tab=b&orders[page]=3&orders[q]=x&products[page]=2&products[sort]=price&products[dir]=asc', 'products');

        self::assertSame('/shop?tab=b&orders%5Bpage%5D=3&orders%5Bq%5D=x&products%5Bsort%5D=price&products%5Bdir%5D=asc&products%5Bpage%5D=5', $view->url(['page' => 5]));
        // another sort goes back to the first page, which the URL leaves out
        self::assertSame('/shop?tab=b&orders%5Bpage%5D=3&orders%5Bq%5D=x&products%5Bsort%5D=name&products%5Bdir%5D=asc', $view->url(['sort' => 'name', 'direction' => 'asc']));
    }

    public function testATableWithoutPrefixReplacesOnlyItsOwnParameters(): void
    {
        $view = self::view('/shop?q=old&page=3&size=25&tab=b&orders[page]=2');

        self::assertSame('/shop?tab=b&orders%5Bpage%5D=2&q=old&sort=name&dir=desc&size=25', $view->url());
    }

    public function testUrlsAreEncodedAsRfc3986(): void
    {
        $view = self::view('/shop?tab=a%20b');

        self::assertSame('/shop?tab=a%20b&q=a%20b%2Bc%2F%C3%A9%26&sort=name&dir=desc', $view->url(['search' => 'a b+c/é&']));
    }

    public function testAPrefixedTablesHiddenFieldsHoldTheOtherParametersAndItsSort(): void
    {
        $view = self::view('/shop?tab=b&note=a%2Bb%20c%26d&filter[a][]=x&filter[a][]=y&orders[page]=2&products[q]=lamp&products[page]=3&products[sort]=price&products[dir]=asc', 'products');

        self::assertSame([
            'tab' => 'b',
            'note' => 'a+b c&d',
            'filter[a][0]' => 'x',
            'filter[a][1]' => 'y',
            'orders[page]' => '2',
            'products[sort]' => 'price',
            'products[dir]' => 'asc',
        ], $view->hiddenFields());
    }

    public function testATableWithoutPrefixLeavesItsOwnParametersOutOfTheHiddenFields(): void
    {
        $view = self::view('/shop?tab=b&q=lamp&page=3&size=25&f[status]=active&orders[page]=2');

        self::assertSame(['tab' => 'b', 'orders[page]' => '2', 'sort' => 'name', 'dir' => 'desc'], $view->hiddenFields());
    }
}
