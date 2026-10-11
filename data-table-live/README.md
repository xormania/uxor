# Data Table Live

The `data-table` recipe as a Live Component: search while typing, filters, sortable columns, pages and row selection, without page reloads.

```twig {"preview":true}
<twig:OrdersTable tableId="orders" label="Orders" />
```

## Installation

::: installation

Run `ux:install` from your project's root directory: this recipe copies `AbstractLiveDataTable` into
`src/UXor/DataTableLive/` (namespace `App\UXor\DataTableLive`), and installs the `data-table` recipe,
whose classes it extends. If your project's root namespace is not `App`, change the `namespace` and `use` lines of
those files to match. Run the `composer require` command `ux:install` prints right away: until
`symfony/ux-live-component` is installed, the copied class stops the app (and its console) from booting.

## Usage

A Live table is the class a `data-table` table would be, extending `AbstractLiveDataTable` instead of
`AbstractDataTable`, with the `#[AsLiveComponent]` attribute naming the component and this recipe's template.
`columns()`, `filters()`, `pageSizes()`, `defaultSort()`, `rowId()`, `countRows()`, `loadRows()` and `maxRows()` work as
the `data-table` README describes: moving a table from one recipe to the other changes its parent class and its attribute only.

```php
// src/Twig/Components/OrdersTable.php
namespace App\Twig\Components;

use App\UXor\DataTable\Column;
use App\UXor\DataTable\TableQuery;
use App\UXor\DataTableLive\AbstractLiveDataTable;
use Symfony\UX\LiveComponent\Attribute\AsLiveComponent;

#[AsLiveComponent(name: 'OrdersTable', template: 'components/DataTableLive.html.twig')]
final class OrdersTable extends AbstractLiveDataTable
{
    public function __construct(private readonly OrderRepository $orders)
    {
    }

    public function columns(): array
    {
        return [Column::make('number', 'Order')->sortable('o.number'), Column::make('status', 'Status')];
    }

    protected function countRows(TableQuery $query): int
    {
        return $this->orders->countMatching($query); // as in the data-table README
    }

    protected function loadRows(TableQuery $query): array
    {
        return $this->orders->findPage($query); // as in the data-table README
    }
}
```

Render it anywhere, with no controller code: the component reads its state from the URL and loads its rows.

```twig
<twig:OrdersTable tableId="orders" label="Orders" />
```

`tableId` prefixes the rows' element ids (`orders-row-<row id>`): give each table on a page its own. Cells render
`row.<key>` unless you pass a `<twig:block name="cell_<key>">`, as with `data-table`. Write those blocks in a template
file: Live Components render them again from it on each update, and a template built from a string (Twig's
`template_from_string()`) cannot be found again.

### Selection and bulk actions

Each row has a checkbox; the ids of the selected rows are in `$this->selectedIds` (strings), on every page: a
filter, a sort or another page keeps them. "Select this page" adds the rows of the current page. Override
`selectable()` to return `false` for a table without selection.

The selection holds at most `maxSelection()` rows (1,000 by default; override it): once full, "Select this page" and
the unchecked boxes are gone or disabled, and the table says so. What the browser sends is cut to that many ids, and
ids longer than 128 characters are dropped, before your code or the table reads them. Live Components decode the
request before that: keep the server's request body limit (FrankenPHP and Caddy `request_body`, nginx
`client_max_body_size`) to what your pages need.

A bulk action is a `#[LiveAction]` of your class. The ids come from the browser: check that the user may act on each
one, in one query bounded by `maxSelection()`.

```php
#[LiveAction]
public function archiveSelected(): void
{
    // $this->security: Symfony\Bundle\SecurityBundle\Security, injected in the constructor
    foreach ($this->orders->findBy(['id' => $this->selectedIds, 'owner' => $this->security->getUser()]) as $order) {
        $order->archive();
    }
    $this->selectedIds = [];
}
```

Its button goes in the `selection_actions` block, shown while rows are selected:

```twig
<twig:OrdersTable tableId="orders" label="Orders">
    <twig:block name="selection_actions">
        <twig:Button size="xs" variant="danger" data-action="live#action" data-live-action-param="archiveSelected">Archive</twig:Button>
    </twig:block>
</twig:OrdersTable>
```

### URL, history and Turbo

The search, filters, sort, page and page size are in the URL, with the parameter names of `data-table` (`q`, `f`,
`sort`, `dir`, `page`, `size`), and every value is checked as `data-table` checks it. Live Components replace the URL
without adding a history entry: Back leaves the page, and coming back, or reloading, or opening a copied URL, shows
the same state, in every field too: a search typed and not yet sent when the page was left is not shown (the live
controller sets the fields from the component's state as it connects). The selection is not in the URL: leaving the
page drops it, so Back and Forward show no row selected (the recipe's `data-table-live` controller clears the
selection of the copy Turbo shows, through the table's `clearSelection` action). For Back and Forward through every
state, use the `data-table` recipe in its Turbo Frame.

One table per page: the URL parameters are not prefixed (`paramPrefix()` does not apply to a Live table).

The table keeps working through Turbo visits, inside a Turbo Frame, inside a `data-turbo-permanent` element (it keeps
its state across visits) and after a Turbo Stream replaces or updates it (it starts again from the state the stream
rendered). Give a region one owner: let Live re-render the table, or replace it with a Turbo Frame or Stream, not both
at once. Turbo 8's refresh with morphing is not supported.

Whether a `turbo:before-cache` leaves the table as it is (a frame visit promoted to history, a `data-turbo-permanent`
element) is answered by the `turbo` recipe's module (`assets/lib/uxor-turbo.js`), which `ux:install
data-table-live` installs with it.
