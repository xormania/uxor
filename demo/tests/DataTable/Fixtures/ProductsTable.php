<?php

namespace App\Tests\DataTable\Fixtures;

use App\UXor\DataTable\AbstractDataTable;
use App\UXor\DataTable\Column;
use App\UXor\DataTable\Filter;
use App\UXor\DataTable\TableQuery;

/**
 * A table as an app extends it: a sortable column with a server field (`name` sorts by `p.name`), one sorted by its
 * key (`price`), one not sortable (`status`), two filters (one with numeric choices, which PHP keys as integers), a
 * default sort, two page sizes, and an optional URL prefix. Its rows are given.
 */
final class ProductsTable extends AbstractDataTable
{
    /**
     * @param list<mixed> $rows
     */
    public function __construct(
        private readonly string $prefix = '',
        private readonly ?string $sortedBy = 'name',
        private readonly string $sortedTowards = 'desc',
        public array $rows = [],
        private readonly int $total = 0,
    ) {
    }

    public function columns(): array
    {
        return [
            Column::make('name', 'Name')->sortable('p.name'),
            Column::make('price', 'Price')->sortable(),
            Column::make('status', 'Status'),
        ];
    }

    public function filters(): array
    {
        return [
            Filter::choice('status', 'Status', ['active' => 'Active', 'archived' => 'Archived']),
            Filter::choice('year', 'Year', ['2024' => '2024', '2025' => '2025']),
        ];
    }

    public function pageSizes(): array
    {
        return [10, 25];
    }

    public function defaultSort(): ?string
    {
        return $this->sortedBy;
    }

    public function defaultDirection(): string
    {
        return 'desc' === $this->sortedTowards ? 'desc' : 'asc';
    }

    public function paramPrefix(): string
    {
        return $this->prefix;
    }

    protected function countRows(TableQuery $query): int
    {
        return max($this->total, \count($this->rows));
    }

    protected function loadRows(TableQuery $query): array
    {
        return \array_slice($this->rows, $query->offset(), $query->pageSize);
    }
}
