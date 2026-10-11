<?php

namespace App\UXor\DataTable;

/**
 * What the DataTable component renders: the table, the checked query, its page of rows, and the URLs of the other
 * states (another sort, page or page size), built from the current URL so its other parameters are kept.
 */
final class DataTableView
{
    /**
     * @param array<string, mixed> $currentQuery the request's whole query string
     */
    public function __construct(
        public readonly AbstractDataTable $table,
        public readonly TableQuery $query,
        public readonly TableResult $result,
        private readonly string $path,
        private readonly array $currentQuery = [],
    ) {
    }

    /**
     * The URL's path, without its query string: where the search form submits to.
     */
    public function path(): string
    {
        return $this->path;
    }

    /**
     * The pages that can be visited: those starting within the table's maxRows().
     */
    public function pageCount(): int
    {
        return min(max(1, (int) ceil($this->result->total / $this->query->pageSize)), $this->query->maxPage);
    }

    /**
     * Whether more rows match than can be paged through (the table's maxRows()): a search or a filter narrows them.
     */
    public function isCapped(): bool
    {
        return $this->result->total > $this->table->maxRows();
    }

    /**
     * The position of the page's first row, counted from 1 (0 when there are no rows).
     */
    public function from(): int
    {
        return 0 === $this->result->total ? 0 : $this->query->offset() + 1;
    }

    public function to(): int
    {
        return min($this->result->total, $this->query->offset() + \count($this->result->rows));
    }

    /**
     * The page numbers to link, null where pages are left out: 1 … 4 5 [6] 7 8 … 20.
     *
     * @return list<int|null>
     */
    public function pageWindow(): array
    {
        $count = $this->pageCount();
        $current = $this->query->page;
        if ($count <= 7) {
            return range(1, $count);
        }
        $start = max(2, min($current - 2, $count - 5));
        $end = min($count - 1, max($current + 2, 6));
        $window = [1];
        if ($start > 2) {
            $window[] = null;
        }
        array_push($window, ...range($start, $end));
        if ($end < $count - 1) {
            $window[] = null;
        }
        $window[] = $count;

        return $window;
    }

    /**
     * Whether the rows are narrowed by a search or a filter.
     */
    public function isFiltered(): bool
    {
        return '' !== $this->query->search || [] !== $this->query->filters;
    }

    /**
     * The URL of the table's state after the given changes (`sort`, `direction`, `page`, `pageSize`, `search`).
     * A change other than the page goes back to the first page.
     *
     * @param array{search?: string, sort?: string, direction?: string, page?: int, pageSize?: int} $changes
     */
    public function url(array $changes = []): string
    {
        $state = [
            'search' => $this->query->search,
            'filters' => $this->query->filters,
            'sort' => $this->query->sort,
            'direction' => $this->query->direction,
            'page' => \array_key_exists('page', $changes) ? $changes['page'] : 1,
            'pageSize' => $this->query->pageSize,
        ];
        unset($changes['page']);
        $state = array_replace($state, $changes);

        if (null === $state['sort']) {
            $state['direction'] = null; // a direction without a sort means nothing
        }

        $parameters = [];
        foreach (AbstractDataTable::PARAMETERS as $name => $parameter) {
            $value = $state[$name];
            $default = match ($name) {
                'page' => 1,
                'pageSize' => $this->table->pageSizes()[0],
                'search' => '',
                'filters' => [],
                default => null,
            };
            if (null !== $value && $value !== $default) {
                $parameters[$parameter] = $value;
            }
        }

        $query = $this->currentQuery;
        $prefix = $this->table->paramPrefix();
        if ('' === $prefix) {
            $query = array_diff_key($query, array_flip(AbstractDataTable::PARAMETERS)) + $parameters;
        } else {
            unset($query[$prefix]);
            if ([] !== $parameters) {
                $query[$prefix] = $parameters;
            }
        }
        $queryString = http_build_query($query, '', '&', \PHP_QUERY_RFC3986);

        return $this->path.('' === $queryString ? '' : '?'.$queryString);
    }

    /**
     * The URL sorting by a column: ascending first, then the other way when it already sorts the rows.
     */
    public function sortUrl(Column $column): string
    {
        $direction = $column->key === $this->query->sort && 'asc' === $this->query->direction ? 'desc' : 'asc';

        return $this->url(['sort' => $column->key, 'direction' => $direction]);
    }

    /**
     * The name of a form field holding one of the table's parameters (`q`, or `orders[q]` with a prefix).
     */
    public function fieldName(string $parameter, ?string $key = null): string
    {
        $prefix = $this->table->paramPrefix();
        $name = '' === $prefix ? $parameter : $prefix.'['.$parameter.']';

        return null === $key ? $name : $name.'['.$key.']';
    }

    /**
     * The hidden fields the search form submits so that it keeps the sort and the URL's other parameters.
     *
     * @return array<string, string> field name => value
     */
    public function hiddenFields(): array
    {
        $prefix = $this->table->paramPrefix();
        $kept = '' === $prefix ? array_diff_key($this->currentQuery, array_flip(AbstractDataTable::PARAMETERS)) : $this->currentQuery;
        unset($kept[$prefix]);

        $fields = [];
        foreach (explode('&', http_build_query($kept)) as $pair) {
            if ('' !== $pair) {
                [$name, $value] = array_map('urldecode', explode('=', $pair, 2) + [1 => '']);
                $fields[$name] = $value;
            }
        }
        if (null !== $this->query->sort) {
            $fields[$this->fieldName('sort')] = $this->query->sort;
            $fields[$this->fieldName('dir')] = $this->query->direction;
        }

        return $fields;
    }
}
