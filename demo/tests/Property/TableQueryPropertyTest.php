<?php

namespace App\Tests\Property;

use App\UXor\DataTable\AbstractDataTable;
use App\UXor\DataTable\Column;
use App\UXor\DataTable\TableQuery;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;
use Random\Randomizer;

/**
 * TableQuery::fromValues() on random values and random tables (any maxRows() from 1, any page sizes): the page is at
 * least 1 and at most maxPage, the page size one of the table's, and the offset below maxRows(), for every page
 * withPage() is given too. The release checks run it with a random seed (Seeded).
 */
#[Group('property')]
final class TableQueryPropertyTest extends TestCase
{
    use Seeded;

    public function testTheOffsetStaysBelowMaxRowsForAnyValuesAndAnyTable(): void
    {
        $seed = $this->seed(20261010);
        $random = $this->randomizer($seed);
        for ($run = 1; $run <= $this->runs(); ++$run) {
            $table = self::table($random->getInt(1, $this->pick($random, [10, 1_000, 100_000, \PHP_INT_MAX >> 8])), self::pageSizes($random));
            $values = [
                'page' => $this->value($random),
                'pageSize' => $this->pick($random, [$this->value($random), (string) $this->pick($random, $table->pageSizes())]),
                'search' => $this->value($random),
                'sort' => $this->value($random),
                'direction' => $this->value($random),
                'filters' => $this->value($random),
            ];
            $query = TableQuery::fromValues($values, $table);
            $case = \sprintf('SEED=%d, run %d: maxRows %d, page sizes %s, values %s', $seed, $run, $table->maxRows(), json_encode($table->pageSizes()), json_encode($values, \JSON_PARTIAL_OUTPUT_ON_ERROR | \JSON_INVALID_UTF8_SUBSTITUTE));

            self::assertGreaterThanOrEqual(1, $query->page, $case);
            self::assertLessThanOrEqual($query->maxPage, $query->page, $case);
            self::assertContains($query->pageSize, $table->pageSizes(), $case);
            self::assertGreaterThanOrEqual(0, $query->offset(), $case);
            self::assertLessThan($table->maxRows(), $query->offset(), $case);

            $page = $this->pick($random, [$random->getInt(\PHP_INT_MIN, \PHP_INT_MAX), $random->getInt(-5, $query->maxPage + 5), \PHP_INT_MAX, \PHP_INT_MIN]);
            $moved = $query->withPage($page);
            self::assertGreaterThanOrEqual(1, $moved->page, "$case, withPage($page)");
            self::assertLessThan($table->maxRows(), $moved->offset(), "$case, withPage($page)");
        }
    }

    /** A value as a URL or a Live request could send it: numbers of any size and sign, numeric strings, junk, arrays. */
    private function value(Randomizer $random): mixed
    {
        return match ($random->getInt(0, 7)) {
            0 => $random->getInt(\PHP_INT_MIN, \PHP_INT_MAX),
            1 => $random->getInt(-3, 3_000),
            2 => (string) $random->getInt(-10, 1_000_000_000),
            3 => $this->pick($random, ['1e9', '-0', '1.5', '0x10', 'NaN', 'INF', '', ' 7', '+3', '9223372036854775808', '00012']),
            4 => $random->getFloat(-1e12, 1e12),
            5 => $this->pick($random, [null, true, false, [], ['2'], ['page' => 2]]),
            6 => $random->getBytes($random->getInt(1, 20)),
            default => (string) $random->getInt(1, 50),
        };
    }

    /**
     * @return non-empty-list<positive-int>
     */
    private static function pageSizes(Randomizer $random): array
    {
        $sizes = [];
        for ($i = $random->getInt(1, 4); $i > 0; --$i) {
            $sizes[] = $random->getInt(1, 500);
        }

        return array_values(array_unique($sizes));
    }

    /**
     * @param non-empty-list<positive-int> $pageSizes
     */
    private static function table(int $maxRows, array $pageSizes): AbstractDataTable
    {
        return new class($maxRows, $pageSizes) extends AbstractDataTable {
            /**
             * @param non-empty-list<positive-int> $sizes
             */
            public function __construct(private readonly int $max, private readonly array $sizes)
            {
            }

            public function columns(): array
            {
                return [Column::make('number', 'Order')->sortable()];
            }

            public function pageSizes(): array
            {
                return $this->sizes;
            }

            public function maxRows(): int
            {
                return $this->max;
            }

            protected function countRows(TableQuery $query): int
            {
                return 0;
            }

            protected function loadRows(TableQuery $query): array
            {
                return [];
            }
        };
    }
}
