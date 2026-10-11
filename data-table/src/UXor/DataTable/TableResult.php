<?php

namespace App\UXor\DataTable;

/**
 * One page of rows and the number of rows matching the query on every page.
 */
final class TableResult
{
    /**
     * @param list<mixed> $rows arrays or objects, each with a stable id (AbstractDataTable::rowId())
     */
    public function __construct(
        public readonly array $rows,
        public readonly int $total,
    ) {
        if ($total < 0) {
            throw new \InvalidArgumentException('The total cannot be negative.');
        }
    }
}
