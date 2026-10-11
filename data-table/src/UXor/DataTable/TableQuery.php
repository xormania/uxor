<?php

namespace App\UXor\DataTable;

/**
 * What a data table asks its countRows() and loadRows() for, already checked: values from a URL or a Live request
 * never reach the query unchecked. The sort is a declared sortable column (its server field in $sortField), every
 * filter value is one of its choices, the page size one of the table's page sizes, and the page at least 1 and at
 * most maxPage: its offset stays below the table's maxRows(), so no request makes the loader skip more rows.
 */
final class TableQuery
{
    public const SEARCH_MAX_LENGTH = 100;

    /**
     * @param array<string, string> $filters filter key => chosen value
     */
    private function __construct(
        public readonly string $search,
        public readonly array $filters,
        public readonly ?string $sort,
        public readonly ?string $sortField,
        public readonly string $direction,
        public readonly int $page,
        public readonly int $pageSize,
        public readonly int $maxPage,
    ) {
    }

    /**
     * Builds a query from untrusted values: anything invalid falls back to the table's default.
     *
     * @param array{search?: mixed, filters?: mixed, sort?: mixed, direction?: mixed, page?: mixed, pageSize?: mixed} $values
     */
    public static function fromValues(array $values, AbstractDataTable $table): self
    {
        $search = \is_string($values['search'] ?? null) ? trim($values['search']) : '';
        $search = mb_substr($search, 0, self::SEARCH_MAX_LENGTH);

        $filters = [];
        $given = \is_array($values['filters'] ?? null) ? $values['filters'] : [];
        foreach ($table->filters() as $filter) {
            $value = $given[$filter->key] ?? null;
            if ((\is_string($value) || \is_int($value)) && \array_key_exists((string) $value, $filter->choices)) {
                $filters[$filter->key] = (string) $value;
            }
        }

        $columns = [];
        foreach ($table->columns() as $column) {
            if ($column->isSortable()) {
                $columns[$column->key] = $column;
            }
        }
        $sort = \is_string($values['sort'] ?? null) && isset($columns[$values['sort']]) ? $values['sort'] : null;
        $direction = \is_string($values['direction'] ?? null) ? strtolower($values['direction']) : null;
        if (null === $sort) {
            // no sort asked, or one the table does not have: the default sort, in its default direction
            $sort = isset($columns[$table->defaultSort() ?? '']) ? $table->defaultSort() : null;
            $direction = $table->defaultDirection();
        }
        $direction = \in_array($direction, ['asc', 'desc'], true) ? $direction : 'asc';

        $pageSizes = $table->pageSizes();
        $pageSize = filter_var($values['pageSize'] ?? null, \FILTER_VALIDATE_INT);
        $pageSize = \in_array($pageSize, $pageSizes, true) ? $pageSize : $pageSizes[0];

        $maxRows = $table->maxRows();
        if ($maxRows < 1) {
            throw new \LogicException(\sprintf('%s::maxRows() must be at least 1.', $table::class));
        }
        // the last page whose first row is one of the first maxRows rows
        $maxPage = intdiv($maxRows - 1, $pageSize) + 1;
        $page = filter_var($values['page'] ?? null, \FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $page = false === $page ? 1 : min($page, $maxPage);

        return new self(
            $search,
            $filters,
            $sort,
            null === $sort ? null : $columns[$sort]->sortField,
            $direction,
            $page,
            $pageSize,
            $maxPage,
        );
    }

    public function withPage(int $page): self
    {
        return new self($this->search, $this->filters, $this->sort, $this->sortField, $this->direction, max(1, min($page, $this->maxPage)), $this->pageSize, $this->maxPage);
    }

    /**
     * The first row of the page, counted from 0: what an SQL OFFSET takes. Always below the table's maxRows().
     */
    public function offset(): int
    {
        return ($this->page - 1) * $this->pageSize;
    }
}
