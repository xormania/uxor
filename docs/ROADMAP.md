# Roadmap: rich components for UXor

_2026-10-07. Decisions made with the user, item by item. Roadmap only: no code. Each package gets its own
detailed plan before it is built._

Each package's status is in the *Sequence* table: `shipped` means its recipes are in `docs/RECIPES.md`, and their
READMEs describe how they behave now. This page and the `shipped` plans are records of the decisions, not instructions.

## Context

Two research docs (`…-integration-report.md` and `…-proposals.md`, which are not authoritative) and a third report
(`…-toolkit-live-table-research.md`) surveyed Symfony UX integrations. We reviewed them against the repo at
`35f778b` and the 3.5.1 sources installed in `demo/vendor/`, then decided package by package. The goal: agents
building **Turbo-driven apps** get rich UX from installed recipes with as little code as possible.

## Kit-wide rules

- **Third-party JS:** avoid it and prefer porting, case by case. Libraries that official Symfony UX packages
  already wrap are acceptable.
- **Shadcn sources:** we build our own recipes from them. They are not byte-identical copies. **Decided 2026-10-10:**
  they are credited: `NOTICE` names shadcn/ui and the Symfony UX Toolkit shadcn kit, each derived recipe's README
  (`popover`, `calendar`, `date-picker`) names the recipe it was built from, and so do the `calendar` and
  `date-picker` controllers.
- **Kit PHP:** recipes may copy PHP into `src/` under `App\UXor\…`. The research tested this at runtime on
  7.4.20 and 8.1.8 with Toolkit 3.5.1, and it passes lint and debug.
- **Turbo gate (required for every package with behavior):**
  - Cache snapshot and Back.
  - Repeated visits away and back: one controller instance, no duplicate DOM, listeners or console errors.
  - Inside a Turbo Frame, inside `data-turbo-permanent`, and under a Stream `replace` and `update`.
  - Plus the CSP spec, a11y `labPages` and a Live re-render where relevant.
- One owner per region: Live or Turbo Frame/Stream, never both. Turbo 8 refresh morph is not supported.
- **Shared code:** logic two recipes need lives once, in an assets-only recipe whose module the others import
  (`floating`, `navigation`, `turbo`); `tools/js-duplication.mjs` keeps new copies out (CONTRIBUTING, *Shared code*).

## Sequence (confirmed)

| # | Package | Decision | Recipes | Status |
|---|---|---|---|---|
| 1 | **D. Data table** | `data-table` (plain, Turbo Frame) plus `data-table-live`. Details below | `data-table`, `data-table-live` | shipped |
| 2 | **B. Searchable choices** | **UX Autocomplete** (Tom Select) styled with our theme and form theme | `autocomplete` | shipped |
| 3 | **C. Dates** | Our own `calendar`, `popover` and `date-picker` recipes from shadcn sources | `calendar`, `popover`, `date-picker` | shipped |
| 4 | **E1. Charts** | **UX Chart.js** plus a theme bridge | `chart` | shipped |
| 5 | **E2. Files** | **UX Dropzone** styled, wired into the form theme | `dropzone` | shipped |
| 6 | **F. Rich editor** | **Tiptap** | `editor`, `markdown-editor` | shipped |
| — | Navigation | Added after this sequence, outside the roadmap's packages: a tree, the mobile drawer, the navbar's menus and section tabs, and the positioning `dropdown`, `popover` and `tooltip` share. Each recipe's README holds its decisions | `side-nav`, `mobile-nav`, `nav-menu`, `section-nav`, `floating` | shipped |
| — | A. Conventions | Grows inside D and B. One CONTRIBUTING section after the second package | — | shipped |
| — | Deferred | Cropper, Map, sortable lists, virtual grid, Uppy, FullCalendar, "select all matching" | — | open |
| — | Docs pairing | A deterministic script replaces the `Docs-waiver:` trailers of `tools/readme-pairing.mjs`: it decides from the change itself whether a recipe's README must change. Not started | — | open |

D and C can run in parallel because they touch different recipes.

## D. Data table

- **Two recipes:**
  - `data-table`: links plus a GET filter form in `<turbo-frame data-turbo-action="advance">`. Turbo gives
    Back/Forward per state. No kit JS.
  - `data-table-live`: Live state, `url: true` (replaceState). Back leaves the page, and the URL restores the last
    state.
  - The README tells agents which to choose.
- **Kit PHP** in `App\UXor\DataTable\`: `AbstractDataTable`, `Column`, `TableQuery`, `TableResult` and a
  page-window helper, plus one shared template.
- **App code per table:** one subclass in `App\Twig\Components\` with an explicit
  `#[AsLiveComponent(name, template)]`, `columns()` (label, sortable, field mapping) and
  `loadPage(TableQuery): TableResult`.
  - Custom cells override one Twig block per column.
  - Rows have a stable `id`, or an overridable `rowId()`.
  - The plain recipe uses the same contract through `TableQuery::fromRequest()`.
- **Input checks:** sort tokens limited to `columns()`, page bounds, a PostMount check of URL input, and a page
  reset when a filter changes.
- **Pagination:** our own integer page plus the existing `pagination` recipe. UX Pagination is not a dependency
  (experimental). Look again once it is stable.
- **Selection:** a `selectedIds` LiveProp plus "select this page". Not stored in the URL.
- **Lab specs (Turbo gate):**
  1. Plain table in a frame: Back/Forward walks each state.
  2. Live table: page 1 → 3 and sort, visit away, Back. Check the URL, the rows, which snapshot is shown, and that
     it is still live.
  3. Live table: repeated visits away and back.
  4. Live table inside a Frame and inside `data-turbo-permanent`.
  5. A Stream `replace` and `update` on the table.
  6. The `App\UXor` subnamespace works at runtime.
- **CI and docs:** PHP syntax checking plus PHPStan on kit PHP. The contract is written by hand in the README and in
  `docs/PROJECT-AGENTS-SNIPPET.md`.

## B. Searchable choices

- UX Autocomplete through the form theme: single and multiple choices, local and server-side search, tags.
- Gates: the Turbo gate (no double-wrapped Tom Select after a cache restore), CSP (inline `style` written by Tom
  Select) and Live re-render.
- The shadcn `combobox` is not used; it may return later as a picker outside forms.

## C. Dates

- **`calendar` and `date-picker`** from the shadcn 3.5.1 sources (about 760 lines of JS), themed with our roles and
  icons. Adds `twig/intl-extra`. Supports single, multiple and range selection, min/max, disabled dates, locale,
  RTL and several months.
- **Fix the five source observations:**
  - Native input/change events.
  - Clear on empty or invalid typed text.
  - Refresh on bounds, disabled dates and locale.
  - Validate typed dates like clicked ones.
  - Keep names and attributes on recreated hidden inputs.
- **Wiring:** a form-theme block, the Live bridge, the Turbo, CSP and a11y gates.
- **`popover`:** a new recipe, separate from `dropdown`.
  - It behaves as a non-modal dialog: Escape and outside click close it, it has groups, and focus moves in and back.
  - Its positioning is copied from `dropdown_controller.js` (flip, shift, follow on scroll and resize).
  - `dropdown` and `tooltip` are unchanged. A shared helper is deferred. (Done since: the `floating` recipe, one
    module that `dropdown`, `popover` and `tooltip` import; see its README.)
- **Times:** native `<input type="time">`. Native `type="date"` keeps working.

## E1. Charts

- UX Chart.js plus a theme bridge: it reads the theme's CSS variables into the options and redraws on light/dark.
- An accessible data table alongside each chart.
- Gates: CSP, Turbo, Live data update, teardown.

## E2. Files

- UX Dropzone (no third-party JS), styled and wired into the form theme.
- The default path is a Turbo-submitted multipart form.
- Live rule: keep it out of re-rendered regions, or upload through a `files` action first. Proved in the lab.
- Out of scope: queues, resumable uploads, image processing.

## F. Rich editor

- Tiptap. To settle when F starts: content format (HTML or JSON), extensions, local import graph, PHP rendering,
  and the gates.

## Verification (each package)

- Kit lint, `ux-toolkit-kit-debug`, `node tools/contrast/check.mjs`, and PHP lint plus PHPStan where PHP ships.
- `npx playwright test`: new `tests/e2e/lab.<scenario>.spec.ts`, `csp.spec.ts`, `a11y.spec.ts`.
- Screenshots only with `--update-snapshots=missing`. Never update existing baselines.

## Next step after approval

Write the detailed implementation plan for D (data table). (Done since: every package of the *Sequence* shipped
in 0.2.0, each from its `docs/PLAN-*.md`.)
