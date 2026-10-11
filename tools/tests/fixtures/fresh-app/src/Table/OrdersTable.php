<?php

namespace App\Table;

use App\UXor\DataTable\AbstractDataTable;
use App\UXor\DataTable\Column;
use App\UXor\DataTable\Filter;
use App\UXor\DataTable\TableQuery;

final class OrdersTable extends AbstractDataTable
{
    public function columns(): array
    {
        return [Column::make('number', 'Order')->sortable(), Column::make('status', 'Status')];
    }

    public function filters(): array
    {
        return [Filter::choice('status', 'Status', ['paid' => 'Paid', 'pending' => 'Pending'])];
    }

    protected function countRows(TableQuery $query): int
    {
        return \count($this->matching($query));
    }

    protected function loadRows(TableQuery $query): array
    {
        $rows = $this->matching($query);
        if ('desc' === $query->direction) {
            $rows = array_reverse($rows);
        }

        return \array_slice($rows, $query->offset(), $query->pageSize);
    }

    /**
     * @return list<array{id: int, number: string, status: string}>
     */
    private function matching(TableQuery $query): array
    {
        $rows = [];
        for ($id = 1; $id <= 25; ++$id) {
            $rows[] = ['id' => $id, 'number' => \sprintf('#%04d', $id), 'status' => 0 === $id % 2 ? 'paid' : 'pending'];
        }
        if (isset($query->filters['status'])) {
            $rows = array_values(array_filter($rows, static fn (array $row): bool => $row['status'] === $query->filters['status']));
        }

        return $rows;
    }
}
