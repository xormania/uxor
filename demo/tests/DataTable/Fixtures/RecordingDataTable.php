<?php

namespace App\Tests\DataTable\Fixtures;

use App\UXor\DataTable\AbstractDataTable;

final class RecordingDataTable extends AbstractDataTable
{
    use RecordingTable;
}
