<?php

namespace App\UXor\DataTable;

use Symfony\Component\HttpFoundation\Exception\BadRequestException;
use Symfony\Component\HttpFoundation\Request;

/**
 * A server-driven table: extend it once per table, declare its columns (and filters), count the matching rows and
 * load one page of them.
 *
 *     final class OrdersTable extends AbstractDataTable
 *     {
 *         public function __construct(private readonly OrderRepository $orders) {}
 *
 *         public function columns(): array
 *         {
 *             return [Column::make('number', 'Order')->sortable('o.number'), Column::make('status', 'Status')];
 *         }
 *
 *         protected function countRows(TableQuery $query): int
 *         {
 *             return $this->orders->countMatching($query); // the rows matching the search and filters
 *         }
 *
 *         protected function loadRows(TableQuery $query): array
 *         {
 *             return $this->orders->findPage($query); // the rows of $query->page
 *         }
 *     }
 *
 * A controller renders it with `$table->handleRequest($request)` and `<twig:DataTable :table="table" id="orders" />`.
 */
abstract class AbstractDataTable
{
    /** Request parameter names, below paramPrefix() when it is not empty. */
    public const PARAMETERS = ['search' => 'q', 'sort' => 'sort', 'direction' => 'dir', 'page' => 'page', 'pageSize' => 'size', 'filters' => 'f'];

    /**
     * @return list<Column>
     */
    abstract public function columns(): array;

    /**
     * The number of rows matching an already checked query (its search and filters), on every page.
     */
    abstract protected function countRows(TableQuery $query): int;

    /**
     * The rows of the query's page: at most `$query->pageSize` rows from `$query->offset()`. The query is checked and
     * its page exists: fetch() calls it once, after countRows(), and not at all when no row matches.
     *
     * @return list<mixed> arrays or objects, each with a stable id (rowId())
     */
    abstract protected function loadRows(TableQuery $query): array;

    /**
     * @return list<Filter>
     */
    public function filters(): array
    {
        return [];
    }

    /**
     * The page sizes users can choose; the first is the default.
     *
     * @return non-empty-list<positive-int>
     */
    public function pageSizes(): array
    {
        return [10, 25, 50];
    }

    /**
     * How many matching rows can be paged through: no page starts past this many rows, so no request makes the
     * loader skip more. A search or a filter narrows a larger set. Lower it for an expensive query; above some
     * thousands of rows, an SQL OFFSET gets slow, and keyset pagination in the app suits better.
     */
    public function maxRows(): int
    {
        return 10_000;
    }

    /**
     * The key of the sortable column sorting the rows when the URL names none.
     */
    public function defaultSort(): ?string
    {
        return null;
    }

    /**
     * @return 'asc'|'desc'
     */
    public function defaultDirection(): string
    {
        return 'asc';
    }

    /**
     * Groups the table's URL parameters under this name (`?orders[page]=2`), for several tables on one page.
     */
    public function paramPrefix(): string
    {
        return '';
    }

    /**
     * The stable id of a row: it identifies the row's HTML element and its selection. Override it when the rows'
     * key is not `id`.
     */
    public function rowId(mixed $row): string|int
    {
        $id = match (true) {
            \is_array($row) => $row['id'] ?? null,
            \is_object($row) && method_exists($row, 'getId') => $row->getId(),
            \is_object($row) => $row->id ?? null,
            default => null,
        };
        if (!\is_string($id) && !\is_int($id)) {
            throw new \LogicException(\sprintf('%s cannot find the id of a row: override rowId().', static::class));
        }

        return $id;
    }

    /**
     * Counts the matching rows, then loads the page the query asks for, or the last page when it asks for one past
     * the end: one count, and one load of rows at most.
     *
     * @return array{TableQuery, TableResult} the query of the page loaded, and its result
     */
    public function fetch(TableQuery $query): array
    {
        $total = $this->countRows($query);
        $last = min(max(1, (int) ceil($total / $query->pageSize)), $query->maxPage);
        if ($query->page > $last) {
            $query = $query->withPage($last);
        }

        return [$query, new TableResult(0 === $total ? [] : $this->loadRows($query), $total)];
    }

    /**
     * Reads the table's parameters from the request's query string, checks them and loads the page.
     */
    public function handleRequest(Request $request): DataTableView
    {
        $prefix = $this->paramPrefix();
        try {
            $parameters = '' === $prefix ? $request->query->all() : $request->query->all($prefix);
        } catch (BadRequestException) {
            $parameters = [];
        }

        $values = [];
        foreach (self::PARAMETERS as $name => $parameter) {
            $values[$name] = $parameters[$parameter] ?? null;
        }
        [$query, $result] = $this->fetch(TableQuery::fromValues($values, $this));

        return new DataTableView($this, $query, $result, $request->getBaseUrl().$request->getPathInfo(), $request->query->all());
    }
}
