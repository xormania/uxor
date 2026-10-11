<?php

namespace App\Demo;

use App\UXor\DataTableLive\AbstractLiveDataTable;
use Symfony\UX\LiveComponent\Attribute\AsLiveComponent;

/**
 * The demo's Live data table (data-table-live recipe).
 */
#[AsLiveComponent(name: 'OrdersTable', template: 'components/DataTableLive.html.twig')]
final class LiveOrdersTable extends AbstractLiveDataTable
{
    use OrdersTableDefinition;
}
