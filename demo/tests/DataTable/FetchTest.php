<?php

namespace App\Tests\DataTable;

use App\UXor\DataTable\TableQuery;
use App\Tests\DataTable\Fixtures\RecordingDataTable;
use PHPUnit\Framework\TestCase;

/**
 * AbstractDataTable::fetch() counts once and loads rows once at most: never for a page past the end, never when no
 * row matches. The fixture records each loader call.
 */
final class FetchTest extends TestCase
{
    public function testADeepPageInALargeTableCountsOnceAndLoadsOnce(): void
    {
        $table = new RecordingDataTable(1_000_000);

        [, $result] = $table->fetch(TableQuery::fromValues(['page' => 1_000_000, 'pageSize' => 50], $table));

        self::assertSame(['count', 'rows@9950'], $table->calls);
        self::assertSame(1_000_000, $result->total, 'the total is the matching rows');
        self::assertCount(50, $result->rows, 'the rows are one page');
    }

    public function testAPagePastTheEndLoadsTheLastPageOnce(): void
    {
        $table = new RecordingDataTable(120);

        [$query, $result] = $table->fetch(TableQuery::fromValues(['page' => 150, 'pageSize' => 50], $table));

        self::assertSame(['count', 'rows@100'], $table->calls);
        self::assertSame(3, $query->page, 'the query returned is the page shown');
        self::assertCount(20, $result->rows);
    }

    public function testNoMatchingRowLoadsNoRows(): void
    {
        $table = new RecordingDataTable(0);

        [$query, $result] = $table->fetch(TableQuery::fromValues(['page' => 7], $table));

        self::assertSame(['count'], $table->calls);
        self::assertSame([], $result->rows);
        self::assertSame(1, $query->page);
    }
}
