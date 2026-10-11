<?php

namespace App\Tests\DataTable\Fixtures;

use App\UXor\DataTableLive\AbstractLiveDataTable;

/**
 * Not registered as a component: tests call its methods directly, the way a Live request would.
 */
final class RecordingLiveDataTable extends AbstractLiveDataTable
{
    use RecordingTable;
}
