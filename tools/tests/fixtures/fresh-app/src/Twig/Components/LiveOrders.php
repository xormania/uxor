<?php

namespace App\Twig\Components;

use App\UXor\DataTable\Column;
use App\UXor\DataTable\TableQuery;
use App\UXor\DataTableLive\AbstractLiveDataTable;
use Symfony\UX\LiveComponent\Attribute\AsLiveComponent;

#[AsLiveComponent(name: 'LiveOrders', template: 'components/DataTableLive.html.twig')]
final class LiveOrders extends AbstractLiveDataTable
{
    public function columns(): array
    {
        return [Column::make('number', 'Order')->sortable()];
    }

    protected function countRows(TableQuery $query): int
    {
        return 25;
    }

    protected function loadRows(TableQuery $query): array
    {
        $rows = [];
        for ($id = 1; $id <= 25; ++$id) {
            $rows[] = ['id' => $id, 'number' => \sprintf('#%04d', $id)];
        }
        if ('desc' === $query->direction) {
            $rows = array_reverse($rows);
        }

        return \array_slice($rows, $query->offset(), $query->pageSize);
    }
}
