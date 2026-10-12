<?php

namespace App\Tests\DataTable\Fixtures;

use App\UXor\DataTable\Column;
use App\UXor\DataTable\TableQuery;

/**
 * A table of $total rows ({id, number}) that records each loader call: `count`, or `rows@<offset>`.
 */
trait RecordingTable
{
    /** @var list<string> */
    public array $calls = [];

    public function __construct(public int $total = 120)
    {
    }

    public function columns(): array
    {
        return [Column::make('number', 'Order')->sortable()];
    }

    public function pageSizes(): array
    {
        return [50, 10];
    }

    protected function countRows(TableQuery $query): int
    {
        $this->calls[] = 'count';

        return $this->total;
    }

    protected function loadRows(TableQuery $query): array
    {
        $this->calls[] = 'rows@'.$query->offset();
        $rows = [];
        for ($id = $query->offset() + 1; $id <= min($this->total, $query->offset() + $query->pageSize); ++$id) {
            $rows[] = ['id' => $id, 'number' => $id];
        }

        return $rows;
    }
}
