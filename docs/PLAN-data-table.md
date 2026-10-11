---
status: shipped
recipes: data-table, data-table-live
---

# Plan: D. data table

_2026-10-07. Implements the D decisions in [`ROADMAP.md`](ROADMAP.md). Two pull requests: `data-table` (plain,
with the shared PHP), then `data-table-live`._

## Spike result (2026-10-07, demo on Symfony 8.1.8 under PHP 8.4, browser-driven, files removed after)

- An abstract base class in `App\UXor\DataTable\` plus a subclass with an explicit `#[AsLiveComponent(name,
  template)]` loads, renders and runs Live actions.
- A cell block passed as component content (`{% block cell_name %}…{{ row.name }}…{% endblock %}`) and looked up by
  name in the row loop (`block('cell_' ~ key) is defined`) renders on first load, after Live re-renders, after Back
  and after a reload.
- Live changes `?page=1` → `?page=3`, a Turbo visit away, then Back: Turbo restores its snapshot at `?page=3`, page 3,
  in the same document. Live actions keep working after Back, and a reload keeps the state.

## Shared contract (PR 1)

Kit-owned PHP in `data-table/src/UXor/DataTable/`, installed as `src/UXor/DataTable/`:

| Class | Role |
|---|---|
| `AbstractDataTable` | What each app table extends. It declares `columns()`, `filters()` (optional), `pageSizes()` (default `[10, 25, 50]`), `defaultSort()` and `rowId(row)` (default `row['id']` or `row.id`). It implements `loadPage(TableQuery): TableResult`. `handleRequest(Request): DataTableView` builds the query from the request, loads the page and clamps it |
| `Column` | `Column::make(key, label)->sortable(field)`. The public key goes in the URL; the field never leaves the server |
| `Filter` | `Filter::choice(key, label, choices)`. Values outside `choices` are dropped |
| `TableQuery` | Already-checked search (trimmed, at most 100 characters), filters, sort key and field, direction (`asc`/`desc`), page (≥ 1) and page size (one of `pageSizes()`). `fromValues(array, AbstractDataTable)` does all the checking, and `fromRequest` calls it |
| `TableResult` | `rows`, `total`; `pageCount()`, `from()`, `to()` |
| `DataTableView` | Table, query and result, plus `pageWindow()` (1 … 4 5 [6] 7 8 … 20) and `url(changes)` for links |

Rules:
- A page past the end loads the last page. Every query value is checked again by `fromValues`, because URL input is
  never trusted (Live docs: initial URL values are not validated).
- A change of search, filter or page size goes back to page 1.
- Query parameters: `q`, `sort`, `dir`, `page`, `size`, `f[<key>]`. An optional `paramPrefix` lets several tables
  share a page.

## PR 1: `data-table` (plain)

**Recipe** `data-table/`:
- `manifest.json`: type `component`, name `DataTable`. Copies `src/` and `templates/`. Depends on the `table`,
  `pagination`, `input`, `select`, `button` and `empty-state` recipes and on the composer packages its templates need
  (lint's `composer.symbol-undeclared` names any missing one).
- `templates/components/DataTable.html.twig`. Prop `table` (a `DataTableView`) and an `id`. It renders:
  - `<turbo-frame id data-turbo-action="advance">` around everything.
  - A GET form with search, filter selects and page size, plus a submit button (the form works without JS).
  - `Table` with headers whose sort links carry `aria-sort`.
  - Rows with `id="{{ id }}-row-{{ rowId }}"`. A cell renders `block('cell_' ~ key)` when defined, otherwise
    `row[key]`.
  - `EmptyState` when there are no rows.
  - A `role="status"` line: "Showing 11–20 of 42".
  - `Pagination` built from `pageWindow()`.
- No Stimulus controller and no inline style (CSP).
- `README.md` follows the house order. It covers the PHP contract (written by hand, because the generated API covers
  Twig only), the app's controller (`$table->handleRequest($request)`), the cell override, which table to choose,
  "install from the project root", the fixed `App\` namespace and what to change for another root, and the
  Turbo-frame history behavior.

**Demo:**
- `demo/src/Demo/OrdersTable.php`: about 60 in-memory orders; `loadPage` filters, sorts and slices an array.
- A preview data provider (like `demo/src/Kit/PreviewForms.php`) for the README examples.
- `demo/.gitignore`: `/src/UXor/`, because sync-demo copies it.

**Lab** `data-table-frame` (new `SCENARIOS` entry, template, `tests/e2e/lab.data-table-frame.spec.ts`):
- Search, filter, sort, page and page size each change the frame and the URL. Back/Forward walks each state, and
  the page outside the frame stays the same document.
- A bad URL (unknown sort, page 999, size 7, foreign filter value) renders a valid table.
- A custom cell block is shown.
- Repeated visits away and back: no duplicate frames and no console errors.
- The path goes in `a11y.spec.ts` `labPages`, and the CSP spec covers it.

**CI and checks:**
- New job: `php -l` on every `*/src/**/*.php`, plus PHPStan (level 8) on the synced `demo/src/UXor` with the
  demo's autoloader. `phpstan/phpstan` becomes a demo dev dependency.
- `tools/tests/fresh-install.sh` and the fresh-app fixture install `data-table` and render a table. That is the
  runtime proof on 7.4. `docker-install.sh` covers the latest Symfony.
- Kit lint, debug, contrast (add pairs if new colors appear), Playwright.
- Screenshots: `--update-snapshots=missing` only.

**Docs:**
- README recipe table: a new row, replacing the "planned" line.
- `docs/PROJECT-AGENTS-SNIPPET.md`: "for a list page: `ux:install data-table`, extend `AbstractDataTable`, implement
  `columns()` and `loadPage()`".
- CONTRIBUTING: recipes may ship PHP under `App\UXor\`, plus the PHP checks.
- CHANGELOG `### Added`.

## PR 2: `data-table-live`

**Recipe** `data-table-live/`:
- Depends on the `data-table` recipe and `symfony/ux-live-component`.
- `AbstractLiveDataTable extends AbstractDataTable`. The app's subclass adds
  `#[AsLiveComponent(name: 'OrdersTable', template: 'components/DataTableLive.html.twig')]`. Moving from plain to Live
  means changing the parent class and adding the attribute; `columns()` and `loadPage()` stay the same.
  - LiveProps with `url: true` and the same parameter names: `search`, `filters`, `sort`, `direction`, `page`,
    `pageSize`.
  - `selectedIds` (writable, not in the URL).
  - Actions `sortBy`, `goTo`, `selectPage`, `clearSelection`.
  - `onUpdated` resets the page.
  - PostMount and each render normalise through `TableQuery::fromValues`.
  - The result is cached per render (`computed.result`).
- `templates/components/DataTableLive.html.twig`: the same markup as the plain table, with Live instead of links.
  - Search uses `data-model="debounce(300)|search"`; filters `filters[key]`; page size select.
  - Sort and page buttons use `live#action`.
  - Row checkboxes use `selectedIds[]`, plus a "select this page" checkbox and a selected count.
  - Cell blocks work the same way as in the plain table (spike-proven).
- The README covers bulk actions: the app adds its own `#[LiveAction]` reading `selectedIds` and checks
  permission. It also covers selection not being in the URL, one owner per region, and refresh morph being
  unsupported.

**Lab** (the Turbo gate from the roadmap):
1. Page 1 → 3 plus a sort, visit away, Back: URL, rows, snapshot, still live.
2. Repeated visits: one `live` controller, no duplicates, no console errors.
3. Inside a Turbo Frame, and inside `data-turbo-permanent`.
4. A Turbo Stream `replace` and `update` on the region.
5. Selection kept across pages, filters and sorts. "Select this page" adds the page's ids only.
6. Bad URL input is normalised.
7. The CSP and a11y specs.

The existing `live-table` lab stays.

**CI and docs:**
- `fresh-install.sh` installs `data-table-live` and runs one Live action. The research's PHP-recipe proof becomes a CI
  check.
- README row, agent snippet ("selection or bulk actions → `data-table-live`"), CHANGELOG.

## Out of scope

"Select all matching", cursor pagination, UX Pagination, column visibility or reordering, inline editing, export,
and Turbo 8 refresh morph.

## Done when

Each PR is green in CI (lint, PHP checks, fresh installs, Playwright including CSP and a11y) and follows the pull
request template.

- Request the Codex reviews once per PR, the first time CI is green: two separate PR comments, exactly
  `@codex review` and `@codex security review`, with no footer, as on PR #9 and PR #20.
- Address the findings and push, but do not request the reviews again.
- Attribution: commits and PRs are xormania's only. No AI attribution lines, footers or co-author trailers.
