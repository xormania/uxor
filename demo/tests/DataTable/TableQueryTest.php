<?php

namespace App\Tests\DataTable;

use App\UXor\DataTable\TableQuery;
use App\Tests\DataTable\Fixtures\ProductsTable;
use App\Tests\DataTable\Fixtures\RecordingDataTable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * What TableQuery::fromValues() makes of untrusted values: the page never starts past the table's maxRows() (10,000);
 * the search is trimmed and cut to 100 characters, not bytes; a value of the wrong type falls back to the default; a
 * filter value is one of its choices, as a string, in the table's filter order; the sort is a sortable column, mapped
 * to its server field, and the default sort comes with the default direction.
 */
final class TableQueryTest extends TestCase
{
    public function testADeepPageAtFiftyRowsIsCutToPage200(): void
    {
        $query = TableQuery::fromValues(['page' => 1_000_000, 'pageSize' => 50], new RecordingDataTable(1_000_000));

        self::assertSame(200, $query->page);
        self::assertSame(9_950, $query->offset());
    }

    public function testTheOffsetStaysBelowMaxRows(): void
    {
        $table = new RecordingDataTable(1_000_000);
        $query = TableQuery::fromValues(['page' => 1_000_000, 'pageSize' => 50], $table);

        self::assertLessThan($table->maxRows(), $query->offset());
    }

    public function testADeepPageAtTenRowsIsCutToPage1000(): void
    {
        $query = TableQuery::fromValues(['page' => 1_000_000, 'pageSize' => 10], new RecordingDataTable(1_000_000));

        self::assertSame(1_000, $query->page);
        self::assertSame(9_990, $query->offset());
    }

    public function testWithPageKeepsTheSameBound(): void
    {
        $query = TableQuery::fromValues(['page' => 1, 'pageSize' => 10], new RecordingDataTable(1_000_000));

        self::assertSame(5, $query->withPage(5)->page);
        self::assertSame(1_000, $query->withPage(\PHP_INT_MAX)->page);
    }

    public function testTheSearchIsTrimmedThenCutToOneHundredCharactersNotBytes(): void
    {
        // 2 bytes a character: a cut by bytes would keep 50, or split a character
        $query = TableQuery::fromValues(['search' => "  \t".str_repeat('é', 150)." \n"], new ProductsTable());

        self::assertSame(str_repeat('é', 100), $query->search);
        self::assertTrue(mb_check_encoding($query->search, 'UTF-8'));
    }

    public function testTheSearchIsTrimmedBeforeItIsCut(): void
    {
        $query = TableQuery::fromValues(['search' => str_repeat(' ', 5).str_repeat('ж', 100).'x'], new ProductsTable());

        self::assertSame(str_repeat('ж', 100), $query->search);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function wrongTypes(): iterable
    {
        yield 'arrays' => [['search' => ['x'], 'filters' => [['active']], 'sort' => ['price'], 'direction' => ['asc'], 'page' => [2], 'pageSize' => [25]]];
        yield 'numbers and booleans' => [['search' => 12, 'filters' => 'status=active', 'sort' => 1, 'direction' => true, 'page' => 2.5, 'pageSize' => false]];
        yield 'strings that are not numbers' => [['page' => '2abc', 'pageSize' => '25 rows']];
        yield 'a page below 1' => [['page' => '0']];
        yield 'a negative page' => [['page' => -3]];
        yield 'a page size the table does not offer' => [['pageSize' => '50']];
        yield 'nulls' => [['search' => null, 'filters' => null, 'sort' => null, 'direction' => null, 'page' => null, 'pageSize' => null]];
    }

    /**
     * @param array{search?: mixed, filters?: mixed, sort?: mixed, direction?: mixed, page?: mixed, pageSize?: mixed} $values
     */
    #[DataProvider('wrongTypes')]
    public function testAValueOfTheWrongTypeFallsBackToTheDefault(array $values): void
    {
        $query = TableQuery::fromValues($values, new ProductsTable());

        self::assertSame('', $query->search);
        self::assertSame([], $query->filters);
        self::assertSame('name', $query->sort);
        self::assertSame('desc', $query->direction);
        self::assertSame(1, $query->page);
        self::assertSame(10, $query->pageSize);
    }

    public function testNumericStringsAreReadAsNumbers(): void
    {
        $query = TableQuery::fromValues(['page' => '3', 'pageSize' => '25'], new ProductsTable());

        self::assertSame(3, $query->page);
        self::assertSame(25, $query->pageSize);
    }

    public function testAFilterKeepsOnlyItsChoicesAsStringsInTheTablesOrder(): void
    {
        $query = TableQuery::fromValues(['filters' => [
            'year' => 2025,              // a number: the choice '2025', as a string
            'unknown' => 'x',            // not a filter of the table
            'status' => 'active',
        ]], new ProductsTable());

        self::assertSame(['status' => 'active', 'year' => '2025'], $query->filters);
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function notAChoice(): iterable
    {
        yield 'a label' => ['Active'];
        yield 'another case' => ['ACTIVE'];
        yield 'spaces around' => [' active'];
        yield 'empty' => [''];
        yield 'a list' => [['active']];
        yield 'a float' => [2024.0];
        yield 'a boolean' => [true];
    }

    #[DataProvider('notAChoice')]
    public function testAFilterValueThatIsNotOneOfItsChoicesIsDropped(mixed $value): void
    {
        $query = TableQuery::fromValues(['filters' => ['status' => $value, 'year' => $value]], new ProductsTable());

        self::assertSame([], $query->filters);
    }

    public function testASortableColumnSortsByItsServerField(): void
    {
        $table = new ProductsTable();

        $byName = TableQuery::fromValues(['sort' => 'name', 'direction' => 'DESC'], $table);
        self::assertSame(['name', 'p.name', 'desc'], [$byName->sort, $byName->sortField, $byName->direction]);

        // sortable() without a field sorts by the key
        $byPrice = TableQuery::fromValues(['sort' => 'price', 'direction' => 'asc'], $table);
        self::assertSame(['price', 'price', 'asc'], [$byPrice->sort, $byPrice->sortField, $byPrice->direction]);
    }

    public function testADirectionThatIsNotAscOrDescIsAsc(): void
    {
        $query = TableQuery::fromValues(['sort' => 'price', 'direction' => 'up'], new ProductsTable());

        self::assertSame(['price', 'asc'], [$query->sort, $query->direction]);
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function notASortableColumn(): iterable
    {
        yield 'no sort' => [null];
        yield 'a column that does not sort' => ['status'];
        yield 'not a column' => ['p.name'];
    }

    #[DataProvider('notASortableColumn')]
    public function testWithoutASortableColumnTheDefaultSortComesWithTheDefaultDirection(mixed $sort): void
    {
        // the direction asked is ignored: it was asked for another column
        $query = TableQuery::fromValues(['sort' => $sort, 'direction' => 'asc'], new ProductsTable(sortedBy: 'name', sortedTowards: 'desc'));

        self::assertSame(['name', 'p.name', 'desc'], [$query->sort, $query->sortField, $query->direction]);
    }

    public function testADefaultSortThatIsNotASortableColumnLeavesTheRowsUnsorted(): void
    {
        $query = TableQuery::fromValues([], new ProductsTable(sortedBy: 'status'));

        self::assertNull($query->sort);
        self::assertNull($query->sortField);
    }
}
