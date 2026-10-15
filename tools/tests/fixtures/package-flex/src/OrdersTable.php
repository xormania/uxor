<?php

namespace Consumer;

use UXor\Pilot\DataTable\AbstractDataTable;
use UXor\Pilot\DataTable\Column;
use UXor\Pilot\DataTable\TableQuery;

/** Application data and policy extend the package contract through ordinary autowiring. */
final class OrdersTable extends AbstractDataTable
{
    public function __construct(private readonly OrdersRepository $orders)
    {
    }

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
        $rows = $this->orders->all();
        if ('' !== $query->search) {
            $rows = array_values(array_filter($rows, static fn (array $row): bool => str_contains(strtolower($row['customer']), strtolower($query->search))));
        }

        return $rows;
    }
}
