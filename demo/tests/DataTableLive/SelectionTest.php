<?php

namespace App\Tests\DataTableLive;

use App\Tests\DataTable\Fixtures\RecordingLiveDataTable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The Live table's selection keeps at most maxSelection() ids (1,000) of at most 128 characters. hydrateSelectedIds()
 * reads what the browser sends for the writable `selectedIds` prop; these tests call it the way the hydrator does.
 * tests/Live/OrdersTableTest.php sends the same values through a real Live request.
 */
final class SelectionTest extends TestCase
{
    public function testFiveThousandIdsSentKeepTheFirstThousand(): void
    {
        $ids = (new RecordingLiveDataTable())->hydrateSelectedIds(array_map('strval', range(1, 5_000)));

        self::assertCount(1_000, $ids);
        self::assertSame('1000', $ids[999]);
    }

    public function testOnlyTheFirstThousandEntriesAreReadThenTheirInvalidIdsDropped(): void
    {
        // cut first, then cleaned: an invalid entry among the first thousand takes a place, no later id fills it
        $ids = (new RecordingLiveDataTable())->hydrateSelectedIds([str_repeat('x', 129), ...array_map('strval', range(1_001, 6_000))]);

        self::assertCount(999, $ids);
        self::assertSame('1001', $ids[0]);
        self::assertSame('1999', $ids[998]);
    }

    public function testIdsAreKeptOnceEachAsStringsAndTooLongOrNonScalarIdsAreDropped(): void
    {
        $ids = (new RecordingLiveDataTable())->hydrateSelectedIds([1, '1', 2, str_repeat('x', 129), ['nested'], null]);

        self::assertSame(['1', '2'], $ids);
    }

    /**
     * @return iterable<string, array{string, bool}>
     */
    public static function idLengths(): iterable
    {
        yield '128 characters' => [str_repeat('x', 128), true];
        yield '128 multibyte characters (512 bytes)' => [str_repeat('😀', 128), true];
        yield '129 multibyte characters' => [str_repeat('é', 129), false];
    }

    #[DataProvider('idLengths')]
    public function testTheLengthOfAnIdIsCountedInCharacters(string $id, bool $kept): void
    {
        self::assertSame($kept ? [$id] : [], (new RecordingLiveDataTable())->hydrateSelectedIds([$id]));
    }

    public function testASelectionThatIsNotAListIsEmpty(): void
    {
        self::assertSame([], (new RecordingLiveDataTable())->hydrateSelectedIds('1,2,3'));
    }

    public function testSelectThisPageStopsAtMaxSelection(): void
    {
        $table = new RecordingLiveDataTable(120);
        $table->pageSize = 50;
        $table->selectedIds = array_map('strval', range(1_001, 1_990));
        $table->prepare();

        $table->selectPage();

        self::assertCount(1_000, $table->selectedIds);
        self::assertTrue($table->isSelectionFull());
        self::assertTrue($table->isSelected(['id' => 1]), 'the page\'s first rows are added up to the limit');
        self::assertTrue($table->isSelected(['id' => 10]));
        self::assertFalse($table->isSelected(['id' => 11]));
    }
}
