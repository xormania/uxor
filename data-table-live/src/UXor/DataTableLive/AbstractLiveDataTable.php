<?php

namespace App\UXor\DataTableLive;

use App\UXor\DataTable\AbstractDataTable;
use App\UXor\DataTable\DataTableView;
use App\UXor\DataTable\TableQuery;
use Symfony\UX\LiveComponent\Attribute\LiveAction;
use Symfony\UX\LiveComponent\Attribute\LiveArg;
use Symfony\UX\LiveComponent\Attribute\LiveProp;
use Symfony\UX\LiveComponent\Attribute\PreReRender;
use Symfony\UX\LiveComponent\DefaultActionTrait;
use Symfony\UX\LiveComponent\Metadata\UrlMapping;
use Symfony\UX\TwigComponent\Attribute\PostMount;

/**
 * A data table rendered as a Live Component: the same columns(), filters(), countRows() and loadRows() as
 * AbstractDataTable, plus row selection. Its state is in the URL (the same `q`, `f`, `sort`, `dir`, `page` and
 * `size` parameters), replaced on each change: Back leaves the page, and the URL brings the last state back. The
 * selection is not in the URL.
 *
 *     #[AsLiveComponent(name: 'OrdersTable', template: 'components/DataTableLive.html.twig')]
 *     final class OrdersTable extends AbstractLiveDataTable { ... }
 *
 * Render it with `<twig:OrdersTable tableId="orders" label="Orders" />`; a bulk action is a #[LiveAction] of the
 * subclass reading $this->selectedIds (check them: they come from the browser). The selection holds at most
 * maxSelection() ids of at most SELECTED_ID_MAX_LENGTH characters.
 */
abstract class AbstractLiveDataTable extends AbstractDataTable
{
    use DefaultActionTrait;

    /** The longest row id the selection keeps. */
    public const SELECTED_ID_MAX_LENGTH = 128;

    #[LiveProp(writable: true, onUpdated: 'firstPage', url: new UrlMapping(as: 'q'))]
    public string $search = '';

    /**
     * The chosen value of each filter, by filter key (not `$filters`: Symfony's property accessor would read the
     * filters() method instead).
     *
     * @var array<string, string>
     */
    #[LiveProp(writable: true, onUpdated: 'firstPage', url: new UrlMapping(as: 'f'))]
    public array $filterValues = [];

    #[LiveProp(writable: true, url: true)]
    public ?string $sort = null;

    #[LiveProp(writable: true, url: new UrlMapping(as: 'dir'))]
    public string $direction = 'asc';

    #[LiveProp(writable: true, url: true)]
    public int $page = 1;

    #[LiveProp(writable: true, onUpdated: 'firstPage', url: new UrlMapping(as: 'size'))]
    public int $pageSize = 0;

    /**
     * The ids of the selected rows, on every page; hydrateSelectedIds() bounds what the browser sends.
     *
     * @var list<string>
     */
    #[LiveProp(writable: true, hydrateWith: 'hydrateSelectedIds')]
    public array $selectedIds = [];

    /** @var array<string, true>|null the selected ids as keys, for isSelected() */
    private ?array $selectedLookup = null;

    /** The prefix of the rows' element ids, unique on the page. */
    #[LiveProp]
    public string $tableId = 'table';

    /** The table's accessible name, also its caption. */
    #[LiveProp]
    public ?string $label = null;

    private ?DataTableView $view = null;

    /**
     * Whether rows can be selected. Override it to return false for a table without bulk actions.
     */
    public function selectable(): bool
    {
        return true;
    }

    /**
     * The most rows the selection holds: past it, "Select this page" and the unchecked boxes stop adding rows.
     */
    public function maxSelection(): int
    {
        return 1_000;
    }

    /**
     * Whether the selection holds maxSelection() rows.
     */
    public function isSelectionFull(): bool
    {
        return \count($this->selectedIds) >= $this->maxSelection();
    }

    /**
     * Reads the selection the browser sends before anything else uses it: its first maxSelection() entries only, and
     * of those, the scalar ids of at most SELECTED_ID_MAX_LENGTH characters, once each.
     *
     * @return list<string>
     */
    public function hydrateSelectedIds(mixed $data): array
    {
        if (!\is_array($data)) {
            return [];
        }

        $ids = [];
        foreach (\array_slice($data, 0, $this->maxSelection()) as $id) {
            // characters, not bytes; the byte count first, so a huge string is not scanned (4 bytes at most each)
            if (\is_scalar($id) && \strlen((string) $id) <= 4 * self::SELECTED_ID_MAX_LENGTH
                && mb_strlen((string) $id, 'UTF-8') <= self::SELECTED_ID_MAX_LENGTH) {
                $ids[(string) $id] = true;
            }
        }

        // numeric ids became integer keys
        return array_map('strval', array_keys($ids));
    }

    #[LiveAction]
    public function sortBy(#[LiveArg] string $column): void
    {
        $this->direction = $column === $this->sort && 'asc' === $this->direction ? 'desc' : 'asc';
        $this->sort = $column;
        $this->page = 1;
    }

    #[LiveAction]
    public function goTo(#[LiveArg] int $page): void
    {
        $this->page = $page;
    }

    /**
     * Adds the rows of the current page to the selection; the rows selected on other pages stay selected.
     */
    #[LiveAction]
    public function selectPage(): void
    {
        $ids = array_fill_keys($this->selectedIds, true);
        foreach ($this->getView()->result->rows as $row) {
            if (\count($ids) >= $this->maxSelection()) {
                break;
            }
            $ids[(string) $this->rowId($row)] = true;
        }
        $this->selectedIds = array_map('strval', array_keys($ids));
    }

    #[LiveAction]
    public function clearSelection(): void
    {
        $this->selectedIds = [];
    }

    public function firstPage(): void
    {
        $this->page = 1;
    }

    /**
     * Checks the state (initial URL values are not checked by Live Components) and loads the page, before the
     * component renders its state: a page past the end becomes the last page, an unknown sort the default one.
     */
    #[PostMount]
    #[PreReRender]
    public function prepare(): void
    {
        $this->selectedLookup = null; // an action may have changed the selection

        // an action that read the page (selectPage) loaded it already: render that page, not a second read of it
        $loaded = $this->view?->query;
        if (null !== $loaded && $loaded->search === $this->search && $loaded->filters === $this->filterValues
            && $loaded->sort === $this->sort && $loaded->direction === $this->direction
            && $loaded->page === $this->page && $loaded->pageSize === $this->pageSize) {
            return;
        }

        [$query, $result] = $this->fetch(TableQuery::fromValues([
            'search' => $this->search,
            'filters' => $this->filterValues,
            'sort' => $this->sort,
            'direction' => $this->direction,
            'page' => $this->page,
            'pageSize' => $this->pageSize,
        ], $this));

        $this->search = $query->search;
        $this->filterValues = $query->filters;
        $this->sort = $query->sort;
        $this->direction = $query->direction;
        $this->page = $query->page;
        $this->pageSize = $query->pageSize;
        $this->view = new DataTableView($this, $query, $result, '');
    }

    /**
     * The checked query, its page of rows and the page window, for the template.
     */
    public function getView(): DataTableView
    {
        if (null === $this->view) {
            $this->prepare();
        }

        return $this->view ?? throw new \LogicException('The table did not load.');
    }

    /**
     * Whether a row is selected.
     */
    public function isSelected(mixed $row): bool
    {
        $this->selectedLookup ??= array_fill_keys($this->selectedIds, true);

        return isset($this->selectedLookup[(string) $this->rowId($row)]);
    }
}
