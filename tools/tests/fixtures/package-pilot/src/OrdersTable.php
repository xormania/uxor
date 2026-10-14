<?php

namespace Consumer;

use UXor\Pilot\DataTable\AbstractDataTable;
use UXor\Pilot\DataTable\Column;
use UXor\Pilot\DataTable\TableQuery;

/** The consumer owns its rows and choices; no package query or template is copied. */
final class OrdersTable extends AbstractDataTable
{
    public function columns(): array
    {
        return [Column::make('number', 'Order')->sortable(), Column::make('customer', 'Customer')];
    }

    public function pageSizes(): array
    {
        return [1, 10];
    }

    protected function countRows(TableQuery $query): int
    {
        return count($this->matchingRows($query));
    }

    protected function loadRows(TableQuery $query): array
    {
        return array_slice($this->matchingRows($query), $query->offset(), $query->pageSize);
    }

    private function matchingRows(TableQuery $query): array
    {
        $rows = [
            ['id' => 1, 'number' => 'ORD-001', 'customer' => 'Alice <script>alert(1)</script>'],
            ['id' => 2, 'number' => 'ORD-002', 'customer' => 'Bob'],
        ];
        if ('' !== $query->search) {
            $rows = array_values(array_filter($rows, static fn (array $row): bool => str_contains(strtolower($row['customer']), strtolower($query->search))));
        }
        if ('desc' === $query->direction) {
            $rows = array_reverse($rows);
        }

        return $rows;
    }
}
