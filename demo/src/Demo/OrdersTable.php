<?php

namespace App\Demo;

use App\UXor\DataTable\AbstractDataTable;

/**
 * The demo's plain data table (data-table recipe).
 */
final class OrdersTable extends AbstractDataTable
{
    use OrdersTableDefinition;
}
