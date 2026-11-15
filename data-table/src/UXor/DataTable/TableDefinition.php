<?php

namespace App\UXor\DataTable;

/**
 * The declarations needed to normalize a table query, independent of requests, rendering and row storage.
 * AbstractDataTable supplies this contract for existing HTTP and Live tables. Other callers can supply it
 * directly without implementing a row loader.
 */
interface TableDefinition
{
    /**
     * @return list<Column>
     */
    public function columns(): array;

    /**
     * @return list<Filter>
     */
    public function filters(): array;

    /**
     * The offered page sizes, with the default first.
     *
     * @return non-empty-list<positive-int>
     */
    public function pageSizes(): array;

    /** The maximum number of rows through which a query may page; at least 1. */
    public function maxRows(): int;

    /** The key of the default sortable column, or null for no default sort. */
    public function defaultSort(): ?string;

    /**
     * @return 'asc'|'desc'
     */
    public function defaultDirection(): string;
}
