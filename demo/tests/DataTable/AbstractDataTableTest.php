<?php

namespace App\Tests\DataTable;

use App\Tests\DataTable\Fixtures\ProductsTable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;

/**
 * What an extension of AbstractDataTable gets without overriding anything: handleRequest() reads its own parameters
 * (under its prefix when it has one) and falls back to the defaults when they are malformed, and rowId() finds the id
 * of an array, an object with getId() or one with a public `id`, or says to override it.
 */
final class AbstractDataTableTest extends TestCase
{
    /**
     * @return iterable<string, array{string}>
     */
    public static function malformedPrefixes(): iterable
    {
        yield 'a string' => ['/products?products=oops&page=3'];
        yield 'empty' => ['/products?products=&page=3'];
    }

    #[DataProvider('malformedPrefixes')]
    public function testAPrefixedTableGivenAStringInsteadOfItsParametersShowsTheDefaults(string $uri): void
    {
        $view = (new ProductsTable(prefix: 'products', total: 100))->handleRequest(Request::create($uri));

        self::assertSame(['', [], 'name', 'desc', 1, 10], [$view->query->search, $view->query->filters, $view->query->sort, $view->query->direction, $view->query->page, $view->query->pageSize]);
    }

    public function testAPrefixedTableReadsOnlyItsOwnParameters(): void
    {
        $request = Request::create('/products?page=4&q=top&orders[page]=5&products[page]=2&products[q]=%20lamp%20&products[f][status]=active&products[sort]=price&products[dir]=asc&products[size]=25');

        $query = (new ProductsTable(prefix: 'products', total: 100))->handleRequest($request)->query;

        self::assertSame(['lamp', ['status' => 'active'], 'price', 'asc', 2, 25], [$query->search, $query->filters, $query->sort, $query->direction, $query->page, $query->pageSize]);
    }

    public function testATableWithoutPrefixIgnoresAnotherTablesParameters(): void
    {
        $query = (new ProductsTable(total: 100))->handleRequest(Request::create('/products?orders[page]=5&orders[q]=x'))->query;

        self::assertSame(['', 1], [$query->search, $query->page]);
    }

    /**
     * @return iterable<string, array{mixed, string|int}>
     */
    public static function rows(): iterable
    {
        yield 'an array, integer id' => [['id' => 7, 'name' => 'Lamp'], 7];
        yield 'an array, string id' => [['id' => 'sku-7'], 'sku-7'];
        yield 'an object with getId()' => [new class {
            public int $id = 1;

            public function getId(): string
            {
                return 'from-getter';
            }
        }, 'from-getter'];
        yield 'an object with a public id' => [(object) ['id' => 9], 9];
        yield 'an id of 0' => [['id' => 0], 0];
    }

    #[DataProvider('rows')]
    public function testTheIdOfARow(mixed $row, string|int $id): void
    {
        self::assertSame($id, (new ProductsTable())->rowId($row));
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function rowsWithoutId(): iterable
    {
        yield 'an array without id' => [['uuid' => 'a']];
        yield 'an array with a null id' => [['id' => null]];
        yield 'an array with a float id' => [['id' => 1.5]];
        yield 'an object without id' => [new \stdClass()];
        yield 'an object whose getId() gives null' => [new class {
            public int $id = 3;

            public function getId(): null
            {
                return null;
            }
        }];
        yield 'a string' => ['row-1'];
        yield 'an integer' => [1];
    }

    #[DataProvider('rowsWithoutId')]
    public function testARowWithoutAnIdSaysToOverrideRowId(mixed $row): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage(ProductsTable::class.' cannot find the id of a row: override rowId().');

        (new ProductsTable())->rowId($row);
    }
}
