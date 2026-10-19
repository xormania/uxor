<?php

namespace App\Table;

use App\Customer\CustomerStore;
use App\UXor\DataTable\AbstractDataTable;
use App\UXor\DataTable\Column;
use App\UXor\DataTable\TableQuery;

/** Business querying sits in the application; the installed table owns URL validation and rendering. */
final class CustomersTable extends AbstractDataTable
{
    public function __construct(private readonly CustomerStore $customers)
    {
    }

    public function columns(): array
    {
        return [Column::make('name', 'Name')->sortable('name'), Column::make('email', 'Email')->sortable('email'), Column::make('edit', 'Edit')];
    }

    public function pageSizes(): array
    {
        return [2, 4];
    }

    public function defaultSort(): string
    {
        return 'name';
    }

    protected function countRows(TableQuery $query): int
    {
        return count($this->matching($query));
    }

    protected function loadRows(TableQuery $query): array
    {
        $rows = $this->matching($query);
        $sortField = $query->sortField ?? 'name';
        usort($rows, static fn (array $a, array $b): int => ([$a[$sortField], $a['id']] <=> [$b[$sortField], $b['id']]) * ('desc' === $query->direction ? -1 : 1));

        return array_slice($rows, $query->offset(), $query->pageSize);
    }

    private function matching(TableQuery $query): array
    {
        return array_values(array_filter($this->customers->all(), static fn (array $row): bool => '' === $query->search || str_contains(mb_strtolower($row['name'].' '.$row['email']), mb_strtolower($query->search))));
    }
}
