# Test inventory: states, transitions and the specs covering them

_2026-10-08. Step 3 of [`PLAN-test-tiers.md`](PLAN-test-tiers.md): the suite-wide coverage map. Per recipe with
behavior, its states, the transitions it must survive, and the test that establishes each, or a gap. Built from the
controllers, the lab pages and the specs on `dev` (`a3f37dd`), not from their titles alone. A pull request that adds,
moves or removes coverage updates the rows it touches, and its own coverage map (the pull request template) says so._

## How to read it

- **Specs** are named by file without `.spec.ts`: `lab.popover` is `tests/e2e/lab.popover.spec.ts`; a recipe's own
  spec (`<recipe>/tests/*.spec.ts`, run as `tests/e2e/examples/recipes/`) is `recipe:<name>`; the interaction
  screenshots of `tests/e2e/examples/fixtures.ts` (`testState`) are `shot:<recipe>`. PHPUnit tests are named by class
  (`demo/tests/…`).
- **Scope:** unit, Twig or Live component (PHPUnit with the UX helpers), functional (`WebTestCase`), E2E lab
  (`/lab/*` pages), E2E demo (`/preview/*`, `/forms`, `/demo`), screenshot.
- **Browsers:** every E2E test named here runs in Chromium, Firefox and WebKit, in CI on every change the browser job
  checks, except the screenshot comparisons (`shot:<recipe>`, `examples/examples`, `examples/pages`, `baselines`,
  `forms` "rows rendered by the form theme look like the hand-written components"): tagged `@screenshot`, they run in
  Chromium only, against its baselines ([`TESTING.md`](TESTING.md), *Browsers*).
- **Cells:** a spec name means covered there; **G*n*** is a gap, ranked at the end; `·` means the transition cannot
  affect the recipe (no state it would lose, or the recipe never sits where it happens); `css` means the theme changes
  only CSS variables, so the screenshots of both themes cover the end states and nothing runs in between; **T2**,
  **T3** mean the check belongs to tier 2 (counts) or tier 3 (release checks) of the plan, not to tier 1.
- **Code coverage** is not tracked here: the monthly job reports the recipes' PHP lines and surviving mutants, and
  the controllers' JS lines with the methods no test runs ([`TESTING.md`](TESTING.md), *Monthly job*). A method it
  lists as never run is a candidate gap for this file, checked against the behavior before a row changes.

## Which recipes are here

A recipe is in the matrix when one of these holds (found with `*/assets/controllers/*_controller.js`, a grep of
the recipes' templates and PHP for `data-controller`, `symfony--ux-*`, `AsLiveComponent`, `data-turbo*`,
`turbo-frame` and `turbo-stream`):

1. **It ships a Stimulus controller:** alert, autocomplete (`autocomplete_sync`), avatar, calendar (with `calendar_display`), chart, data-table, data-table-live, date-picker, drawer,
   dropdown, dropzone (`dropzone_assist`), editor, layouts (`form_reset`), markdown-editor, mobile-nav, modal (`flowbite_modal`), nav-menu,
   navbar, popover, section-nav, side-nav, sidebar, tabs, theme-toggle, toast, tooltip. `tools/test-inventory.mjs`
   (CI's *Contrast*) fails when one has no row in the matrix.
2. **It wires a Symfony UX controller:** autocomplete (and form-theme's `AutocompleteType` rows), chart (UX Chart.js),
   dropzone (UX Dropzone).
3. **It is a Live Component:** data-table-live, markdown-editor.
4. **Its markup carries Turbo behavior:** data-table (a `<turbo-frame>` with `data-turbo-action="advance"`), layouts
   (`data-turbo-permanent` sidebar and toast region, `data-turbo-track`, the inline theme script), sidebar and toast
   (`data-turbo-permanent`, the toast's Stream template).

Left out, with where their guarantees live: the presentational recipes (badge, button, card, table, …) and theme
(CSS only): screenshots of every README example in both themes (`examples/examples`), axe on every example in both
themes and every `/r/` page (`a11y`), hostile props (`hostile-props`), markup snapshots for Badge and Breadcrumb only
(`demo/tests/Twig/ComponentsTest.php`), the Button keyboard focus outline at 3:1 or more against what it touches, every
variant in both themes (`button-focus`). Pagination: links only, its frame behavior is the data table's. The blocks
(login, signup, forgot-password, settings-profile, not-found, dashboard-home): server flows in `demo-app` (E2E demo).
form-theme: `forms` (rows match the hand-written components in both themes, server errors, the date picker and
Dropzone opt-ins). input, select (CSS only): `forms` "every Input pads its text the same, with or without a type",
"a Select's text stops before its chevron" (ltr and rtl), "a multiple Select shows no chevron and no option cut at the
bottom".

The gallery (E2E demo, `demo-app`): every `/r/*` and `/demo` page fits at 320px with no Markdown source shown and a
recipe name of any length wrapping, every page names an icon, the header is one row at 320 and 390px, the hero's two
secondary links share one style; `StaticExportBannerTest` places the static notice beside the sidebar (functional).

The demo itself has an executable deployment contract outside the recipe matrix:
`ProductionConfigurationTest` refuses an accidental production boot and proves a deliberate one has no development
toolkit or profiler; `RouteSecurityTest` requires every app route to declare its trust category, allowed methods and,
for a public POST route, its CSRF mechanism ([`DEMO-SECURITY.md`](DEMO-SECURITY.md)).

## The matrix: common transitions

Columns are the plan's transitions. **Back** is a restoration visit from Turbo's cached copy; **Back, slow** is the
same with page two's stylesheet held until Turbo has copied the page, so the copy comes before the controllers disconnect (the order
production gives; `lab.turbo-restore`); **N visits** is "repeated visits leave one instance", today shown by its
effect (one change per pick, one toggle per click) and element counts, a Stimulus instance count from tier 2 on. A `·` means
the transition cannot change the recipe's state, not that it is untested. **Frame, advance** is a frame beside the
recipe whose visit is promoted to history, then Back and Forward (lab.value-matrix's `frame-advance` column for the
widgets it holds). data-table-live's cell is n/a there: a frame beside it whose visits are promoted to history writes
its own URL over the one the Live table wrote, two owners of one URL that no recipe documents.

| Recipe | Back | Back, slow | Forward | N visits | Permanent | Frame reload | Frame, advance | Stream replace/update | Live re-render | Theme switch | System theme |
|---|---|---|---|---|---|---|---|---|---|---|---|
| theme-toggle | theme-toggle | · | lab.value-matrix | T2 | · | · | · | · | · | theme-toggle | theme-toggle |
| layouts | demo-app, lab.form-back, lab.data-table-back, lab.value-matrix | · | lab.value-matrix | · | lab.turbo-nav, demo-app | · | · | lab.turbo-nav | · | csp (first paint) | css |
| sidebar, navbar | lab.turbo-nav | · | lab.turbo-nav | T2 | lab.turbo-nav | · | · | · | · | css | · |
| side-nav | lab.side-nav | · | lab.side-nav | lab.side-nav | lab.side-nav | · | · | · | · | lab.side-nav (on load) | css |
| mobile-nav | lab.mobile-nav | · | lab.mobile-nav | lab.mobile-nav | G10 | · | G10 | · | · | css | · |
| nav-menu | lab.nav-menu | · | lab.nav-menu | lab.nav-menu | lab.nav-menu | · | G10 | · | · | css | · |
| toast | lab.turbo-restore, demo-app | · | G10 | · | lab.turbo-stream-toast, lab.turbo-restore | · | lab.turbo-restore | lab.turbo-stream-toast, lab.turbo-nav | · | css | · |
| alert | G10 | · | · | · | · | · | · | G10 | G10 | css | · |
| avatar | avatar | · | · | · | · | · | · | · | · | · | · |
| tabs | lab.section-nav, lab.value-matrix | · | lab.section-nav, lab.value-matrix | lab.section-nav | lab.value-matrix | lab.value-matrix | lab.value-matrix | lab.value-matrix (removing the selected tab: lab.section-nav) | lab.value-matrix | css | · |
| section-nav | lab.section-nav | · | lab.section-nav | lab.section-nav | lab.section-nav | · | · | · | · | css | · |
| dropdown | lab.turbo-restore, lab.overlays | lab.turbo-restore, lab.overlays | lab.overlays | lab.overlays | lab.value-matrix | lab.turbo-frame-detail, lab.overlays | lab.turbo-restore, lab.overlays | lab.overlays | lab.value-matrix, lab.live-table | T3 | · |
| modal | lab.turbo-restore, lab.overlays | lab.turbo-restore, lab.overlays | lab.overlays | lab.overlays | lab.value-matrix | lab.overlays | lab.overlays | lab.overlays | lab.value-matrix, lab.live-modal | T3 | · |
| drawer | lab.turbo-restore, lab.overlays | lab.turbo-restore, lab.overlays | lab.overlays | lab.overlays | lab.value-matrix | lab.overlays | lab.overlays | lab.overlays | lab.value-matrix, lab.live-drawer | T3 | · |
| popover | lab.value-matrix, lab.popover | · | lab.value-matrix | lab.popover | lab.value-matrix | lab.popover | lab.popover, lab.value-matrix | lab.value-matrix | lab.value-matrix | T3 | · |
| tooltip | lab.turbo-restore, lab.tooltip | lab.turbo-restore | lab.tooltip | lab.tooltip | lab.tooltip | lab.tooltip | lab.tooltip | lab.tooltip | lab.live-table | T3 | lab.tooltip |
| calendar | lab.calendar, lab.value-matrix | · | lab.value-matrix | lab.calendar | lab.calendar | lab.calendar | lab.calendar, lab.value-matrix | lab.value-matrix | lab.calendar | css | · |
| date-picker | lab.value-matrix, lab.form-back | · | lab.value-matrix | lab.date-picker | lab.date-picker | lab.date-picker | lab.date-picker | lab.value-matrix | lab.date-picker | css | · |
| chart | lab.chart | · | G10 | lab.chart | lab.chart | lab.chart | lab.chart | lab.chart | lab.chart | lab.chart | G10 |
| dropzone | lab.dropzone, lab.value-matrix | · | lab.value-matrix | lab.dropzone | lab.value-matrix | lab.dropzone | lab.dropzone, lab.value-matrix | lab.dropzone | lab.dropzone | css | · |
| editor | lab.editor | · | lab.value-matrix | lab.editor | lab.value-matrix | lab.editor | lab.value-matrix | lab.value-matrix | lab.editor | css | · |
| markdown-editor | lab.value-matrix | · | lab.value-matrix | lab.markdown-editor | lab.value-matrix | lab.markdown-editor | lab.value-matrix | lab.value-matrix | markdown-editor | css | · |
| autocomplete | lab.autocomplete, lab.form-back, lab.value-matrix | · | lab.value-matrix | lab.autocomplete | lab.value-matrix | lab.value-matrix | lab.value-matrix | lab.value-matrix | lab.autocomplete, lab.value-matrix | T3 | · |
| data-table | lab.data-table-frame, lab.data-table-back, lab.data-table-interrupt | · | lab.data-table-frame, lab.data-table-back, lab.data-table-interrupt | lab.data-table-frame | · | lab.data-table-frame | lab.data-table-frame, lab.data-table-back, lab.data-table-interrupt | · | · | css | · |
| data-table-live | lab.data-table-back, lab.value-matrix | · | lab.value-matrix | lab.data-table-live | lab.value-matrix | lab.value-matrix | lab.value-matrix (n/a) | lab.value-matrix | lab.data-table-live | css | · |

"Back, slow" is `·` for the recipes whose cached copy does not depend on the disconnect order: they save their state
on `turbo:before-cache` (popover, date-picker, editor, markdown-editor; popover and date-picker also close a copy the
browser opened as it connects), on every change (side-nav, calendar's
inputs), or read it back on connect.

## Per recipe

Each table lists the recipe's own states and interactions, then the transitions above that need more than a cell.
Titles are quoted from the specs.

### theme-toggle (and the layouts' inline theme script)

States: system light or dark × no, light or dark choice saved; storage available or blocked; per state the `dark`
class at first paint and after, `aria-pressed`, the icon shown, the saved choice.

| Transition | Scope | Covered by |
|---|---|---|
| First paint, every system × choice | E2E demo | theme-toggle "shows the expected theme from the first paint" (6) |
| Toggle, then Turbo visit, Back, reload | E2E demo | theme-toggle "the toggle switches the theme, saves it, and the choice holds across a Turbo visit, Back and a reload" (6) |
| System changes while open | E2E demo | theme-toggle "the system switching to … is followed / ignored" (6) |
| No color transition on a switch, running ones left alone | E2E demo | theme-toggle "a switch › by the toggle / by the system runs no color transition", "leaves a transition already running to finish on its own" |
| Storage blocked, Turbo visit | E2E demo | theme-toggle "storage blocked › the toggle switches the theme, and the choice holds across a Turbo visit without localStorage" (moved from smoke) |
| Storage blocked, Back and reload | | G10 |
| Theme before paint without a toggle (auth layout), under the CSP nonce | E2E demo | csp "the layout sets the theme before the first paint" |
| Native controls (menus, list selection, scrollbars) follow the chosen theme, not the system: `color-scheme` on the page and on selects | E2E demo | calendar "system … theme chosen › the month and year options are readable…" (2) |
| Theme kept by a permanent panel's page | E2E lab | lab.turbo-nav "a data-turbo-permanent panel is kept across Turbo visits (not its scroll) and the theme persists" |
| Two toggles on one page stay in sync (`aria-pressed` follows the class) | | G10 |
| One `matchMedia` and one observer per toggle after N visits | | T2 |

### layouts

States: theme at first paint; the permanent sidebar and toast region shared by every layout; the document's scroll;
flash messages; the forms of a page restored on Back and Forward (`form-reset` on `<body>`).

| Transition | Scope | Covered by |
|---|---|---|
| Flash shown on every layout, once | E2E demo | demo-app "flash messages show on every layout: the logout notice on the auth layout, not later on the dashboard" |
| Toast region kept across layouts, Back | E2E demo | demo-app "every layout keeps the same toast region: a toast closed on another layout does not come back on Back" |
| Document scroll restored on Back | E2E demo | demo-app "the app layout scrolls the document, so the keyboard scrolls it and Turbo restores it on Back" |
| Same document across links | E2E demo | smoke "links navigate with Turbo Drive (no full page load)" |
| Back after a change in a form: a GET form shows the URL's values (rendered by the server), a POST form what was left; per widget kind (a native input, an autocomplete, a date picker), the others as rendered; what the user sees checked too (Tom Select's item, the date picker's field, hidden input and selected day) | E2E lab | lab.value-matrix, `back` of the GET and POST rows (text field, autocomplete, date picker, also checkbox, toggle and calendar), each widget alone on its page (R8: these replaced lab.form-back's 6 tests, GET and POST × 3 widgets on one form; a field left unchanged beside them is the cell of its own row). Before: without `form-reset` (the code before it) the 3 GET tests failed; resetting every form failed the 3 POST tests; without Tom Select's `sync()` the GET autocomplete test failed on the item shown, the `<select>` right; without the calendar's `reset` listener the GET date picker test failed. Now: without `form-reset`'s GET reset the matrix's GET `back` cells fail |
| A GET form's date picker goes back to the month rendered, focus on its day | E2E lab | lab.form-back "a date picker in a GET form also goes back to the month rendered" (failed without the calendar's `reset` listener) |
| A calendar follows the reset of a form outside it, tied by the inputs' `form` attribute, before a multiple calendar has any input | E2E | calendar "a calendar whose inputs belong to a form outside it…" (failed when the form was only looked up through the inputs and around the calendar) |
| A GET form holding the focus as the page's scripts start keeps what was typed; one not holding it is reset | E2E lab | lab.form-back "a GET form holding the focus…", "…not holding the focus…" (the controller's request held; failed without the focus exception, and without `form-reset`) |
| A GET form after Back: the layouts' sync of Tom Select and the autocomplete's own (`autocomplete-sync`) leave one item and dispatch no `input` or `change`; a later `form.reset()` still syncs it | E2E lab | lab.form-back "a GET form after Back: the two syncs of Tom Select…" (failed without `autocomplete-sync`'s reset listener on the later reset: Banana shown, Apple expected) |
| The data table's search form resets itself, without `form-reset` (a table installed without `layouts`) | E2E lab | lab.data-table-back (passes with `form-reset` removed from `<body>`; 4 of its tests failed so before the table's own reset was restored) |
| The value matrix (owner decision 6b): each widget holding a value or a state the user changes (the fields of a GET and of a POST form, autocomplete, date picker, calendar, editor, Markdown editor, dropzone, tabs, dropdown, popover, modal, drawer, side-nav, theme toggle, the data tables' search, page and selection) × Back, Forward, a frame reload around and beside it, a Stream replace and update of its region and beside it, a Live re-render, a `data-turbo-permanent` visit and Back, a visit away and back; each cell the policy table's expectation or `n/a` with its reason | E2E lab | lab.value-matrix (22 components × 11 transitions: 209 cells run, 33 not run (`n/a` with their reason), and a test that every cell is one or the other, run once, in the `smoke` project). Each check of a cell also expects one Stimulus controller per element of the widget's controllers, the popover's `document`/`window` listeners only while it is open, and the document the cell started in; after the transition the widget still answers the user (changed again, or its undo first: an overlay closed by its trigger, then by Escape with the focus back on the trigger; a tab, a branch, a file, a row, an editor's typing, a Markdown editor's preview). Since R8 it owns the single-transition journeys the older lab specs walked (R8 below). It found five kit bugs: a popover and a dropdown open in a `data-turbo-permanent` element closed by a visit, a dropzone's file in a POST form gone after Back and Forward, an autocomplete showing the user's choice over the one a Live re-render set, a Live table's selection shown again by Back and Forward |
| Changed assets force a full load (`data-turbo-track="reload"`): the next page's importmap names another URL for the entrypoint (rewritten in the response, as a deploy would), and the visit becomes a full load of that page; the same assets stay one document | E2E demo | demo-app "a page whose tracked importmap changed between two visits, as after a deploy, is loaded in full" (the demo's layout pages: no lab page renders the layouts; failed with the layout's value planted as `dynamic`. UX Turbo's bundle sets the same `data-turbo-track="reload"` on every importmap through `importmap_script_attributes`, so the layout's attribute matters where that default is off or overridden) |
| Layout pages at desktop and phone width | screenshot | examples/pages |

### sidebar and navbar

States: expanded or collapsed (saved in `localStorage`); open over the page on small screens or not; the
navigation's scroll; the current item.

| Transition | Scope | Covered by |
|---|---|---|
| Collapse, Turbo visit, reload | E2E lab | lab.turbo-nav "the permanent sidebar keeps its scroll, collapsed state and current item across Turbo visits" |
| Scroll and current item across visits | E2E lab | same test |
| Navbar button opens it over the page, Escape and a visit close it | E2E lab | lab.turbo-nav "on a small screen the navbar button opens the sidebar over the page" |
| The app layout at phone width: the sidebar hidden, its navigation in the MobileNav drawer, focused on the current page in its open branch (the drawer's own behavior: mobile-nav below) | E2E demo | demo-app "on a phone the drawer holds the sidebar navigation, then the navbar menu" (R4) |
| Collapsed side-nav moves the Tab stop | E2E demo | lab.side-nav "collapsing the demo's sidebar moves the Tab stop off a hidden current item to its shown branch" |
| Current item after Back and Forward, one controller | E2E lab | lab.turbo-nav "Back and Forward mark the current item of the page shown in the permanent sidebar" (failed with the marking skipped on a restoration visit) |
| Storage blocked: the collapse holds across visits, Back and Forward, a reload expands it | E2E lab | lab.turbo-nav "with localStorage blocked, the sidebar stays collapsed across Turbo visits, Back and Forward, until a reload" (found a bug, fixed: a visit expanded it, the failed read taken for "expanded") |
| Open over the page, then Back and Forward: closed, the menu button collapsed on the copy of the page left open too | E2E lab | lab.turbo-nav "on a small screen, the sidebar open over the page is closed after Back, and after Forward to its page" (found a bug, fixed: Forward showed the button expanded on a closed sidebar) |
| Open over the page, the screen grows to a desktop: closed, the button collapsed; shrunk again, hidden, one click opens it | E2E lab | lab.turbo-nav "the sidebar open over the page closes when the screen grows to a desktop, and opens again with one click" (found a bug, fixed: it stayed open, shown again over the page when the screen shrank) |

### side-nav

States: open branches (saved in `sessionStorage`), the current item, the roving Tab stop, focus.

| Transition | Scope | Covered by |
|---|---|---|
| Tree structure, the current branch rendered open | E2E lab | lab.side-nav "the tree has the ARIA tree structure, and the branch of the current page renders open" |
| Keyboard: arrows, Home, End, type-ahead, Enter | E2E lab | lab.side-nav "the keyboard moves through the shown treeitems, opens and closes branches and follows links" |
| Visits, Back, Forward, reload, state saved after the snapshot | E2E lab | lab.side-nav "the open branches hold across Turbo visits, Back, Forward and a reload, over the cached copy of the page" |
| Fragment links never current | E2E lab | lab.side-nav "a link to a fragment of the page is never the current page" |
| N visits | E2E lab | lab.side-nav "repeated Turbo visits leave one controller on the tree" |
| In a permanent sidebar | E2E demo | lab.side-nav "in the demo's data-turbo-permanent sidebar, the tree follows the current page across visits" |
| Both themes under both systems | E2E lab | lab.side-nav "the tree passes axe, its current item and focus ring in the theme's colors" (4) |
| `sessionStorage` blocked | | G10 |

### mobile-nav, nav-menu

States: mobile-nav's drawer open or closed and the focus it moves; nav-menu's open submenus, their placement, the
current page and its submenus marked.

| Recipe | Transition | Scope | Covered by |
|---|---|---|---|
| mobile-nav | Open as a modal, Escape, backdrop, close button, the focus given back; a link closes and visits, Back, Forward and reload show it closed; links to another tab or a download leave it open; the screen growing closes it | E2E lab | lab.mobile-nav "on a phone" (5 tests) |
| mobile-nav | Back and Forward while open: the cached copy shows it closed; N visits | E2E lab | lab.mobile-nav "Back and Forward while the drawer is open…", "repeated Turbo visits leave one controller on the drawer" |
| mobile-nav | Desktop: the tree beside the page, no id twice | E2E lab | lab.mobile-nav "the menu button is hidden, the tree is beside the page, and no id is used twice" |
| mobile-nav | axe on the open drawer, both themes | E2E lab | lab.mobile-nav "the open drawer passes axe" (2) |
| nav-menu | Buttons and submenus, current page marked, clicks, keyboard, placement and the sticky bar, links and fragments, a disconnected controller | E2E lab | lab.nav-menu "on a desktop" (its first 7 tests) |
| nav-menu | Back, Forward, reload show every submenu closed (cached copies too); permanent navbar; N visits | E2E lab | lab.nav-menu (3 tests) |
| nav-menu | In a MobileNav: submenus open in place, Escape closes a submenu before the drawer, a link closes both | E2E lab | lab.nav-menu "on a phone" (2 tests) |
| nav-menu | axe closed and open, on a desktop and in the drawer, both themes | E2E lab | lab.nav-menu "the menu passes axe…" (2) |
| nav-menu | Server rendering: ids per menu, `aria-controls`, the current link, a rejected scheme | Twig component | `ComponentsTest::testANavMenuRenderedTwiceGivesEachSubmenuItsOwnId` (snapshot) |
| both | A permanent mobile-nav; either beside a frame visit promoted to history (both close on every `turbo:before-cache`) | | G10 |

### toast

States: counting down, paused (hovered, focused), closing, removed; in the permanent region or temporary.

| Transition | Scope | Covered by |
|---|---|---|
| Inserted by a Stream, dismisses itself, focus untouched | E2E lab | lab.turbo-stream-toast "a toast pushed by a Turbo Stream appears, dismisses itself and leaves focus alone" |
| Pause on hover, close button, timeout 0 | E2E lab | lab.turbo-stream-toast "a toast pauses while hovered and closes from its button", "a toast stays paused while it is still hovered or focused" |
| Permanent region across a visit keeps counting | E2E lab | lab.turbo-stream-toast "a toast in the permanent region still dismisses itself after a Turbo visit" |
| Temporary toast not shown again on Back | E2E lab | lab.turbo-restore "a toast outside the permanent region is not shown again on Back" |
| Moved into the region | E2E lab | lab.turbo-restore "a toast moved into the permanent region stays across visits" |
| Flash written as a Stream shows once | E2E lab | lab.turbo-nav "a flash toast written as a Turbo Stream shows once across Turbo visits" |
| A toast outside the region while a frame visit is promoted to history: stays on screen; Back and Forward do not show it, from their first frame (failed before the fix: Turbo removed it from the screen on `turbo:before-cache` and Back showed the copy's) | E2E lab | lab.turbo-restore "a toast outside the permanent region stays shown while a frame visit is promoted to history…" |
| Closed under reduced motion: leaves the DOM within the click, no fade waited for; closed without a preference: leaves after its fade | E2E demo | motion "under reduced motion a closed toast leaves the DOM at once…", "a toast closed with … motion leaves the DOM" (2) |

### alert, avatar

| Recipe | State or transition | Scope | Covered by |
|---|---|---|---|
| alert | Close by click, by keyboard, each independently | E2E demo, screenshot | recipe:alert "dismisses each alert independently", "dismisses an alert with the keyboard"; shot:alert "hides an alert when its close button is clicked" |
| alert | Dismissed under reduced motion: hidden within the click, no fade; with either preference it ends hidden | E2E demo | motion "under reduced motion an alert hides at once…", "an alert dismissed with … motion is hidden" (2) |
| alert | Dismissed, then Back; inserted by a Stream; Live re-render | | G10 |
| avatar | Image loaded, loaded before connect, failed, a new image failing | E2E demo | avatar (4 tests) |
| avatar | Turbo visit and Back | E2E lab | avatar "shows the picture of a page reached by a Turbo visit or restored from its cache" |

Avatar's Stream, frame and Live cells are `·`: they only connect a new element, the path "shows an image that loaded
before the controller connected" covers.

### tabs

States: the selected tab and its panel (`data-tabs-active-tab-value`), a disabled tab, a list without panels.

| Transition | Scope | Covered by |
|---|---|---|
| Default tab on load; click; Enter and Space; disabled out of reach; list without panels | E2E demo | recipe:tabs (5 tests) |
| Click, horizontal, pills, vertical | screenshot | shot:tabs (3 × 2 themes) |
| Arrow keys of the list's orientation, Home, End, roving Tab stop, disabled skipped, `aria-orientation` | E2E lab, preview | lab.section-nav "the vertical tabs follow the keyboard of the tabs pattern…", "horizontal tabs take Left and Right instead…" |
| Selected tab after Back (kept: the value attribute is in the cached copy), default after a visit or reload | E2E lab | lab.section-nav "Turbo visits, Back, Forward and a reload show the section and the tab of the page shown" |
| N visits: one controller per tab list | E2E lab | lab.section-nav "repeated Turbo visits leave one controller per navigation and tab list" |
| The selected tab removed: another tab is the Tab stop; the controller disconnected: the rendered tabindex is back | E2E preview | lab.section-nav "horizontal tabs take Left and Right instead…" |
| Tab moves on to the panel (a Tab stop), plain-text panels included; the selected tab disabled in place hands the selection and the Tab stop on | E2E lab, preview | lab.section-nav "the vertical tabs follow the keyboard…", "a panel with no focusable content is a Tab stop after its tab" |
| Live re-render with a tab selected by the browser: the tab and the focus kept (owner decision 6b: open UI and focus kept) | E2E lab | lab.value-matrix |
| Frame reload, Stream replace and update: the tab list inside starts from `defaultValue`, one beside keeps its tab; inside a `data-turbo-permanent` element it keeps its tab across a visit and Back | E2E lab | lab.value-matrix |

### section-nav

States: the current section (`aria-current="page"`, from the server or the URL), the strip's scroll on small screens.

| Transition | Scope | Covered by |
|---|---|---|
| A landmark of links, the current one marked, no tab roles, in each viewport | E2E lab | lab.section-nav "the section nav is a landmark of links…" (2) |
| Server rendering: the landmark's name, one link per item, `route` against the current route, `active` overriding it either way, only an item with neither left to the controller (`data-section-nav-match-url`), a rejected scheme rendered `#`, an unknown orientation responsive | Twig component | `ComponentsTest::testASectionNavIsANavigationListOfLinksMarkingTheCurrentSection` (snapshot) |
| Visit, Back over the cached copy, Forward, reload; in a permanent element, marked from the URL | E2E lab | lab.section-nav "Turbo visits, Back, Forward and a reload…" (2) |
| A fragment link never current | E2E lab | lab.section-nav "a link to a fragment of the page is never the current section" (2) |
| N visits | E2E lab | lab.section-nav "repeated Turbo visits leave one controller per navigation and tab list" (2) |
| Disconnected: the rendered current state is back | E2E lab | lab.section-nav "a controller disconnected from a navigation that stays…" |
| Plain links in the Tab order, Enter visits | E2E lab | lab.section-nav "the section nav is plain links in the Tab order…" |
| A strip that scrolls to the current section on phones, a column on desktops | E2E lab | lab.section-nav (2) |
| The demo's settings pages | E2E demo | lab.section-nav "the demo's settings pages mark their section on the server and visit each other" |
| axe, both themes × systems × viewports | E2E lab | lab.section-nav (8) |

### dropdown, modal, drawer (overlays)

States: dropdown closed or open (click, hover), focused item, open submenu, placement flipped or shifted; modal and
drawer closed, open as a modal, open on load, static backdrop, drawer non-modal; `aria-expanded` on the triggers.

| Recipe | State or transition | Scope | Covered by |
|---|---|---|---|
| dropdown | Click on trigger closes; ArrowDown opens, Escape closes | E2E demo | recipe:dropdown "closes on a click on its trigger", "opens with ArrowDown and closes with Escape" |
| dropdown | Hover opens | screenshot | shot:dropdown "opens on hover" |
| dropdown | Click outside closes | E2E lab | lab.turbo-restore "a dropdown menu whose item steps a frame promoted to history…" (last steps) |
| dropdown | Home, End, the arrows wrapping, ArrowUp on the trigger | E2E demo | dropdown "Home and End move to the first and last item…" (failed with Home removed) |
| dropdown | Tab and Shift+Tab close the menu and move on from the trigger | E2E demo | dropdown "Tab and Shift+Tab from an item close the menu…" (failed with the Tab case removed) |
| dropdown | Submenus: ArrowRight and Enter open one on its first item, its arrows and End stay in it, ArrowLeft and Escape close it only, back on its item; ArrowRight on one already open by a click moves into it | E2E demo | dropdown "a submenu opens with ArrowRight on its item…", "ArrowRight on the item of a submenu already open by a click…" (found a bug, fixed: ArrowRight left the focus on the item, and closed a submenu already open; the ArrowLeft part failed with it removed) |
| dropdown | Flip when it does not fit; shift back into the viewport along the trigger, at either edge; following the trigger in a scrolling box | E2E demo | dropdown "the menu flips above its trigger…", "a menu wider than the room beside its trigger is shifted…", "the menu follows its trigger when a scrolling box around them scrolls" (each failed with the flip, the shift or the scroll listener removed; a scroll of the window moves the menu with the page on its own, so the box is what tells) |
| dropdown | Live re-render while open; rows re-sorted | E2E lab | lab.value-matrix "a dropdown left open › live" (open, one controller, its trigger closes it once, Escape gives the focus back); lab.live-table "dropdowns in rows re-sorted by a Live action keep working" |
| dropdown | Frame reloaded | E2E lab | lab.turbo-frame-detail "a dropdown inside a Turbo Frame works after every frame reload" |
| dropdown | Open beside a frame visit promoted to history (its own item targets the frame): stays open, Escape closes it; Back shows it closed from the first frame and it opens again. The copy holds it open with `aria-expanded="true"` until it connects | E2E lab | lab.turbo-restore "a dropdown menu whose item steps a frame promoted to history…" |
| dropdown, modal, drawer | Left open by a visit, Back, fast and slow | E2E lab | lab.turbo-restore "… left open by a visit is closed after Back, and opens again[, the next page waiting for a stylesheet]" (6) |
| modal | Closed until opened; Escape; close buttons; backdrop; static backdrop; several openings; open on load | E2E demo | recipe:modal (8 tests) |
| modal | Moved in the DOM, open and closed | screenshot | shot:modal "stays modal after being moved in the DOM", "stays closed after being moved in the DOM once closed" |
| modal | Live re-render, open and closed | E2E lab | lab.value-matrix "a modal left open › live" (open and modal, Escape closes it, the focus back on the trigger); closed across a re-render: lab.live-modal "a modal whose container a Live re-render replaces…" (closed part) |
| modal | Live re-render replacing its container, open and closed: no error, the new one opens and closes | E2E lab | lab.live-modal "a modal whose container a Live re-render replaces is torn down cleanly…" |
| modal | Opened and closed with and without reduced motion: the trigger's `aria-expanded` and the dialog's `aria-hidden` follow (the controller waits for a `transitionend` only while the dialog has a running transition) | E2E demo | motion "a modal opened and closed with … motion updates its trigger and hides" (2) |
| modal | The backdrop's transition runs, twice over: a `transitionrun` on the `::backdrop` as the dialog opens (Chromium, WebKit) and as it closes, the dialog still open and `data-closing` within the click, closed after the fade (Chromium; WebKit and Firefox close within the click); then hidden, `aria-*` updated, the focus back on the trigger, no `data-closing` left; under reduced motion no backdrop transition and the dialog closed within the click (failed before the fix: no backdrop transition ran in Chromium or WebKit) | E2E demo | motion "the modal backdrop fades in as the dialog opens and out before it closes", "under reduced motion the modal backdrop does not fade, and the dialog closes at once" (2) |
| drawer | Modal: Live re-render (still `:modal`, the page behind inert), Escape, the focus back on the trigger | E2E lab | lab.value-matrix "a drawer left open › live" |
| drawer | Non-modal; a re-render replacing its container, open and closed: no error, the new one opens and closes | E2E lab | lab.live-drawer (2 tests) |
| drawer | Open on load as a modal; backdrop click, not a click on its content; its close button and `Drawer:Close`; moved in the DOM open (still `:modal`) and closed (still closed, though rendered open) | E2E demo | recipe:drawer (5 tests; each failed with its fault planted: the `open` value ignored, the backdrop or every click ignored or closing, the close action emptied, the open state not kept or the `open` value preferred on reconnect). An open drawer moved by Turbo in a `data-turbo-permanent` element: lab.value-matrix |
| all three | The copy Turbo renders on Back and Forward, and on Back after a visit started by the page with the next page waiting for a stylesheet: closed, trigger not `aria-expanded="true"` (recorded from `turbo:before-render`); closed and working once connected | E2E lab | lab.overlays "left open by Back, Forward or a visit from the page, every copy Turbo renders shows it closed" (3) |
| all three | N visits from a link inside the open overlay: one Stimulus controller per element, no `document` or `window` listener left, one toggle per click | E2E lab | lab.overlays "repeated Turbo visits from inside the open overlay leave one controller per element…" (3) |
| all three | Inside a `data-turbo-permanent` element, open during a visit: it comes back open (owner decision 6b: permanent, all kept), a dialog modal, its trigger expanded; it works on both pages. The menu came back closed before (it closed on `turbo:before-cache` and as it reconnected); a visit started by the page keeps it open now | E2E lab | lab.value-matrix "… left open › permanent" (3; R8: replaced lab.overlays "inside a data-turbo-permanent element, it keeps working across visits") |
| all three | Frame reloaded three times from a link inside the open overlay: the new one closed, nothing left modal, one controller per element, no listener left | E2E lab | lab.overlays "inside a Turbo Frame reloaded three times…" (3) |
| all three | Stream replace and update, twice each, while open: the new one closed and working, nothing left modal, one controller, no listener left | E2E lab | lab.overlays "replaced or updated by a Turbo Stream while open…" (3) |
| all three | Counts (tier 2): opening and closing make no request and connect no controller; an open dropdown adds the outside click and the scroll and resize listeners and closing removes them, a dialog adds none | E2E lab | counts "<recipe>: opening and closing make no request and leave no listener" (3) |
| dropdown (and popover, tooltip) | Placed by the `floating` recipe's module, which `ux:install` brings with each of them: every relative import in a recipe's JavaScript names a file the recipe or its recipe dependencies (at any depth) install, which the kit lint does not check and the demo, holding every recipe, cannot show | unit | `tools/tests/recipe-imports.test.mjs` (`tools/recipe-imports.mjs`; red with `floating` removed from `tooltip/manifest.json`'s `dependencies.recipe`) |
| all recipes' JavaScript | One place for shared logic: no run of 40 tokens or more copied beyond the budget (36 duplicated lines, from 100 before the `turbo` and `navigation` modules), and no recipe declaring a name a shared module exports (`isPromotedFrameCache`); the recipes moved onto `turbo` and `navigation` behave as before (their specs unchanged) | unit | `tools/tests/js-duplication.test.mjs` (`tools/js-duplication.mjs`; red with the old `sidebar` and `side-nav` current-item copies restored, and with `isPromotedFrameCache` declared again in `popover_controller.js`) |
| dropdown, tooltip | Counts (tier 2): a Live action re-sorting rows makes one request and disconnects and connects each moved row's dropdown and tooltip once, leaving no listener | E2E lab | counts "a Live action re-sorting rows makes one request…" |
| all three | Open beside a frame visit promoted to history, started from a link inside it or from the page's code: stays open (a dialog still modal), its trigger expanded, the focus where it was; Back and Forward show it closed from the first frame, and it works (failed before the fix: each closed on `turbo:before-cache`) | E2E lab | lab.overlays "open while a link inside it / the page's code steps a frame promoted to history…" (6) |
| all three | Open while the theme switches | | T3 (wide matrices) |

### popover

States: closed or open (`open` value, an attribute Live keeps), focus inside, group, placement flipped.

| Transition | Scope | Covered by |
|---|---|---|
| Toggle, focus first field, Escape, click outside, group, flip, form, hidden controls, canceled `popover:focus` | E2E demo | popover (6 tests) |
| Focus leaving closes | E2E lab | lab.popover "the focus leaving the popover closes it" |
| Open, visit, Back: closed, its listeners gone, opened again | E2E lab | lab.value-matrix "a popover left open › back" |
| N visits, one Stimulus controller per element, no document or window listener left | E2E lab | lab.popover "repeated Turbo visits leave one controller per popover and no document or window listener behind" |
| Frame ×3 | E2E lab | lab.popover "inside a Turbo Frame reloaded three times, the popover works" |
| Permanent, Stream replace and update, Live re-render (open, the focus kept), no listener left by the one replaced | E2E lab | lab.value-matrix "a popover left open › permanent, stream-replace, stream-update, live" |
| Open beside a frame visit promoted to history, started from a link inside it or from the page's code: stays open with the focus; Back and Forward show it closed from the first frame, no listener left (failed before the fix: it closed, the focus fell to `<body>`, Back showed it open) | E2E lab | lab.popover "a popover whose link steps a frame promoted to history…" (the first frame), lab.value-matrix "a popover left open › frame-advance" (the page's code: the focus kept, closed on Back and Forward, its listeners gone), lab.popover "turbo:before-cache closes an open popover before a Turbo visit copies the page, and not when…", "a popover rendered open beside a frame visit promoted to history…" |
| Opened, then moved in the DOM (the same controller reconnects): stays open, one Stimulus controller per element, one set of listeners | E2E lab | lab.popover "a popover opened by the user and moved in the DOM stays open…" |
| Open inside a `data-turbo-permanent` element during a visit started by the page: stays open on the next page and after Back (failed before the fix: it closed on `turbo:before-cache`) | E2E lab | lab.value-matrix |

The editor's link dialog is a Popover: its cells are the popover's.

### tooltip

States: hidden or shown (hovered, focused), placement flipped, the trigger's `aria-describedby`.

| Transition | Scope | Covered by |
|---|---|---|
| Hover, focus, Escape, described, after Live re-sorts | E2E lab | lab.live-table "tooltips in rows re-sorted by a Live action keep working and stay described" |
| Flip below | E2E lab | lab.live-table "a tooltip that does not fit above its trigger opens below it" |
| Stays open while hovered or focused | E2E lab | lab.live-table "a tooltip stays open while its trigger is still hovered or focused" |
| Shown when its trigger visits, then Back, fast and slow: hidden, and shows again (both orders failed before the fix) | E2E lab | lab.turbo-restore (overlay table) |
| Shown by focus, then Back, Forward, reload: hidden; hover, leave, focus, Escape, described still work | E2E lab | lab.tooltip |
| N visits: one tooltip per trigger, no document or window listener left | E2E lab | lab.tooltip |
| Permanent: shown by focus stays shown through a visit; frame reload ×3; frame advance then Back; Stream replace and update | E2E lab | lab.tooltip |
| System theme change while shown | E2E lab | lab.tooltip |

### calendar, date-picker

States: displayed month, selection (single, multiple, range, partial range), focused day, bounds, disabled dates,
modifiers, locale; the picker closed or open, typed text valid or invalid.

| Recipe | Transition | Scope | Covered by |
|---|---|---|---|
| calendar | Keys, month and year dropdowns and their bounds, modifiers gone in a re-render, impossible dates, form submit, one input and one change per pick, ranges over disabled days, multiple mode inputs | E2E demo | calendar (11 tests) |
| calendar | The month and year menus readable whatever the system scheme: system dark with the light theme chosen and the reverse, the page and the preview `<html>` and both selects compute the chosen `color-scheme`, the options keep >= 4.5:1 against the native menu | E2E demo | calendar "system … theme chosen › the month and year options are readable…" (2; failed before the fix: `colorScheme` "normal", options white on white in the dark case) |
| calendar | A form reset cancelled by another listener (a capture listener on `form.reset()` and the reset button, a listener after the calendar's on the button) leaves the selection; the next reset brings back the date rendered with `calendar:select` source `reset`; a calendar disconnected while its reset waits does nothing | E2E demo | calendar "a reset another listener cancels leaves the selection…" (failed before the deferred reset: the cancelled reset brought back 2026-03-10) |
| calendar | Back in a GET form shows the URL's month and selection, not the pick made before (`form-reset`); N visits; permanent (the month kept); frame ×3; Live props, bounds, locale, clear | E2E lab | lab.calendar (5 tests) |
| calendar | Stream replace and update: the new calendar fresh, one controller, a pick works | E2E lab | lab.value-matrix "a calendar in a GET form › stream-replace, stream-update" |
| date-picker | Trigger, pick, typed dates, invalid text, ArrowDown, range | E2E demo | date-picker (3 tests) |
| date-picker | Form submit; N visits; permanent and frame ×3; Live form | E2E lab | lab.date-picker (4 tests) |
| date-picker | Back in a GET form (the URL's date, closed, not the pick, a pick works once); Stream replace and update | E2E lab | lab.value-matrix "a date picker in a GET form › back, stream-replace, stream-update" (one `date-picker` and one `calendar` controller per element) |
| date-picker | Server refusal comes back as typed | E2E demo | forms "the date picker opt-in submits the pick; a date the server refuses comes back as typed, with its error" |
| date-picker | Open during a real Live re-render that moves its bounds (the server's start moves the end's earliest day): the same dialog, open, the focus on the day it had, its date kept in the field, the hidden input and the calendar, the new bounds; keys and a pick still work, one change (failed with the documented rule broken, an `id` that changes per render: the dialog gone) | E2E lab | lab.date-picker "a date picker open during a Live re-render stays the same open dialog…" |
| date-picker | Open beside a frame visit promoted to history (the page's code): stays open on its day; Back shows it closed with the URL's date (its GET form), not the pick of the copy; the frame's own link closes it first (failed before the fix like popover) | E2E lab | lab.date-picker "a date picker open while the page code steps a frame promoted to history…" |
| date-picker | Counts (tier 2): opening and a pick make no request and connect no controller; opening adds the popover's outside click, scroll and resize listeners, the pick removes them | E2E lab | counts "date-picker: opening and picking a date…" |
| calendar | Beside a frame visit promoted to history (GET form, the URL holding a date): the month and pick left stay; Back and Forward show the URL's month and date (6a), one controller each; arrows, Enter and a click pick once, the month buttons move one month (failed with `form-reset` broken: April shown) | E2E lab | lab.calendar "beside a frame visit promoted to history…"; lab.value-matrix (`frame-advance`) |

### chart

States: series colors per theme, server colors kept, data, the data table, reduced motion.

| Transition | Scope | Covered by |
|---|---|---|
| Named image with its data table, roles per theme, `var(--color-…)`, reduced motion, doughnut, visible table | E2E demo | chart (5 tests) |
| Back, N visits, theme switch redraws once, permanent follows the theme, server color through switches, frame ×3, Stream, Live data | E2E lab | lab.chart (7 tests) |
| Value blocks, point data | E2E lab | lab.chart (2 tests) |
| Beside a frame visit promoted to history, the theme switched on the new entry: Back and Forward draw one chart per canvas, none left, each with the data of its copy (the framed one its load's) in the current theme, the server's color kept; a switch then redraws each once (failed with the chart's `configure` broken: light colors) | E2E lab | lab.chart "beside a frame visit promoted to history…" |
| System theme change with no choice saved | | G10 (same path as the class change, observed by the controller) |

### dropzone

States: empty, one or several files picked, dragging, invalid, disabled; focus after a pick or a Remove.

| Transition | Scope | Covered by |
|---|---|---|
| Keyboard, picks, previews, several files, drag, invalid, disabled | E2E demo, screenshot | dropzone (6 tests); shot:dropzone (3 × 2 themes) |
| Back (empty), N visits, Back keeps every file of a POST form's single-file zones (11 zones, more than the copies Turbo keeps), frame multipart post 303 and 422, Stream, controllers passed in, Turbo form beside a Live re-render, Live files action | E2E lab | lab.dropzone (8 tests) |
| A zone in a `data-turbo-permanent` element keeps its file; its Remove button empties it and focuses the input | E2E lab | lab.value-matrix "a dropzone in a POST form › permanent" |
| Rendered through the form theme, server refusal, files sent back, a valid submit, size limit | E2E demo | forms (5 dropzone tests) |
| One file in a POST form after Back and Forward: still picked, shown and in the input (failed before the fix: UX Dropzone clears the copy's input as it connects) | E2E lab | lab.value-matrix |
| Beside a frame visit promoted to history (Turbo copies the page as the visit starts, before `turbo:before-cache`): Back and Forward keep the files of a POST form's single-file zones and the permanent zone's, the zone outside a form starts empty, the list of several files shows what its input holds; the zones still take a pick and a Remove (failed before the fix: the POST zones empty) | E2E lab | lab.dropzone "beside a frame visit promoted to history…"; lab.value-matrix (`frame-advance`) |

### editor, markdown-editor

States: content, selection, toolbar states, counter, read-only; markdown's Write or Preview tab and its draft.

| Recipe | Transition | Scope | Covered by |
|---|---|---|---|
| editor | Mount, toolbar keys and states, commands, links, paste, counter, read-only, axe | E2E demo | editor (8 tests) |
| editor | Form post 422; Back (content and selection); N visits; frame ×3; Live (typing kept, focused re-render) | E2E lab | lab.editor (6 tests) |
| editor | Permanent, Stream replace and update, frame advance: the content as the policy says, one editor and toolbar, typing reaches the form | E2E lab | lab.value-matrix "an editor in a POST form"; typing after the frame step, kept out of the copy Back shows: lab.editor "a frame visit promoted to history leaves the editor beside the frame working…" |
| editor | Counts (tier 2): typing makes no request, connects no controller and adds no listener | E2E lab | counts "editor: typing makes no request…" |
| markdown-editor | Preview through Live, unsafe Markdown, toolbar, tab keys, counter, read-only, axe | E2E demo | markdown-editor (7 tests) |
| markdown-editor | Form post 422; N visits; frame ×3 | E2E lab | lab.markdown-editor (3 tests) |
| markdown-editor | Back, permanent, Stream replace and update, frame advance: the typing as the policy says, one editor, its preview renders it | E2E lab | lab.value-matrix "a markdown editor in a POST form" |
| editor | Server policy (`EditorHtmlPolicy`): the preset kept, everything else removed, white space alone next to a block's tag removed (space between inline tags kept), the same output twice; its text counted as the editor's counter does (a line break one, lines between blocks none) | unit | `EditorHtmlPolicyTest` (moved from hostile-props "the editor's policy keeps the preset…"); the Editor given a hostile value, parsed by the browser: hostile-props |
| markdown-editor | Server renderer (`MarkdownRenderer`): Markdown kept, raw HTML and images stripped, unsafe links refused, nesting limited, long HTML whole | unit | `MarkdownRendererTest` (moved from hostile-props "the Markdown renderer keeps what Markdown makes…"); the MarkdownEditor given a hostile value, parsed by the browser: hostile-props |
| editor | `EditorType` limits: `max_bytes` counts the bytes sent, before sanitizing; `max_chars` the characters of the sanitized text, an entity as one; no text is null; a refused submit keeps what was sent (over the policy's input limit too: 422 with the error) | form type; functional | `EditorTypeTest` (lines between blocks are no characters; a submit over `EditorHtmlPolicy::MAX_INPUT_BYTES` is a 422 with its error) |
| editor | The Editor in a Live Component (lab's LiveEditor): a body over `EditorHtmlPolicy::MAX_INPUT_BYTES` re-renders with the editor and its textarea empty, the longest it reads is shown whole | Live component | `LiveEditorTest` |
| markdown-editor | `MarkdownType` limits: Windows line breaks made `\n` and counted as one, bytes and characters, blank is null, a refused submit keeps what was sent (over the renderer's input limit too: 422 with the error) | form type; functional | `MarkdownTypeTest` |
| markdown-editor | The counter counts as `MarkdownType` and the browser do (a Windows line break one, a character beyond the BMP one), marked over the limit; the Preview of Markdown too long to render says so, the longest it reads renders | Live component | `MarkdownEditorTest` |

### autocomplete

States: chosen values (one, several, remote, created), the Tom Select instance, invalid, the values a form reset puts back.

| Transition | Scope | Covered by |
|---|---|---|
| Form submit, invalid submit enhanced once, created value | E2E lab | lab.autocomplete (3 tests) |
| Visits away and Back leave one Tom Select per field | E2E lab | lab.autocomplete "Turbo visits away and Back leave one working Tom Select per field" |
| Chosen values after Back: a GET form shows the URL's choice in the `<select>` and Tom Select's item, a POST form (the lab's Symfony form) the choice left | E2E lab | lab.form-back (its autocomplete tests) |
| Frame reload, Stream: enhanced once, a pick works | E2E lab | lab.value-matrix "an autocomplete in a GET form", "… in a POST form" (`frame-inside`, `stream-replace`, `stream-update`) |
| Live re-render keeps the chosen values (one and several), one Tom Select per field | E2E lab | lab.autocomplete "in a Live form, a re-render keeps the chosen values…" |
| A reset of the field's form (reset button, `form.reset()`) puts back the values rendered in the `<select>`, the form's data and Tom Select's items: one and several choices, the form theme's fields and `Autocomplete`, a field tied by `form="…"` outside its form; with and without the layouts' `form-reset` on `<body>` (`?bare=1`); no `input` or `change` | E2E lab | lab.autocomplete "…a reset button puts back the values rendered…" (×2 compositions; failed without `autocomplete-sync`'s reset listener: Japan shown, France expected) |
| A reset cancelled in a capture listener changes nothing; the next one, from `form.reset()`, puts back the values | E2E lab | lab.autocomplete "…a reset cancelled in a capture listener…" (×2; failed without `autocomplete-sync`'s reset listener on the real reset; the cancelled part cannot fail with a sync, which mirrors the `<select>`) |
| A reset syncs the current Tom Select once: none after the controller disconnects (also for a reset pending then), once after it reconnects, once on the Tom Select UX Autocomplete rebuilds when an option is added | E2E lab | lab.autocomplete "a reset syncs the current Tom Select once…" (failed without `autocomplete-sync`'s reset listener: Fish shown, Dog expected) |
| In a Live form, a reset shows the default in Tom Select, with no event and no Live request | E2E lab | lab.autocomplete "in a Live form, a reset shows…" (failed without `autocomplete-sync`'s reset listener: Tom Select kept Germany) |
| Permanent: the choice kept across a visit and Back | E2E lab | lab.value-matrix |
| A choice the server sets in a Live re-render shows in Tom Select (failed before the fix: the `<select>` held the server's value, Tom Select still showed the user's) | E2E lab | lab.value-matrix |
| Beside a frame visit promoted to history, then Back and Forward: one Tom Select, on screen, with the URL's choice (GET) or the one left (POST) in the `<select>` and its item; a GET field takes a pick again (failed before the fix: the Tom Select of Turbo's copy, taken as the visit started, left beside a new one hidden like the `<select>`) | E2E lab | lab.value-matrix (`frame-advance`) |

### data-table, data-table-live

States: search, filter, sort and direction, page, page size (in the URL); data-table-live adds the selection.

| Guarantee | Scope | Covered by |
|---|---|---|
| Each change adds a history entry; Back and Forward walk them, every control showing the URL's state | E2E lab | lab.data-table-frame "search, filter, sort, page and page size each add a history entry that Back and Forward walk through": each step and each Back and Forward waits for its Turbo completion (`turboOperation`), then checks the URL, the rows, the search, filter and page size fields, the sort and the current page. Was flaky (2/30 runs failed with 1 worker, 6/30 with 3): it went Back once the URL changed, before the promoted page visit, which then rendered the page size 25 under the size 10 URL and aborted the restoration's request. Without the data-table controller's reset, the third Back showed the search typed before it (`bonnie` with no `q`) |
| After a change and Back, then Forward, the URL, the rows and every control agree (the same as a fresh load of the URL) | E2E lab | lab.data-table-interrupt "control, …" (page size, search, filter, page link); search failed until the `data-table` controller reset the form (Turbo 8.0.23's copy restored on Back keeps the typed search text) |
| Back during a change, at each phase of the promoted frame visit (request out; history changed, frame not rendered; frame rendered, `turbo:load` not yet): the URL, the rows and every control agree, also after Forward and Back, and the table takes the next change. Losing the change is accepted | E2E lab | lab.data-table-interrupt (3 phases × page size, search, filter, page link). Turbo 8.0.23 defects, worked around by the `data-table` controller on the frame (`docs/NOTES.md`), their `test.fail` marks removed: before the response, a form's response outlived Back and pushed its URL over the restored rows (the submission is now stopped); a link's pending `src` was cached on Back and loaded by Forward at the wrong URL (removed before caching); history changed, a link's resumed render threw an uncaught AbortError (a detached frame loses its `src`); frame rendered, the search text kept (the form is reset) |
| Back after a form change does not leave the frame or its form `aria-busy`, nor the Apply button disabled | E2E lab | lab.data-table-interrupt "Back after a form change restores the table not marked busy" (its `test.fail` removed: Turbo 8.0.23 copies the page while the frame is busy, the `data-table` controller clears the marks as the copy connects) |
| Visits away and back keep one table | E2E lab | lab.data-table-frame "Turbo visits away and back keep a single working table"; lab.data-table-live "repeated Turbo visits away and back keep one working table" |
| URL state survives a visit and Back, still live | E2E lab | lab.value-matrix "a Live data table page (data-table-live, in the URL) › back" (its pager works after); lab.data-table-live "its state is in the URL: a Turbo visit away and Back show the same rows…" (the sort too: `aria-sort` and the first row after Back) |
| After Back or Forward every field of the form shows the URL's state (search, filter, page size), from the first frame of the restored copy: never the state applied next, nor edits left unapplied | E2E lab | lab.data-table-back (4 tests: each field applied then Back and Forward, all fields twice); edits left unapplied: lab.value-matrix "a data table form edited and not applied (data-table) › back, forward" |
| data-table-live: Back shows the URL's state in every field, not a search typed and not sent before leaving | E2E lab | lab.data-table-back "data-table-live: Back to the table shows the URL's state in every control…" |
| Search, filter, size go to page 1; selection across pages | E2E lab | lab.data-table-live (2 tests) |
| Frame, permanent, Stream | E2E lab | lab.value-matrix "a Live data table page …" and "… selection" (`frame-inside`, `permanent`, `stream-replace`, `stream-update`; live again after each, the same document) |
| Selection after a visit and Back or Forward, and a visit away and back: none (owner decision 6b: it resets on leaving); kept in a `data-turbo-permanent` element and beside a frame or a Stream; cleared by the server in a re-render. Back and Forward showed it again from Turbo's copy when the page had been opened at the URL its Live Component writes (opened at another, Back missed the cache and loaded the page anew) | E2E lab | lab.value-matrix |
| Unaccepted URL values give a valid table (the last page, the default sort, page size and filter), and the Live one stays live, writing the accepted values to the URL | functional; Live component; E2E lab | `DataTableRequestsTest::testAUrlWithValuesTheTableDoesNotAcceptRendersAValidTable` (frame and Live); `OrdersTableTest::testAPageSizeTheTableDoesNotOfferFallsBackToTheFirst`, `testOnlyTheSortableColumnsSort`; lab.data-table-live "a URL with values the table does not accept renders a table that stays live" (R3) |
| A deep page keeps the offset below `maxRows()` | unit | `TableQueryTest` (its 4 `maxRows()` tests), `FetchTest::testADeepPageInALargeTableCountsOnceAndLoadsOnce` |
| Untrusted values checked: the search trimmed, then cut to 100 characters (not bytes); a value of the wrong type falls back to the default; a filter value is one of its choices, as a string, in the table's order; the sort is a sortable column mapped to its server field; without one, the default sort in the default direction | unit | `TableQueryTest` |
| A prefixed table reads only its own parameters and shows the defaults when the prefix holds a string; the id of an array row, an object row with `getId()` or a public `id`, and the error saying to override `rowId()` | unit | `AbstractDataTableTest` (with `Fixtures/ProductsTable`, an extension with a server sort field, numeric filter choices, a default sort and a prefix) |
| The page window at the first, last and capped pages, and for every page of 1 to 30 pages (the ends and the current page linked, in order, no adjacent gaps); URLs keep the other tables' and the page's parameters, encoded as RFC 3986; the search form's hidden fields, prefixed and nested | unit | `DataTableViewTest` |
| A page past the end shows the last page, loaded once | unit; functional; Live component; E2E lab | `FetchTest::testAPagePastTheEndLoadsTheLastPageOnce`; `DataTableRequestsTest::testAPagePastTheEndLoadsOnlyTheLastPage`; `OrdersTableTest::testAPagePastTheEndShowsTheLastPage`; `DataTableRequestsTest::testAPageNumberTooLargeForAnOffsetShowsTheLastPage` (R3) |
| No matching row: no load, empty state | unit; functional | `FetchTest::testNoMatchingRowLoadsNoRows`; `DataTableRequestsTest::testASearchMatchingNothingShowsTheEmptyState` (R3) |
| One count, one load per request; a Live action's page not read again | functional | `DataTableRequestsTest` (its first 4 tests) |
| Counts (tier 2): sort, page and filter each make one request (the frame's, or the Live action's), connect no controller and leave no listener, their responses under a budget | E2E lab | counts "data-table in a Turbo Frame: …", "data-table-live: …" |
| Selection cut to `maxSelection` (the first entries read, then cleaned), ids cleaned, "Select this page" bounded; a full selection offers no row more until cleared | unit; Live component | `SelectionTest` (6 tests); `OrdersTableTest` (4 tests) (R2) |
| Stable row ids, cell blocks | E2E lab | lab.data-table-frame "rows have stable ids and render the page cell blocks" |

### motion (every recipe that moves)

States: no preference or `prefers-reduced-motion: reduce`. Each transition names its properties and stops under
reduced motion; an animation that is the content runs three times slower there.

| Recipe | State or transition | Scope | Covered by |
|---|---|---|---|
| tabs, toggle, sidebar, nav-menu, side-nav, table, toast, modal | Without a preference: the computed `transition-property` holds what the part animates (tabs: colors; toggle knob `::after`: `translate`, `border-color`; sidebar: `width`; chevrons: transforms; table rows: colors; toast: `opacity`; modal `::backdrop`: colors) and no other layout property; under reduced motion it is `none` (failed before the change for each, the sidebar's and the chevrons' under reduce only) | E2E demo | motion "…: animates only what it names, and nothing under reduced motion" (11) |
| tabs | No `all`, no layout property, a non-zero duration (the `transition-all` axe raced: `expectA11y` waits for running finite animations) | E2E demo | motion "a tabs trigger animates its colors only…" |
| spinner, skeleton | `animation-duration` 1 s and 2 s, 3 s and 6 s under reduced motion; every animated element of their previews, a README example's own `animate-*` class included | E2E demo | motion "the spinner and the skeleton pulse run three times slower under reduced motion", "every animation in … is slowed under reduced motion" (5 previews) |
| alert, toast, modal | Hide, removal and `aria-*` updates complete under reduced motion | E2E demo | motion (rows of alert, toast, modal above) |
| all | Screenshots are taken under reduced motion with animations disabled: the end states | screenshot | shot:tabs, shot:alert |

## Rules and their tests

The rules of [`FOR-AGENTS.md`](../FOR-AGENTS.md)'s *Working well*, each keyed by its bold lead-in exactly as written
there, with the tests that enforce them. `FOR-AGENTS.md` is read in projects using the kit, so the mapping lives here,
not beside the rules. The rules are for a project's own code: a test here holds the kit's docs, demo and recipes to
the rule, or checks what the rule relies on, and its note says which part. `advice` marks a rule no test can hold, with
the reason; `gap` one that is testable and untested, with what a test would assert (and its row in the gaps below).
`node tools/test-inventory.mjs` fails when a rule has no row, a row names a rule that is gone, a row names no test and
is neither, or a test it names does not exist. [`PROJECT-AGENTS-SNIPPET.md`](PROJECT-AGENTS-SNIPPET.md) words most
of the same rules for a project's `AGENTS.md`; these rows cover its wording too.

| Rule | Tests | What they establish |
|---|---|---|
| Install a recipe, never write raw Flowbite HTML | `tools/docs-lint.mjs` | Part: no markdown teaches Flowbite's JavaScript (`initFlowbite`, `import 'flowbite'`, a `flowbite.js` file). Raw Flowbite HTML written for something the kit has is a project's markup, which no kit test sees |
| Colors through the theme's roles only | `tools/docs-lint.mjs`, `tools/contrast/check.mjs` | Yes for the kit: no markdown (code blocks, prose outside inline code) shows a palette color or a `dark:` color override, and no line of a recipe's templates (`<recipe>/templates/**/*.twig`) uses a palette color, `text-white` included: text on a solid fill uses its `fg-on-*` role, which the contrast check certifies on its fills. Not covered: a `dark:` override in a template, and class strings built in a controller |
| Icons from UX Icons' `flowbite` set | `tools/icon-lint.mjs` | Every `<twig:ux:icon>` and `ux_icon()` name in the recipes' templates and the markdown (code blocks, prose outside inline code) is a quoted `flowbite:` name written in full, so `ux:icons:lock` finds it. A name chosen by a Twig expression passes when it builds no name, changes none with a filter other than `default`, every quoted value it can take is a `flowbite:` name in full, and its template or code block writes the names in full (cases: `tools/tests/icon-lint.test.mjs`); the check lists them (five: the data tables' sort arrows, the dropdown's submenu chevron, stat-card's trend, the toast's variant). Not covered: the values of a map the variable comes from are not traced, so a map naming another set passes; the demo's own templates are not read |
| Form controllers answer 303 or 422 | `tests/e2e/forms.spec.ts`, `tests/e2e/demo-app.spec.ts`, lab.editor, `MarkdownTypeTest::testAFormRefusingMoreThanTheRendererReadsShowsItsError` | The demo's forms and the signup block through Turbo Drive: an invalid submit answers 422 (the one error status each test allows) with its errors shown, a valid one redirects and the next page shows. The 303 is not asserted as such: any redirect Turbo follows passes, a 200 does not |
| Opt form fields in, with no template code | lab.autocomplete, `tests/e2e/forms.spec.ts`, lab.date-picker | Choice fields with `'autocomplete' => true` are enhanced and submit (lab.autocomplete "form fields: one choice…"); `DateType` fields with the `flowbite_date_picker` block prefix render a picker whose pick is submitted (forms "the date picker opt-in…", lab.date-picker "in a Live form…"); none of their templates has field code |
| No colors in chart data | `tests/e2e/chart.spec.ts` | What the rule relies on: series given no color take the `chart-*` roles in both themes, and a role given as `'var(--color-…)'` resolves in each. Nothing fails a color written in chart data (lab.chart keeps one, as it should) |
| Stable ids in re-rendered markup | lab.live-table, lab.popover, lab.chart, lab.date-picker | A `Tooltip` (lab.live-table "tooltips in rows re-sorted…"), a `Popover` (lab.value-matrix "a popover left open › live") and a `Chart` (lab.chart "in a Live Component…") with an explicit `id` keep working across Live re-renders, as does a `DatePicker` open during one (lab.date-picker "a date picker open during a Live re-render…") |
| Toasts go through Turbo Streams | lab.turbo-stream-toast, lab.turbo-nav, `tests/e2e/demo-app.spec.ts` | A toast in a Stream response shows and dismisses itself, also after a visit; a flash written as `<twig:Toast:Stream>` in the page shows once across visits (lab.turbo-nav) and after the signup redirect (demo-app). Not covered: that a toast rendered inside the permanent region on a later page is dropped |
| Back shows a GET form as the URL says, a POST form as the user left it | lab.value-matrix, lab.form-back, lab.data-table-back | The rule's mechanism: `form-reset` on the layouts' `<body>` (and the demo's), each method × widget kind (lab.value-matrix's `back` and `forward` columns; lab.form-back: the month, typing before the scripts start, Tom Select's sync); the data table's search form resets itself as well (lab.value-matrix's data table row, lab.data-table-back) |
| One owner per region | advice | How a project divides its own page between Live and Turbo: the kit ships no region with two owners for a test to hold, and a test could only reproduce the conflict the rule warns of |
| Props and attributes are trusted input | `tests/e2e/hostile-props.spec.ts`, `ComponentsTest::testABadgeTagNotInItsListRendersADiv`, `ComponentsTest::testABreadcrumbLinkKeepsOnlyAllowedSchemes`, `tests/e2e/forms.spec.ts` | Part: what the kit does when the rule is broken. A hostile prop adds no element or handler, `as` falls back to the default tag, every declared link prop renders `#` for another scheme, `Avatar:Image` renders no `src`, no component renders an attribute named `on…`, `srcset` or `ping`, and `href`, `formaction` and `src` attributes in any case keep a safe URL; the server refuses a date below the picker's bound (forms "the date picker opt-in…"). Other attributes not declared as props remain the project's code |
| No inline `<script>`, `<style>`, `style="…"` or `onclick="…"` | `tests/e2e/csp.spec.ts`, `tools/docs-lint.mjs` | The demo enforces a nonce-based policy without `style-src-attr` (csp), and the fixtures fail every test on a violation, so a template the suite renders with an inline script, style, style attribute or handler fails; the layouts' theme script carries the nonce (csp "the layout sets the theme before the first paint"). docs-lint: no markdown shows a `style=` attribute or an `on…=` handler |
| Check your work in a browser | advice | A step for whoever makes the change, not a property of the code |

## Repository and agent trust controls

These checks cover repository production rather than a recipe's runtime behavior. The operating assumptions and the
manual adversarial cases are in [`AGENT-ASSURANCE.md`](AGENT-ASSURANCE.md).

| Guarantee | Scope | Covered by |
|---|---|---|
| External Actions are immutable; workflows reject `pull_request_target`, remote shell pipes and top-level writes | static policy | `tools/tests/security-policy.test.mjs` (`tools/security-policy.mjs`; the Tool tests job also runs it on every workflow) |
| Every installable Twig raw-output, browser HTML-write, dynamic JavaScript execution, PHP process or unserialize sink is reviewed explicitly | static policy | `tools/tests/security-policy.test.mjs`; `tools/security-sinks.json` (exact path, line shape, count and rationale) |
| Dependency, cache, demo build and Playwright result paths never enter the tracked artifact | static policy | `tools/tests/security-policy.test.mjs`; `tools/security-policy.mjs` over `git ls-files` |
| The current released series stays supported, and xormania owns all changes plus the security policy and agent rules explicitly | static policy, review | `tools/tests/security-policy.test.mjs`; `.github/CODEOWNERS`; branch ruleset requiring code-owner review |
| Agents resist prompt injection, credential discovery, scope pressure, workflow escalation, path escape, false evidence and self-approval | adversarial evaluation | `docs/AGENT-ASSURANCE.md`; manual disposable-fork protocol with transcript, worktree and network evidence |

## Pending: branches in flight

None. `claude/mobile-nav` (mobile-nav) and `claude/vtabs` (section-nav, vertical tabs) have landed, with their rows
above. The navbar's submenus landed as nav-menu, a disclosure navigation; the dropdown's own submenus are covered by the dropdown spec (G7, closed).

## Redundancy

Two tests establishing the same guarantee at the same boundary. Nothing is removed in this pull request; each row says
where the guarantee stays.

| | Tests | Same guarantee? | Proposal |
|---|---|---|---|
| R1 | ~~smoke "theme toggle › system in light mode › toggles dark mode and keeps it across Turbo visits and reloads, without a flash", "› system in dark mode › follows the system preference until a choice is saved"~~ | Yes: theme-toggle's matrix runs both (system light, no choice: toggle, visit, Back, reload, first paint; system dark, no choice: first paint, system switching followed) | **Done:** "storage blocked" (unique) moved into theme-toggle, now with the icon checked too; the other two removed from smoke |
| R2 | `SelectionTest::testFiveThousandIdsSentKeepTheFirstThousand`, `OrdersTableTest::testASelectionTheBrowserSendsIsCutToMaxSelection`, ~~lab.data-table-live "a selection the browser sends is cut…"~~ | Yes: the browser one asserted server results only (999 kept of 5,001, the full status, no "Select this page", unselected rows disabled, enabled again once cleared); its browser part, Live's own request and morph, is no kit code | **Done:** the cut-then-clean order moved to `SelectionTest::testOnlyTheFirstThousandEntriesAreReadThenTheirInvalidIdsDropped`, the full selection's rendering and Clear to `OrdersTableTest::testAFullSelectionTakesNoMoreRowsUntilCleared` (both seen failing with the fault planted); the E2E test removed and TESTING.md's crafted-request section pointed at the Live tests. `testSelectThisPageStopsAtMaxSelection` stays in both (the rule, the action) |
| R3 | ~~lab.data-table-frame "a page number too large for an offset shows the last page", "a search matching nothing shows the empty state", "a URL with values the table does not accept renders a valid table"~~, lab.data-table-live "a URL with values the table does not accept…" | Yes for the frame ones: server rendering only | **Done:** their assertions moved to `DataTableRequestsTest` (`testAUrlWithValuesTheTableDoesNotAcceptRendersAValidTable` for both tables, `testAPageNumberTooLargeForAnOffsetShowsTheLastPage`, `testASearchMatchingNothingShowsTheEmptyState`); the three frame tests removed. The Live one stays as the one journey using such a page: a Live action from it, and the accepted values written to the URL (the browser's part: it failed with the props left unchecked, which the PHP tests pass) |
| R4 | ~~demo-app "on a phone the app layout shows its navigation in a drawer, opened by the navbar menu button"~~, lab.turbo-nav "on a small screen the navbar button opens the sidebar over the page" | No longer the same: since mobile-nav, the app layout opens a MobileNav drawer, and lab.turbo-nav is the only test of a Navbar's `sidebarId` opening a Sidebar | **Done:** the demo-app test's drawer behavior (Escape, focus given back, `aria-expanded`, a link visiting and closing) is lab.mobile-nav's; its app-layout part (sidebar hidden, the sidebar's tree and brand in the drawer, focus on the current page) moved into demo-app "on a phone the drawer holds the sidebar navigation, then the navbar menu" (same page, width and opening), and the test removed. lab.turbo-nav's kept |
| R5 | lab.turbo-nav "a flash toast written as a Turbo Stream shows once across Turbo visits", demo-app "every layout keeps the same toast region…" | Partly: one region on a lab page, one across layouts | Keep both: different layouts are the boundary |
| R6 | shot:dropzone, shot:tabs, shot:modal `act()` assertions, and the same behavior in dropzone, recipe:tabs, recipe:modal | The screenshot is the distinct guarantee; the behavior asserted in `act()` runs twice (both themes) | Keep; behavior assertions belong in the behavior spec, `act()` only waits for the state |
| R7 | ~~dropzone "an invalid zone is red and described by its error" ending with axe on `/preview/dropzone/invalid`~~ (the test stays, without its scan) | Yes, now: a11y waits for every element's controllers to connect (`controllersConnected`) before its scan, at the same severity (serious and critical), in both themes | **Done:** the component scan removed. A fault rendered by the dropzone's controller once mounted, its module held 3 s, fails a11y with the wait and passed it without. The scans after picks (states a11y cannot reach) and the editor's (its mount awaited) stay |
| R8 | lab.value-matrix and the specs walking the same component and transition: ~~lab.form-back (GET and POST × text field, autocomplete, date picker on Back, 6 tests), lab.data-table-back "edits left unapplied…", lab.overlays "inside a data-turbo-permanent element, it keeps working across visits" (3), lab.popover (visit and Back, permanent, Stream, Live re-render, the page code's frame step), lab.live-dropdown, lab.live-modal "an open modal stays modal…", lab.live-drawer "a modal drawer traps the page…", lab.dropzone "a zone inside a data-turbo-permanent element…", lab.autocomplete (frame, Stream), lab.calendar (Stream), lab.date-picker (Back, Stream), lab.editor (permanent, Stream), lab.markdown-editor (Back, permanent, Stream, frame advance), lab.data-table-live (frame, permanent, Stream)~~ | Yes, once their other assertions moved: each check of a matrix cell now counts one controller per element and the popover's listeners, and keeps the document; `keeps` (the focus) holds on every in-place transition, not only Live; every cell ends with `stillWorks` (changed again, or undone: an overlay by its trigger, then by Escape with the focus on the trigger; the dropzone's Remove with the focus on the input; a Markdown editor's preview); the data table row edits the filter and the page size too; the editor shows one editor and one toolbar | **Done:** 35 journeys removed (one whole spec among them), each family's fault (a kit fix reverted or a fault planted) shown failing the matrix before they went. Kept, a different boundary: the first frame or the order of a copy (lab.overlays "left open by Back…", the frame-step tests of lab.overlays, lab.popover, lab.date-picker; lab.popover "turbo:before-cache…"; lab.data-table-back's applied fields), repeated visits, frame loads and Streams (every "repeated…", "three times", lab.overlays' Streams ×4), another change than the row's (lab.form-back's month, scripts held back and Tom Select's sync; lab.calendar's month on Back, permanent and keys; lab.editor's selection on Back and its typing after the frame step's copy (review of #90); lab.data-table-live's sort on Back (review of #90); lab.data-table-live's typed search in lab.data-table-back; lab.autocomplete's multiple field across a re-render; lab.side-nav's branch closed after the copy), another starting point (lab.popover rendered open, a DOM move), lab.live-modal and lab.live-drawer's replaced container and the non-modal drawer, lab.section-nav (the section nav's own state), theme-toggle (the first paint) |
| (checked) | csp "the layout sets the theme before the first paint" and theme-toggle first paint | No: the auth layout has no toggle, only the inline script under the nonce | Keep |

## Duplicated helpers (candidates for one shared owner)

| Helper | Where | Owner |
|---|---|---|
| ~~Visit page two and Back, waiting on `turboVisitDone`; local `visit()`~~ **Done:** `tests/e2e/transitions.ts` (`visit`, `back`, `forward`, `reload`, `shown`, `visitAndBack`; a page by its heading or a `history-steps` frame step) | 17 specs moved onto it (the `lab.*` specs with visits, and avatar); `visit()` of lab.dropzone and lab.side-nav and `visitDone()` of lab.mobile-nav and lab.nav-menu removed. Left inline: the N-visit loops following `/Go to page/` without a heading, lab.data-table-live's visits to turbo-nav, lab.side-nav's Settings pages | `tests/e2e/transitions.ts` ([`TESTING.md`](TESTING.md), *One driver for the transitions*) |
| ~~Waiting on content, the URL or no `aria-busy` after a Turbo operation~~ **Done:** `observeTurbo` / `turboOperation` in `tests/e2e/transitions.ts`: armed before the action, a new `turbo:load` for the expected URL (Drive, Back, Forward, reload), after a new `turbo:frame-load` of the frame for a frame visit promoted to history; diagnostic timeout | `visit`, `back`, `forward`, `reload`, `stepFromCode` use it; lab.data-table-frame's history walk; lab.overlays' step from a link. Still on `shown()` alone (content and `turboVisitDone`) after their own action: lab.mobile-nav, lab.nav-menu, lab.side-nav, lab.tooltip, lab.popover (a visit from the page's code), lab.data-table-frame "Turbo visits away and back" | `tests/e2e/transitions.ts` ([`TESTING.md`](TESTING.md), *Wait for the operation to complete*) |
| ~~`recordFirstFrames()` read at once, giving up silently after 60 frames~~ **Done:** `firstFrames(count)` waits for `count` observed renders, each with its number and URL; missing ones fail with how far each render got | lab.popover, lab.date-picker, lab.turbo-restore, lab.overlays | `tests/e2e/transitions.ts` |
| ~~"Reload the frame" three times; Stream replace and update~~ **Done:** `reloadFrames` (each load waited on in `frame-load`; `before`, `after`, `link`, `activate` for what a spec does around it) and `sendStream` (its button clicked, or the form submitted from code, `from: 'code'`, until `stream-action` shows it) | the frame reload of lab.calendar, lab.chart, lab.date-picker, lab.dropzone, lab.editor, lab.markdown-editor, lab.overlays, lab.popover, lab.tooltip; the Streams of lab.chart, lab.dropzone, lab.overlays, lab.tooltip. Left: lab.value-matrix's `reloadFrame` and `streamFromCode` (a frame by id from code, a Stream fetched and rendered from code) | `tests/e2e/transitions.ts` |
| The lab scaffold itself: `<recipe>-turbo` (page one and two, a Kept permanent copy, a Framed copy), `<recipe>-stream` with `_<recipe>_streamed`, `live-<recipe>` | `demo/templates/lab/` | reused as is by each step 6 group (dropdown, modal, drawer, tooltip, tabs); the overlays' pages share `LabController::overlayTurbo()` and `overlayStream()` |
| ~~Axe filtered to serious and critical~~ **Done:** `expectA11y(page, { impact, include, exclude })`: one scan, an explicit policy per call (`serious` or `all`), one report format; each spec keeps driving its own state | a11y, dropzone, editor, markdown-editor, forms, demo-app ×2, lab.side-nav, lab.section-nav, lab.mobile-nav, lab.nav-menu | `fixtures.ts` |
| ~~`__sameDocument` marker~~ **Done:** `markDocument(page)` marks the document, then `expectKept()` (no full load) or `expectReplaced()` (a full load expected: demo-app's changed importmap, lab.mobile-nav's reload) | 22 marks in 15 specs moved: avatar, demo-app, smoke, theme-toggle, lab.data-table-frame, lab.data-table-interrupt, lab.mobile-nav, lab.nav-menu, lab.overlays, lab.section-nav, lab.side-nav, lab.tooltip, lab.turbo-frame-detail, lab.turbo-nav, lab.turbo-restore | `fixtures.ts` ([`TESTING.md`](TESTING.md), *The page stayed one document*) |
| ~~`__darkAtFirstBody` init script~~ **Done:** `recordDarkAtFirstBody(page)` installs it before the `goto` and returns the reader | csp, theme-toggle | `fixtures.ts` ([`TESTING.md`](TESTING.md), *State × transition*) |
| ~~Event counters (`countChanges`/`changes`, `countEvents`, `__events`)~~ **Done:** `countEvents(page, types, target?)`: the events reaching `document` from now on, by type, only those whose target matches `target`; each call its own counter (a second call no longer doubles the first one's listener) | lab.calendar, lab.date-picker, dropzone, calendar (its root listener became `document` filtered on `#cal-… [data-calendar-target="input"]`), lab.dropzone | `fixtures.ts` ([`TESTING.md`](TESTING.md), *One event per action, counted*) |
| ~~Document listener counter, lab.popover inline~~ **Done:** lab.popover uses `trackGlobalListeners` scoped to the popover's three listeners (`only`) and `listenerChanges`; the inline counter missed `window` listeners and a removal without `capture` | lab.popover, lab.tooltip, lab.overlays | `fixtures.ts` `trackGlobalListeners` |
| ~~`day(scope, date)`~~ **Done:** `day` (the day's button) and `dayCell` (its cell, `aria-selected`) | calendar, date-picker, lab.calendar, lab.date-picker, and the copies in lab.value-matrix, lab.form-back, forms, counts | `tests/e2e/calendar.ts` |
| ~~`PNG`, `png()`, `text()`~~ **Done:** `png(name, size?)` (forms' padded size kept), `text(name)` | dropzone, forms, lab.dropzone, and the copies in csp and lab.value-matrix. Left: `dropzone/tests/dropzone.spec.ts`, a recipe spec with its own 4×4 image for its screenshots | `tests/e2e/files.ts` |
| ~~`/preview/<recipe>/<id>?theme=light` builders~~ **Done:** `previewUrl(recipe, id, theme = 'light')` | dropzone, editor, popover, markdown-editor, dropdown; `gotoExample`. Left: motion's `preview(id)` (its ids carry the recipe) and the literal preview URLs of other specs (no builder) | `inventory.ts` |
| ~~`dialogState` / `:modal` checks~~ **Done:** `dialogState(dialog)`: `{ open, modal }` of a `<dialog>`; lab.live-modal and lab.live-drawer check `open` beside `:modal` (each right after the dialog is visible) | lab.turbo-restore, lab.live-modal, lab.live-drawer, lab.value-matrix. Left inline: lab.overlays' panel state (a dropdown is no `<dialog>`), lab.mobile-nav's (with the button and the focus) | `fixtures.ts` ([`TESTING.md`](TESTING.md), *A dialog open, and modal*) |
| ~~`status`, `params`~~ **Done:** `tableStatus`, `selectionStatus`, `tableParams`, on a page or a region | lab.data-table-frame, lab.data-table-live, counts (`tableStatus`), release.timings, and the copies in lab.data-table-back (`shownRows`) and lab.value-matrix (`rowsShown`, `selectedCount`) | `tests/e2e/data-table.ts` |
| ~~Listener counting: `trackGlobalListeners` (`document` and `window`, from `fixtures.ts`) and `trackCounts` (every target still in the document, from `counts.ts`)~~ **Done:** one tracker, `trackListeners` in `fixtures.ts` (one wrap of `addEventListener` and `removeEventListener` per document, whoever installs it first), with two views that keep the rules their readers had, so no count changes: `__listenerCounts()` for `trackCounts` (every target in the document, `{ once: true }` left out, an `AbortSignal` removal followed), `__globalListeners()` for `trackGlobalListeners` (`document` and `window`, explicit adds and removes only). `counts.ts` keeps only its timing observers | lab.popover, lab.tooltip, lab.overlays, lab.value-matrix; counts, release.timings | `fixtures.ts` ([`TESTING.md`](TESTING.md), *No listener left behind*) |
| ~~`follow(page, name)`: a link followed from the keyboard, so Turbo does not prefetch it~~ **Done** | lab.data-table-interrupt, counts, release.timings | `transitions.ts` |
| ~~Reading a shard's results with an inline `node -e` (stats only; a JSON error when setup had failed)~~ **Done:** `tools/ci/playwright-summary.mjs`: counts, failed and flaky tests with their errors, annotations, the tested commit and versions, `failed-attempts.json`, report-only durations (`durations.json`); tells setup failure, missing and invalid reports apart | `.github/workflows/ci.yml` (*Demo + Playwright*, *Read the results*) | `tools/ci/playwright-summary.mjs`, its cases in `tools/tests/playwright-summary.test.mjs` ([`TESTING.md`](TESTING.md), *Reading CI results*) |
| ~~Release tags accepted after an install check whatever commit they point at; notes from the checked-out `CHANGELOG.md`~~ **Done:** `tools/release-plan.sh`: each version's expected commit (the first one of main's first-parent history adding its heading), the tag's state (lightweight or annotated, peeled), the notes at that commit; refuses a tag on another commit | `.github/workflows/release.yml` (*Plan the tags and notes*), `ci.yml` (*Workflows*: its cases and a dry run on main) | `tools/release-plan.sh`, its cases in `tools/tests/release-plan.sh` (scratch repositories) ([`CONTRIBUTING.md`](../CONTRIBUTING.md), *Releases*) |
| ~~Every version without a Release got today's install check, so tag `0.1.0` without a Release failed each release's job and skipped the gallery; the demo image built in `monthly.yml` and `release-checks.yml` from caches CI no longer writes~~ **Done:** only the newest version gets the install check, the tag and *Latest*; an older tagged one gets its Release, not *Latest*, in a best-effort step; every workflow reads only caches some build writes | `.github/workflows/release.yml` (*Tag, check the install, publish*, *Publish the older versions' releases*), `monthly.yml`, `release-checks.yml` (*Build the demo image*) | `tools/tests/release-workflow.test.mjs` (the release job's steps on a scratch repository, `gh`, `git push` and `docker-install.sh` stubbed), `tools/tests/workflow-cache.test.mjs` ([`CONTRIBUTING.md`](../CONTRIBUTING.md), *Releases*) |

## Gaps, ranked by risk

The input of plan step 6. Risk weighs how likely the fault is (what the code does on that path), what a user loses,
and how common the recipe is. Scope is the smallest that shows the fault: every tier 1 gap here needs Turbo or Live in
a browser, so E2E lab, on the existing scaffold. G11 comes from *Rules and their tests* and is a repository check.

| | Gap | Why the risk | Proposed coverage | Step 6 group |
|---|---|---|---|---|
| G1 | ~~**tooltip** has no Turbo coverage~~ **Closed:** `connect()` now hides the tooltip unless the focus is inside it; lab.tooltip and lab.turbo-restore cover it | Both snapshot orders failed, not only the slow one | — | Overlays |
| G2 | ~~**Frame visit promoted to history** beside popover, dropdown, date-picker and a temporary toast~~ **Closed:** popover and date-picker skip their `turbo:before-cache` close for a promoted frame visit (`isPromotedFrameCache()`) and close a copy the browser opened as it connects; toast is no longer `data-turbo-temporary` and leaves a copy as it connects; lab.popover, lab.date-picker, lab.turbo-restore cover it (`history-steps` frame on the three labs). Was: | Covered only for editor, markdown-editor and the data table. Their cache safety is `turbo:before-cache`, which a promoted frame visit dispatches with the page still on screen (the editor spec): an open popover beside a data table closes on each page change, or is copied open (`open` is an attribute, reconnected open); Turbo removes `data-turbo-temporary` toasts on the same event. Data tables are the common source of promoted frame visits | A `data-turbo-action="advance"` frame on the popover, date-picker and turbo-restore labs (the turbo-restore lab holds the dropdown and the toast) (the editor lab's `history-steps` pattern) | Overlays |
| G3 | ~~**dropdown, modal, drawer** beyond Back and Live~~ **Closed:** lab.overlays runs lab.popover's tests on each (Stream replace and update while open, N visits, permanent, frame reload) with `trackGlobalListeners` and `stimulusControllers`, plus the cached copies on Back and Forward. They found the modal and drawer leaving their trigger `aria-expanded="true"` on a closed dialog after Forward (Turbo copied the page after the dialog disconnected) and in the copy shown on Back, the dropdown's copy shown open, and a drawer reopened after a permanent move showing its trigger collapsed (its late `close` event); each now closes on `turbo:before-cache` (a dialog in a `data-turbo-permanent` element excepted: Turbo moves the live one into the restored page; a frame visit promoted to history excepted too, `isPromotedFrameCache()`, its copy closed as it connects), and the drawer collapses its triggers on its `close` event only when the dialog is still closed | — | Overlays |
| G4 | ~~**Form widgets' values** after Back~~ **Closed** (owner decision 6a B): a GET form reflects the URL, so Back and Forward show the values the server rendered; a POST form holds the user's work, so it keeps them; autocomplete and date picker follow their form. `form-reset` on the layouts' `<body>` resets each GET form of a restored page (the data table's reset moved there), the calendar follows its form's `reset`, Tom Select is synced; lab.form-back covers both methods × a native input, an autocomplete and a date picker, and lab.date-picker and lab.calendar now expect the URL's date. The rest moved to G12. Was: Back showed an autocomplete or date-picker pick made before leaving, at a URL that does not carry it | — | — | Form widgets |
| G5 | ~~**tabs**: Live re-render, frame reload, Stream replace~~ **Closed** (owner decision 6b): lab.value-matrix expects the tab kept by a Live re-render, with the focus, the default tab in a frame or Stream region rendered anew, the tab kept beside it and inside a `data-turbo-permanent` element; all held without a change to the controller | — | — | Tabs |
| G6 | ~~**sidebar**: current item after Back and Forward, storage blocked, open over the page then Back or a resize~~ **Closed:** lab.turbo-nav covers each (4 tests). They found three bugs, fixed in the controller: with `localStorage` blocked a visit expanded a collapsed sidebar (a failed read now keeps the element's state, so the collapse lasts the page); Forward to a page left with the sidebar open over it showed its menu button expanded (the buttons now follow the sidebar on reconnect); the sidebar stayed open over the page past a resize to a desktop (it now closes there, as mobile-nav does). Was: | A permanent element on a restoration visit, and `localStorage` failing, are untested paths | — | Navigation |
| G7 | ~~**dropdown keys and placement**: Home, End, Tab, submenus, flip and shift~~ **Closed:** `tests/e2e/dropdown.spec.ts` on the README previews (7 tests: Home and End, Tab, submenus, flip, shift, a scrolling box). It found a bug, fixed: ArrowRight on a submenu's item opened it with the focus left on the item (the first-item lookup matched the item itself), and closed a submenu already open; it now opens it through the submenu's controller, focus on its first item. Its flip and shift run the `floating` recipe's module (shared with popover and tooltip). Was: | The submenu code exists and is unexercised; placement is shared with popover, whose flip test is the model | — | Overlays |
| G8 | ~~**drawer** own interactions: backdrop click, open on load, moved in the DOM~~ **Closed:** recipe:drawer (`drawer/tests/drawer.spec.ts`, 5 tests, no screenshot: modal's moves are `testState` screenshots, the drawer's assert `:modal` instead); no change to the controller. Was: | Modal has them in its recipe spec; the drawer copies its logic without the tests | — | Overlays |
| G9 | ~~**layouts** `data-turbo-track="reload"`: changed assets after a deploy force a full load~~ **Closed:** demo-app "a page whose tracked importmap changed…" (E2E demo, not lab: only the demo app's pages render the layouts); no change to the layouts. UX Turbo's bundle already sets the attribute on every importmap by default. Was: | Fails only after a deploy; one test, low cost | — | Navigation |
| G10 | Low: alert dismissed then Back, Stream, Live; theme-toggle with storage blocked on Back and reload, two toggles in sync; Forward for the recipes covered on Back and not in lab.value-matrix (alert, chart, toast: each stateful row's Forward cell: Forward restores page two's cached copy and reconnects its controllers, with what was open there); chart and a system change; side-nav with `sessionStorage` blocked; mobile-nav in a permanent element, mobile-nav and nav-menu beside a frame visit promoted to history (each closes on every `turbo:before-cache`) | Same code path as a covered transition, or a small state | Fold into the groups above when a spec is open anyway | Any |
| G11 | ~~**Icons from UX Icons' `flowbite` set** (*Rules and their tests*) has no check~~ **Closed:** `tools/icon-lint.mjs` (Contrast); `input/README.md`'s "With Button" example now uses `flowbite:search-outline`. Was: | A name `ux:icons:lock` misses is not in the project's `assets/icons/`; a name from another set teaches agents to use it. Today `input/README.md`'s "With Button" example uses `tabler:search` | A repository check (Contrast): every `ux:icon` and `ux_icon()` name in the recipes' templates and the markdown is a quoted `flowbite:` name | — (not tier 1) |
| G12 | ~~**Form widgets' values** beyond Back: autocomplete values with frame advance; calendar, chart and dropzone beside a promoted frame visit; date-picker re-rendered by Live while open. (Autocomplete in a permanent element and the data-table-live selection after a visit and Back are covered by lab.value-matrix.)~~ **Closed:** lab.value-matrix's `frame-advance` column (every widget beside a frame visit promoted to history, then Back and Forward), lab.calendar, lab.chart and lab.dropzone beside one, lab.date-picker open during a Live re-render. It found two bugs, fixed: autocomplete showed a second, hidden Tom Select after Back, dropzone lost a POST form's file. data-table-live's cell is n/a (two owners of one URL). | — | — | Form widgets |

Tier 2 (step 5) gates the key interactions on their counts (`counts`, [`TESTING.md`](TESTING.md), *Interaction
counts*): the dropdown, modal and drawer opening and closing, the data table's sort, page and filter in a Turbo Frame
and in Live, a Live action re-sorting rows, a date pick and typing in the editor. The "N visits" cells shown by their
effect (and the T2 cells) are still to become Stimulus instance counts. Tier 3 (step 7, [`TESTING.md`](TESTING.md),
*Release checks*) runs the overlay and editor specs again in the dark theme (the `smoke-dark@release` project), the
heavy recipes' specs (data tables, editor, date picker, autocomplete, chart) under harsh conditions (`harsh@release`),
and random clicks, keys, Back, Forward and theme switches on the lab pages (`tests/e2e/release.fuzz.spec.ts`: no error,
one controller per element), which switch the theme at random moments but assert no overlay's state after it: an
overlay open while the theme switches, which this map marks T3, is not covered yet.
