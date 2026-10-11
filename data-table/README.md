# Data Table

A server-driven table: search, filters, sortable columns, a page size and pages, in a Turbo Frame that keeps Back and Forward working.

```twig {"preview":true}
<twig:DataTable :table="table" id="orders" label="Orders">
    <twig:block name="cell_status">
        <twig:Badge variant="{{ {paid: 'success', pending: 'warning', refunded: 'gray'}[row.status] }}">{{ row.status|capitalize }}</twig:Badge>
    </twig:block>
    <twig:block name="cell_total">${{ row.total }}</twig:block>
</twig:DataTable>
```

## Installation

::: installation

Run `ux:install` from your project's root directory: besides its template, this recipe copies PHP classes into
`src/UXor/DataTable/`, in the `App\UXor\DataTable` namespace. If your project's root namespace is not
`App`, change the `namespace` and `use` lines of those files to match.

## Usage

Each table is one class extending `AbstractDataTable`. It declares its columns, counts the rows matching a query
(`countRows()`) and loads one page of them (`loadRows()`). The query is already checked: the sort is one of the
columns you made sortable (`$query->sortField` holds its server field, never a value from the URL), each filter value
is one of the filter's choices, the page size one of `pageSizes()`, and the page exists: the table counts first, so a
page past the end loads the last one, and `loadRows()` runs once per request at most (never when nothing matches).

```php
// src/Table/OrdersTable.php
namespace App\Table;

use App\UXor\DataTable\AbstractDataTable;
use App\UXor\DataTable\Column;
use App\UXor\DataTable\Filter;
use App\UXor\DataTable\TableQuery;
use Doctrine\ORM\QueryBuilder;

final class OrdersTable extends AbstractDataTable
{
    public function __construct(private readonly OrderRepository $orders)
    {
    }

    public function columns(): array
    {
        return [
            Column::make('number', 'Order')->sortable('o.number'),
            Column::make('customer', 'Customer')->sortable('c.name'),
            Column::make('status', 'Status'),
            Column::make('total', 'Total')->sortable('o.total'),
        ];
    }

    public function filters(): array
    {
        return [Filter::choice('status', 'Status', ['paid' => 'Paid', 'pending' => 'Pending', 'refunded' => 'Refunded'])];
    }

    public function defaultSort(): string
    {
        return 'number';
    }

    protected function countRows(TableQuery $query): int
    {
        return (int) $this->matching($query)->select('COUNT(o.id)')->getQuery()->getSingleScalarResult();
    }

    protected function loadRows(TableQuery $query): array
    {
        $qb = $this->matching($query);
        if (null !== $query->sortField) {
            $qb->orderBy($query->sortField, $query->direction)->addOrderBy('o.id', $query->direction);
        }

        return $qb->setFirstResult($query->offset())->setMaxResults($query->pageSize)->getQuery()->getResult();
    }

    private function matching(TableQuery $query): QueryBuilder
    {
        $qb = $this->orders->createQueryBuilder('o')->join('o.customer', 'c');
        if ('' !== $query->search) {
            $qb->andWhere('o.number LIKE :search OR c.name LIKE :search')->setParameter('search', '%'.addcslashes($query->search, '%_').'%');
        }
        if (isset($query->filters['status'])) {
            $qb->andWhere('o.status = :status')->setParameter('status', $query->filters['status']);
        }

        return $qb;
    }
}
```

The controller hands the request to the table; the template renders it:

```php
#[Route('/orders', name: 'app_orders')]
public function orders(Request $request, OrdersTable $table): Response
{
    return $this->render('orders/index.html.twig', ['table' => $table->handleRequest($request)]);
}
```

```twig
<twig:DataTable :table="table" id="orders" label="Orders" />
```

A cell shows the row's value for the column's key (`row.number`, from an array or an object). To render a cell
yourself, pass a `cell_<key>` block; `row` is the current row. Write it as `<twig:block>`: inside a
`{% block %}` tag, `<twig:…>` components are not compiled.

```twig
<twig:DataTable :table="table" id="orders" label="Orders">
    <twig:block name="cell_customer">
        <a href="{{ path('app_customer', {id: row.customer.id}) }}" class="font-medium text-fg-brand hover:underline">{{ row.customer.name }}</a>
    </twig:block>
</twig:DataTable>
```

Rows are identified by `id` (the array key, `getId()` or the `id` property). Override `rowId()` when yours is
called something else. A row's element id is `<table id>-row-<row id>`.

### What you can override

| Method | Default | |
|---|---|---|
| `columns()` | required | The columns, in order. `Column::make(key, label)`, `->sortable(field)` to sort by a server field (the key when omitted). |
| `countRows(TableQuery)` | required | The number of rows matching the search and filters, on every page. |
| `loadRows(TableQuery)` | required | The rows of the page: at most `$query->pageSize` from `$query->offset()`. |
| `maxRows()` | `10_000` | How many matching rows can be paged through (below). |
| `filters()` | none | `Filter::choice(key, label, [value => label])`: a select above the table. |
| `pageSizes()` | `[10, 25, 50]` | The page sizes users can choose; the first is the default. One size hides the select. |
| `defaultSort()`, `defaultDirection()` | none, `'asc'` | The sort when the URL names none. |
| `paramPrefix()` | `''` | Groups the URL parameters (`?orders[page]=2`) when a page shows several tables. |
| `rowId(row)` | `id` | The stable id of a row. |

### Large tables

No page starts past `maxRows()` rows, so a request never makes the database skip more rows than that, whatever page
the URL asks for. When more rows match, the table says the first ones can be paged through, and a search or a filter
narrows them. Lower `maxRows()` for an expensive query. An SQL `OFFSET` reads and drops every row before the page, so
for tables browsed deep into millions of rows, keyset pagination (`WHERE id > :last`) in your own controller suits
better than this recipe. As for any public page, limit the request rate of an expensive table at the server.

### URL and history

The table's state is in the URL: `q` (search), `f[<filter>]`, `sort`, `dir`, `page` and `size`, without the default
values. The table renders in a Turbo Frame (`<turbo-frame id="orders" data-turbo-action="advance">`): its links and
its search form reload only the frame and add a history entry, so Back and Forward step through every search, sort and
page, and a copied URL opens the same state. The URL's other parameters are kept. Without Turbo, the links and the
form load whole pages and still work.

The search, filters and page size apply when the form is submitted (the Apply button, or Enter in the search field).
After Back or Forward, the form shows the state of the URL on screen, never an edit made before leaving: its
`data-table` controller resets the fields to the values the server rendered when a copy Turbo restores connects.
Back pressed while a change is still loading drops the change: the URL, the rows and the controls stay those of the
entry Back went to.

Changing the search, a filter, the sort or the page size goes back to the first page.

Whether a `turbo:before-cache` comes from a frame visit promoted to history (nothing is cancelled then) is answered by
the `turbo` recipe's module (`assets/lib/uxor-turbo.js`), which `ux:install data-table` installs with it.
