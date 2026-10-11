# Testing patterns

_2026-10-08. The tests of this repository, written up so they can be reused in any Symfony app built with Turbo,
Stimulus and Live Components. Each pattern says what it catches, shows the core of it, and links the spec that uses
it here. The snippets use Playwright Test; the PHP ones need only the app's autoloader._

The demo app (`demo/`) is the fixture: every pattern runs against real pages, where recipes, Turbo, Live
Components, `flowbite.min.css` and a strict Content Security Policy meet. Bugs between those pieces only show there.

## Every test: fail on what the user would not see

**Catches:** console errors, uncaught exceptions, Content Security Policy violations, failed or 4xx/5xx requests,
none of which fail an assertion on their own.

A Playwright fixture records them for every test and fails the test at its end; a test that expects an error allows
exactly that response. Requests leaving the app are blocked, so no test depends on the network.

```ts
// tests/e2e/fixtures.ts (shortened)
export const test = base.extend({
    page: async ({ page, baseURL }, use) => {
        const errors: string[] = [];
        page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`));
        page.on('response', (response) => response.status() >= 400 && errors.push(`${response.status()} ${response.url()}`));
        await page.addInitScript(() => document.addEventListener('securitypolicyviolation',
            (event) => console.error(`CSP ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`), true));
        await use(page);
        expect(errors).toEqual([]);
    },
});
```

Here: [`tests/e2e/fixtures.ts`](../tests/e2e/fixtures.ts) (`guardPage`, `recordCspViolations`, `allowHttpError`; `allowCancelledRequest`
for a request a test cancels on purpose, *Back during a frame visit promoted to history*).

The guard drops two page errors of its own, each the rejection of Turbo's prefetch (a link under the pointer) that a
full load (a reload, a `goto`) cancels, in the one engine that throws it (*Browsers*): WebKit's
(`FETCH_CANCELLED_BY_UNLOAD`, from the full load's request until its document replaces the old one) and Firefox's
(`PREFETCH_CANCELLED_BY_UNLOAD`: *NetworkError when attempting to fetch resource.*, thrown from Turbo's prefetch code
as its own request ends cancelled, and a full load after it commits). Anywhere else
the same messages fail the test: `smoke.spec.ts` ("the page guard") calibrates both, with the real case and with the
message where one condition is missing.

## Turbo

### The page stayed one document

**Catches:** a link or form that falls back to a full page load (a Turbo Drive regression, a `data-turbo="false"`
too many, a 500 that Turbo answers with a full load).

Set a marker on `window`, navigate, check the marker is still there.

```ts
await page.evaluate(() => ((window as any).__sameDocument = true));
await page.getByRole('link', { name: 'Lab' }).click();
await expect(page).toHaveURL(/\/lab$/);
expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
```

Here: [`tests/e2e/smoke.spec.ts`](../tests/e2e/smoke.spec.ts), [`lab.turbo-nav.spec.ts`](../tests/e2e/lab.turbo-nav.spec.ts).

### Wait for the operation to complete, not for content

**Catches:** a flaky test that acts while Turbo is still working: it sees a cached preview, or a URL that changed
before its frame rendered, and its next step (going Back, most often) cancels or overtakes the operation. A test that
then asserts the state it expects fails one run in a few, on a state the user can reach only by clicking very fast.

Content, the URL and `<html aria-busy>` do not say an operation is over. On a visit to a cached page Turbo first shows
the snapshot, so the expected content is on screen while the request still runs. A frame visit promoted to history
(`data-turbo-action="advance"`) changes the URL once the response has arrived, before the frame renders; then, once the
frame has loaded, starts a page visit of its own, which marks `<html aria-busy>` only from that point: a check for its
absence passes in between. A select or field the test changed itself shows the new value before any response.

The completion contract, each a **new** event, observed by listeners armed before the action:

| Operation | Completes with |
|---|---|
| Drive visit, Back or Forward (a restoration visit), reload | a new `turbo:load` for the expected URL |
| Frame visit promoted to history (a link or form in an advancing frame, `Turbo.visit(url, { frame, action: 'advance' })`) | a new `turbo:frame-load` of that frame, then a new `turbo:load` for the expected URL |

Then check the domain state: content, every control, focus. A frame visit that is not promoted, a Turbo Stream and a
Live re-render dispatch no `turbo:load`: they need contracts of their own (`turbo:frame-load` of the frame, the
streamed content, Live's own events). No event tells that the page visit has put its copy in the cache (Turbo 8
starts that without awaiting it, deferred to the next task): the contract removes the known gap, between the URL change
and the page visit, and repeated runs of the history walk going Back right away are the evidence for the rest.

`observeTurbo` records Turbo's events in the page, numbered (an init script and the current document, so a full load
records from its start), arms at the current number, and polls with `expect.poll` until the expected sequence appears
after it. On timeout it fails with what it expected and every Turbo event since it was armed:

```ts
await turboOperation(page, { frame: 'orders', url: '/lab/data-table-frame?sort=customer&dir=asc' }, () =>
    page.getByRole('link', { name: 'Customer' }).click(),
);
await turboOperation(page, { url: '/lab/data-table-frame' }, () => page.goBack());
// or arm, act, wait:
const loaded = await observeTurbo(page, { url: /step=1/ });
await page.goForward();
await loaded.done();
```

A wrong expectation (here `size=50`, the test chose 25) fails with the events that did happen:

```text
Turbo operation did not complete: expected a new turbo:frame-load of #orders, then a new turbo:load for …&size=50
- completed
+ waiting for a new turbo:frame-load of #orders, then a new turbo:load for …&size=50
+ at …&size=25, Turbo events since the observer was armed:
+   turbo:frame-render #orders …&size=25
+   turbo:frame-load #orders …&size=25
+   turbo:visit …&size=25
+   turbo:before-render …&size=25
+   turbo:render …&size=25
+   turbo:load …&size=25
```

`url` is a URL or path (query parameters in any order), a RegExp or a predicate. `turboVisitDone` (no `aria-busy`, no
`data-turbo-preview`) stays useful after the operation, as a check that nothing else started.

Here: [`tests/e2e/transitions.ts`](../tests/e2e/transitions.ts) (`observeTurbo`, `turboOperation`),
[`tests/e2e/fixtures.ts`](../tests/e2e/fixtures.ts) (`turboVisitDone`),
[`lab.data-table-frame.spec.ts`](../tests/e2e/lab.data-table-frame.spec.ts) (the history walk).

### One driver for the transitions

**Catches:** nothing on its own; it keeps every spec waiting the same way. A spec that clicks and checks the URL only,
or waits for the heading but not for the visit, passes on a cached preview and fails on the next run.

Every lab page names itself in a `data-testid="page"` heading and links the next page with `Go to page two`; a
`history-steps` frame (`demo/templates/lab/_history_steps.html.twig`) adds a history entry per step, as a data
table's pages do. Each step of the driver arms the observer, acts, waits for the operation's completion (*Wait for the
operation to complete*, above), then for what the page shows and `turboVisitDone`:

```ts
import { back, forward, reload, shown, visit, visitAndBack } from './transitions';

await visitAndBack(page);                          // Go to page two, then Back to page one
await visit(page, 'Go to page one', 'Page one');   // a link by its exact name, a pattern or a locator
await forward(page, 'Page two');
await visit(page, 'Next step', { step: 1 });       // a frame visit promoted to history: the step shown, ?step=1
await back(page, { step: 0 });
await turboOperation(page, {}, () => page.keyboard.press('Enter'));   // any other way to start a visit, then:
await shown(page, 'Page two');
```

Here: [`tests/e2e/transitions.ts`](../tests/e2e/transitions.ts), used by the `lab.*` specs.

### Back after the cache snapshot

**Catches:** components that come back broken after Back: an open menu or dialog in the snapshot, an editor
rebuilt over its own markup, a form field reset by a component library. The order of Turbo's snapshot and the
controllers' `disconnect()` depends on timing; a stylesheet on the next page, held until Turbo has copied the page it
leaves (`holdUntilCopied`, an event barrier rather than a delay), forces the production order on every run.

```ts
const held = await holdUntilCopied(page, '**/lab/slow.css');
// open the overlay, follow a link inside it to a page that links slow.css:
expect(held()).toBe(1);   // the order was forced: no stylesheet request, no order
// go Back:
await expect(dialog).not.toHaveAttribute('open');
```

Here: [`lab.turbo-restore.spec.ts`](../tests/e2e/lab.turbo-restore.spec.ts), and the Back tests of each `lab.*.spec.ts`.

### What the cached copy holds

**Catches:** an overlay that is open, or a button still `aria-expanded="true"`, in the copy Turbo shows on Back or
Forward, even when a controller fixes it once it connects: the copy is on screen first. A dialog's `close` event, for
one, comes after Turbo has taken the copy.

Record each body Turbo is about to render, `event.detail.newBody`, the cached copies included:

```ts
await page.addInitScript(() => {
    (window as any).__rendered = [];
    document.addEventListener('turbo:before-render', (event: any) => {
        const body = event.detail.newBody;
        (window as any).__rendered.push({
            open: body.querySelector('#drawer-nav')?.hasAttribute('open'),
            expanded: body.querySelector('[aria-controls="drawer-nav"]')?.getAttribute('aria-expanded'),
        });
    });
});
// open the drawer, go Back, open it on that page, go Forward:
expect(await page.evaluate(() => (window as any).__rendered)).toEqual(Array(3).fill({ open: false, expanded: 'false' }));
```

Leave the page with the overlay open, which a click on a link inside or outside it would prevent (it closes the
overlay): go Back or Forward, or start the visit from the page's code (`Turbo.visit(url)`). And make the next page
wait for a stylesheet (*Back after the cache snapshot*, above), or the controllers' `disconnect()` may reset the state
before Turbo copies the page, and the test passes without the `turbo:before-cache` reset:

```ts
const held = await holdUntilCopied(page, '**/lab/slow.css');
await page.goto('/lab/nav-menu/two');
// open the submenus, then:
await page.evaluate(() => (window as any).Turbo.visit('/lab/nav-menu'));   // page one links slow.css
await page.goBack();                                                        // renders the copy of page two
```

Leave it from Back or Forward too, without a stylesheet to wait for: Turbo then copies the page after the controllers
disconnected, and whatever `disconnect()` leaves (a dialog closed there, its button still expanded) is what the copy
holds, and what the new controller starts from.

Here: [`lab.mobile-nav.spec.ts`](../tests/e2e/lab.mobile-nav.spec.ts), [`lab.nav-menu.spec.ts`](../tests/e2e/lab.nav-menu.spec.ts),
[`lab.overlays.spec.ts`](../tests/e2e/lab.overlays.spec.ts) (dropdown, modal, drawer).

### Beside a frame visit promoted to history

**Catches:** a component next to a data table (or any `data-turbo-action="advance"` frame) that closes, loses the
focus or disappears when the frame changes, or comes back open on Back. Turbo copies the page when the frame visit
starts, then dispatches `turbo:before-cache` on the page still shown and caches the earlier copy: a reset on that
event hits the screen and misses the copy ([`NOTES.md`](NOTES.md)).

Start the frame visit with the component open: from a link inside it (`data-turbo-frame="history-steps"`), or from
the page's code, which no click or focus change precedes (a click on the frame's own link closes most overlays first,
and the copy is then taken closed). Check the screen after the step, then Back and Forward, and what the first frame
of each rendered copy shows:

```ts
const firstFrames = await recordFirstFrames(page, { steps: '#steps-content' }); // visible at the first frame of each render
await page.getByRole('button', { name: 'Steps' }).click();
await visit(page, 'Go to step 5', { step: 5 });     // a link inside the popover, targeting the frame
await expect(dialog).toBeVisible();                  // still open, the focus still inside
await back(page, { step: 0 });                       // the copy taken as the visit started: open
await expect(dialog).toBeHidden();
expect(await firstFrames(1)).toEqual([{ render: 1, url: '/lab/popover-turbo', visible: { steps: false } }]);
await stepFromCode(page, 1);                          // Turbo.visit(url, { frame: 'history-steps', action: 'advance' })
```

Here: [`lab.popover.spec.ts`](../tests/e2e/lab.popover.spec.ts), [`lab.date-picker.spec.ts`](../tests/e2e/lab.date-picker.spec.ts),
[`lab.turbo-restore.spec.ts`](../tests/e2e/lab.turbo-restore.spec.ts) (a dropdown, a toast),
[`lab.overlays.spec.ts`](../tests/e2e/lab.overlays.spec.ts) (dropdown, modal, drawer), the values of
[`lab.value-matrix.spec.ts`](../tests/e2e/lab.value-matrix.spec.ts) (`frame-advance`), a calendar, charts and zones
([`lab.calendar.spec.ts`](../tests/e2e/lab.calendar.spec.ts), [`lab.chart.spec.ts`](../tests/e2e/lab.chart.spec.ts),
[`lab.dropzone.spec.ts`](../tests/e2e/lab.dropzone.spec.ts));
[`transitions.ts`](../tests/e2e/transitions.ts) (`stepFromCode`, `advanceFrame` for a lab frame showing its
`frame-load`, `recordFirstFrames`).

`recordFirstFrames` observes each render at the first animation frame with its body in place, which can come after
the test's next line: `firstFrames(count)` waits until `count` renders are observed and returns each one's number and
URL, so a record cannot belong to another render unnoticed. A render whose body another replaced before any frame
comes back with `visible: null`; fewer renders than `count` fail with each one recorded and how far it got. The page
visit after a frame visit promoted to history dispatches `turbo:before-render` without rendering a body: it is not a
render there. What it establishes is the DOM at the first observed animation frame, not every frame the compositor
presented.

A reset on `turbo:before-cache` tells the two apart with Turbo's current visit, which renders nothing for a frame
visit promoted to history (Turbo 8). The `turbo` recipe's module holds that check, and the one for a
`data-turbo-permanent` element, for every recipe:

```js
import { isKeptOnCache, isPromotedFrameCache } from '../lib/uxor-turbo.js';
// isPromotedFrameCache(): false === window.Turbo?.session?.navigator?.currentVisit?.willRender
```

lab.popover "turbo:before-cache closes an open popover before a Turbo visit copies the page, and not when…" records
the popover's state right after each `turbo:before-cache` and in each copy Turbo renders.

### Back during a frame visit promoted to history

**Catches:** a URL, rows and controls that disagree after the user presses Back while a frame visit promoted to
history is still running: new rows at the old URL, or the old URL with a control showing the new value. Losing the
change is acceptable; confusion is not.

Turbo 8.0.23 runs such a visit in phases, and each has a different owner of the request and of history: the request
out (nothing changed yet), the response in and history pushed but the frame not rendered (`FrameController`
`#loadFrameResponse` calls `changeHistory()` before it renders), the frame rendered but the page visit completing the
promotion (`turbo:load`) not over. "Back while loading" is three tests, each holding one phase, never a timeout:

```ts
// 1. before the response: hold the frame's request (its Turbo-Frame header, not a prefetch), release it after Back
await page.route((url) => url.pathname === '/lab/data-table-frame', (route, request) =>
    'orders' === request.headers()['turbo-frame'] && !request.headers()['x-sec-purpose'] ? (held = route) : route.fallback());
// 2. history changed, frame not rendered: Turbo's own pause, `event.detail.resume`
document.addEventListener('turbo:before-frame-render', (event) => { event.preventDefault(); window.__resume = event.detail.resume; });
// 3. frame rendered, promotion not over: the same on the page render of the visit that renders nothing
document.addEventListener('turbo:before-render', (event) => {
    if (false === window.Turbo.session.navigator.currentVisit?.willRender) { event.preventDefault(); window.__resume = event.detail.resume; }
});
await page.goBack();
await held.continue();                                // or: page.evaluate(() => window.__resume())
```

Arm a hold for one event only, and check the phase was reached before Back (the URL unchanged in 1, changed and no
`turbo:frame-render` in 2, `turbo:frame-load` and no `turbo:load` in 3): without the hold, the test proves nothing. In
phase 3, Back's restoration waits for the held render (`Visit` awaits `view.renderPromise`), so wait for quiet with the
visit still busy, then resume.

After the release, wait until Turbo is quiet, not for an expected event: when the late response is handled right,
nothing happens. Quiet is no request in flight, then no Turbo event or history change for 20 animation frames (a frame
render spans three) and no `<html aria-busy>`. Then compare what the page shows (status line, rows, current page,
sorted column, every control's value) with a fresh load of `location.href` parsed with `DOMParser`: one assertion
covers every way the URL and the table can disagree. Do it again after Forward and Back over the entries left, and
check the table takes the next change.

Back can cancel the frame's request on purpose (Back disconnects the frame, which aborts its `src` load). Allow
exactly that request, never every cancelled one: `allowCancelledRequest({ url, method: 'GET', frame: 'orders',
count: 1 })` drops at most `count` failures that are exactly the engine's cancellation (`net::ERR_ABORTED` in
Chromium, `NS_BINDING_ABORTED` in Firefox, `Load request cancelled` in WebKit), of that exact URL, method and
`Turbo-Frame` header; any other failed request still fails the test.

A phase that ends inconsistent is a defect of Turbo or the kit: keep the test, marked `test.fail(condition, '<the
defect>')` with the source lines in a comment, so it reports an unexpected pass once fixed, instead of `skip`. Remove
the mark with the fix, after running the test unmarked without the fix (it fails) and with it (it passes).

The fixes live in a controller on the frame, not on its content: the frame element outlives its renders, sees its
form's submission (`turbo:submit-start` gives the `FormSubmission`, whose `stop()` cancels it) and its own `src`
loads, and disconnects only when Back or a visit replaces the page. Before the page is cached (`turbo:before-cache`,
not for a promoted frame visit), cancel what is still loading: Turbo clears the busy marks and re-enables the submit
button before it copies the page (`cacheSnapshot` waits a tick). Fix what a copy taken earlier kept as it connects
(`busy`, `aria-busy`), and make a frame that left the document inert (no `src`). The defects and their workarounds
are in [`NOTES.md`](NOTES.md).

Here: [`lab.data-table-interrupt.spec.ts`](../tests/e2e/lab.data-table-interrupt.spec.ts) (`instrument`, `quiet`,
`consistency`), [`fixtures.ts`](../tests/e2e/fixtures.ts) (`allowCancelledRequest`).

### Restored fields show the URL's state

The kit's rule: a GET form reflects the URL, so after Back and Forward it shows what the server rendered; a POST form
holds the user's work, so it keeps what was typed and picked. Enhanced widgets (autocomplete, date picker) follow the
form they are in.

**Catches:** a GET form whose fields mirror the URL (a table's search, filters, page size, any search form) showing,
after Back or Forward, a value the user entered before leaving: the state applied next, or an edit never applied; and
the other way, a POST form losing what was typed. Turbo copies the
page with its edited fields (`PageSnapshot.clone` keeps each select's choice, `cloneNode` an input's value), and a
frame visit promoted to history takes its copy once the form is submitted, edits made.

Edit one field, apply, go Back, and check every field against the URL then shown, not only the one edited, and what
the first frame of the restored copy showed. Wait for each step by its events, recorded from before the action: the
frame's `turbo:frame-load`, then a `turbo:load` at the expected URL; on Back, a `turbo:load` at the earlier URL.

```ts
await recordTurboEvents(page);                    // turbo:load and turbo:frame-load, each with location.href
const firstFrames = await recordFirstFrameValues(page);
await page.getByLabel('Search', { exact: true }).fill('bonnie');
let since = await mark(page);
await page.getByRole('button', { name: 'Apply' }).click();
await frameVisitDone(page, since, { sort: 'number', dir: 'desc', q: 'bonnie', 'f[status]': '', size: '10' });
since = await mark(page);
await page.goBack();
await pageVisitDone(page, since, {});
await expect.soft(page.getByLabel('Search', { exact: true })).toHaveValue('');   // soft: every field reported
await expect.soft(page.getByLabel('Status')).toHaveValue('');
await expect.soft(page.getByLabel('Rows per page')).toHaveValue('10');
expect(await firstFrames()).toEqual([{ search: '', status: '', size: '10' }]);
```

Leave with an edit not applied too (a link away, then Back). The fix is one controller on `<body>`, which Turbo
replaces on every visit: `form-reset` (the `layouts` recipe) calls `reset()` on each GET form of the body once the
page's controllers have connected, unless the focus is inside the form or it sits in a `data-turbo-permanent` element:
a copy is a new element, and `reset()` puts back the `value`, `selected` and `checked` attributes the server rendered.
Call it as `HTMLFormElement.prototype.reset.call(form)`: a field named `reset` (a kept URL parameter) shadows the
method. A widget whose state `reset()` cannot reach follows the form's `reset` event itself (the calendar: a hidden
input's value is its attribute; the autocomplete's `autocomplete-sync`: Tom Select's own display), so it holds
without `layouts` too. That event comes before the fields are reset and can be cancelled by any listener: act a task
later (a click on a reset button runs microtasks between listeners), and only if `defaultPrevented` is false; test a
cancelled reset, and a reset with the body's controller removed. Check what the user sees, not only the value
sent: Tom Select's item, the date picker's field and selected day. A Live Component needs none: its controller sets
each `data-model` field from the component's state as it connects.

Data-drive the check over the form's method and each widget kind: change one, visit, go Back, and expect it as
rendered (GET) or as left (POST), the others as rendered.

Here: [`lab.form-back.spec.ts`](../tests/e2e/lab.form-back.spec.ts),
[`lab.data-table-back.spec.ts`](../tests/e2e/lab.data-table-back.spec.ts),
[`form_reset_controller.js`](../layouts/assets/controllers/form_reset_controller.js).

### The value matrix: one policy table

**Catches:** a widget whose value or state does not follow the owner's policy after a transition: a GET form field
keeping what was typed after Back, a POST form's file gone, a Turbo Stream or a frame reload leaving an old value in
the part it replaced (or touching the part beside it), a Live re-render showing the user's value over the one the
server set, an open overlay closed by a visit of its `data-turbo-permanent` element, a Live table's selection shown
again after leaving the page; and what the widget owns across the transition: a second controller on an element, a
listener left behind, the focus lost, a widget restored that no longer answers.

[`lab.value-matrix.spec.ts`](../tests/e2e/lab.value-matrix.spec.ts) is data: `POLICY` maps each kind of state (a GET
field, a POST field, an open overlay, a choice held in the page, a choice stored in the browser, a Live table's URL
state and its selection) and each transition (Back, Forward, a frame reloaded around or beside the widget, a frame
beside it whose visit is promoted to history then Back and Forward, a Stream replacing or updating its region or one
beside it, a Live re-render, a `data-turbo-permanent` visit, a visit away and back) to what the user must see: `url`, `kept`, `fresh`, `server` or `reset`, or `{ na: reason }`. `COMPONENTS`
lists the widgets, each with its kind, how to change it from what the server rendered, and how to check each state
it can show (`rendered`, `changed`, `server`); `cell()` reads the expectation from `POLICY` only. Every transition is
started from the page's code (`Turbo.visit`, a frame visit, a Stream rendered with `Turbo.renderStreamMessage`, a
Live action through `getComponent`), so no click closes what the test left open. The last test fails when a cell has
neither an expectation its site can run nor an `n/a` with a reason. The `frame-advance` cell runs three steps: once
the frame has rendered it expects the `frame-outside` state, after Back its own (a Back's: Turbo shows the copy it
took as the frame visit started), after Forward the `forward` state.

Each check of a cell (`check()`) also expects one Stimulus controller per element for each of the component's
`controllers`, the `listeners` it adds while changed and no others (an open popover's, counted with
`trackGlobalListeners` from the cell's start), and the document the cell started in (no full load). A transition that
leaves the widget in place and kept (a Live re-render, a frame or a Stream beside it, the frame step) also checks
`keeps` (the focus). The cell ends with `stillWorks()`: a widget shown as rendered takes the change again; one shown
changed is taken back by its `undo` (an overlay by its trigger, then, opened by the user, by Escape with the focus back
on the trigger; a tab, a branch, a file, a row, an editor's typing, a Markdown editor's preview), changed again and
undone again. A widget showing the server's values is left as it is. A single-transition journey of an older lab spec
belongs here, with what it asserted beyond the end state: a lab spec keeps what the matrix cannot hold (the first
frame of a copy, the order of a copy, repeated visits, another change than the row's, a route of its own).

The widgets live on `/lab/value-matrix/{one,two}`, four times (rendered by the page, in a Turbo Frame, in a region
Streams replace, inside a `data-turbo-permanent` element; `?only=<key>` renders one widget alone, as each test loads
it), and on `/lab/live-values`, bound to a Live Component whose `serverValues` action sets every property; the data
tables run on their own lab pages.

To add a row: render the widget in `demo/templates/lab/_value_matrix_widgets.html.twig` (or `_value_matrix_ui`)
under its own `only` key, and bound to a property in `LiveValues`; add a component to `COMPONENTS` with its kind (a
new kind needs a row of `POLICY`, from the owner's decision), its `change` and `shows`, its `controllers` (and `undo`,
`keeps`, `listeners` where it has them), and an `na` reason for each cell that cannot apply to it. A cell that fails is a kit bug, or the test's: never an expectation to relax. A
policy that seems wrong for a cell is a question for the owner.

Here: [`lab.value-matrix.spec.ts`](../tests/e2e/lab.value-matrix.spec.ts).

### State saved after the snapshot

**Catches:** a component that shows the state of Turbo's cached copy after Back, when the user changed it on the next
page (a tree's open branches, a collapsed panel). The copy is taken when the page is left; whatever is saved later
must win over it.

Change the state on page one, visit page two, change it again there, go Back: page one shows the second change.

```ts
await branchToggle(page, 'Reference').click();           // page one: open
await page.getByRole('link', { name: 'Go to page two' }).click();
await turboVisitDone(page);
await branchToggle(page, 'Reference').click();           // page two: closed again
await page.goBack();
await turboVisitDone(page);
await expect(treeitem(page, 'Reference')).toHaveAttribute('aria-expanded', 'false'); // the copy had it open
```

Here: [`lab.side-nav.spec.ts`](../tests/e2e/lab.side-nav.spec.ts).

### One controller per element, counted

**Catches:** a controller connected twice to the same element after Turbo visits, Back and the cached copy (a
listener added to `document`, a second instance from a restored snapshot). Its behavior often hides it: two
instances setting the same state look like one.

Expose the Stimulus application in the app's own bootstrap (`window.Stimulus = app`, never in a recipe), then
compare its connected controllers with the elements carrying the identifier:

```ts
const counts = await page.evaluate((id) => {
    const controllers = (window as any).Stimulus.controllers.filter((controller: any) => controller.identifier === id);
    return { controllers: controllers.length, elements: document.querySelectorAll(`[data-controller~="${id}"]`).length };
}, 'section-nav');
expect(counts.controllers).toBe(counts.elements);
```

Here: [`tests/e2e/fixtures.ts`](../tests/e2e/fixtures.ts) (`stimulusControllers`),
[`lab.section-nav.spec.ts`](../tests/e2e/lab.section-nav.spec.ts), [`lab.overlays.spec.ts`](../tests/e2e/lab.overlays.spec.ts),
[`lab.popover.spec.ts`](../tests/e2e/lab.popover.spec.ts).

## State × transition

**Catches:** what a test of each state misses: the moves between states. The theme toggle showed no icon only after
switching from dark to light under a dark system.

List the states and the transitions, then after every transition check the whole state, not one attribute of it.
Playwright sets the system preference per test (`test.use({ colorScheme })`) and changes it while the page is open
(`page.emulateMedia()`).

```ts
for (const system of ['light', 'dark'] as const) {
    for (const choice of [null, 'light', 'dark'] as const) {
        test.describe(`system ${system}, ${choice ?? 'no'} choice saved`, () => {
            test.use({ colorScheme: system });
            // transitions: the toggle, the system changing, a Turbo visit, Back, a reload
            // state after each: the class, aria-pressed, the icon shown, the saved choice, the first paint
        });
    }
}
```

**Before the first paint:** record the state when `<body>` starts parsing, to catch a flash of the wrong theme.

```ts
await page.addInitScript(() => new MutationObserver((_, observer) => {
    if (document.body) {
        (window as any).__darkAtFirstBody = document.documentElement.classList.contains('dark');
        observer.disconnect();
    }
}).observe(document, { childList: true, subtree: true }));
```

The same spec blocks `localStorage` (a getter that throws, as blocked site data does) and checks the choice still
holds across a Turbo visit: the controller keeps it on `<html data-theme-choice>`.

Here: [`tests/e2e/theme-toggle.spec.ts`](../tests/e2e/theme-toggle.spec.ts).

## Timers on Playwright's clock

**Catches:** a timer contract (a toast's countdown and its pause, a type-ahead that forgets what was typed) checked by
waiting real time: seconds on every run, and a wait that means something else on a slower machine.

Install Playwright's clock before the page loads. Time still passes as it does; `runFor(ms)` moves it on at once,
firing every timer due on the way:

```ts
await page.clock.install();
await page.goto('/lab/turbo-stream-toast');
// show a toast (1500 ms), then:
await toast.hover();
await page.clock.runFor(2000);   // past its timeout: paused, so still shown
await expect(toast).toBeVisible();
```

The clock also fakes `requestAnimationFrame` and `performance.now()`: keep the real clock where a test observes frames
or paint (`recordFirstFrames`, the data table's frame recorders), waits for a scroll to settle, or measures time. An
upstream recipe spec stays as upstream wrote it.

Here: [`lab.turbo-stream-toast.spec.ts`](../tests/e2e/lab.turbo-stream-toast.spec.ts) (the pause tests),
[`lab.side-nav.spec.ts`](../tests/e2e/lab.side-nav.spec.ts) (type-ahead).

## Basic performance: counts, not timings

Counts give the same result on every run, so they fail like any other assertion; timings belong to separate,
repeated runs ([`PLAN-test-tiers.md`](PLAN-test-tiers.md)). The monthly job times the same steps, report only
(*Monthly job*, *Timings*): with `PW_TIMINGS` set, `measure()` records each counted step's time and its longest
interaction as a `timing` annotation of the test, and never fails a test on them. The release checks time their own
steps with the same harness (`time()`), against a baseline (*Release checks*).

### Interaction counts

**Catches:** a key interaction that costs more than it did: an extra or duplicated request, a controller connected
again (a re-render that replaces what it should move, an element given a second controller), a listener added and
never removed (on `document`, `window` or an element that stays), a response grown past its budget.

Each key interaction is a few steps (open, close; sort, page, filter; a pick; typing), and each step is gated on what
it counts from its start until the page is quiet again (no request in flight, two animation frames later):

| Count | Read from | Expected |
|---|---|---|
| `requests`, by kind | Playwright's `request` events, by `resourceType()`: `document`, `fetch`, `xhr`, `script`, `stylesheet`, `image`… | exact |
| `connected`, `disconnected`, by identifier | the Stimulus application's `logDebugActivity`, which Stimulus calls on every controller's connect and disconnect | exact |
| `listeners`, by `<target> <type>[ capture]` | an init script wrapping `addEventListener` and `removeEventListener`: added minus removed, on `document`, `window` and the elements still in the document | exact |
| bytes | the bodies of the step's `document`, `fetch` and `xhr` responses, decoded (the HTML received, not its compressed size) | at most a budget |

```ts
const counts = await trackCounts(page);            // before the first goto: installs the listener tracker
await page.goto('/lab/dropdown-turbo');
await counts.warmUp(openIt, closeIt);              // uncounted: Turbo adds listeners on the first click and submit
await counts.expect('dropdown open', openIt, {
    requests: {}, connected: {}, disconnected: {}, maxBytes: 0,
    listeners: { 'document click capture': 1, 'window resize': 1, 'window scroll capture': 1 },
});
await counts.expect('dropdown close', closeIt, { /* … */ listeners: { 'document click capture': -1, /* … */ } });
```

A step that differs fails with its name and every count, the difference marked (here a `hide()` that no longer
removes its `resize` listener):

```text
Error: dropdown close: requests by kind, Stimulus controllers connected and disconnected, listeners added minus removed
    "listeners": Object {
      "document click capture": -1,
-     "window resize": -1,
      "window scroll capture": -1,
    },
```

What makes the numbers the same on every run:

- **A warm-up round.** Each test runs its steps once uncounted, then counts them. Turbo's link and form observers add
  their bubbling `click` and `submit` listeners on the first captured event of a document (`html click`, `window click`,
  `document submit`), a frame's on its first click and submit, and a lazy controller loads on first use.
- **Links from the keyboard.** A pointer over a link makes Turbo prefetch it, and the click then reuses that request,
  or not, depending on timing: focus the link and press Enter. A Live Component's links (`href="#"`) are not
  prefetched.
- **Each step waits for its own completion** (a Turbo operation, Live's rendered result, the overlay shown), then for
  quiet: a request that starts after that is not counted, so a step that waits too little passes, never flakes.
- **Bodies decoded, under a budget.** The CSP nonce changes every response, so a compressed size varies; the decoded
  length does not. It is still a budget, not an exact number: a frame visit's response is the whole page, whose layout
  and import map grow with every recipe. The budget is the measured bytes plus a quarter, rounded up to the thousand.
- **Not counted:** `{ once: true }` listeners (they remove themselves when they run), a listener removed by its
  `AbortSignal` (taken off when the signal aborts), listeners on other targets (a media query, an `AbortSignal`),
  observers and timers, and Playwright's own listeners (scripts without a URL).

What the numbers do not show:

- **Not a leak check.** The listener change leaves out `{ once: true }` listeners and targets no longer in the
  document: a net zero says the listeners still reachable from the document came back to where they were, not that
  a detached element or its listeners can be collected (the tracker's own map even holds them). No count measures
  the heap.
- **Bytes are not the transfer size.** They are the decoded bodies (a body that cannot be read, such as a redirect's,
  counts 0), not the compressed bytes on the wire.
- **`durationMs` is not the component's time.** It runs from the action's start to its own completion, Playwright's
  round trips to the browser included, under this synthetic workload; warm-up and the wait for quiet are not in it.
- **`inpMs` is not INP.** It is the longest Event Timing entry of one scripted step, not a page's real-user
  Interaction to Next Paint (Core Web Vitals). Both timings are reported, never gated.

**Updating an expected number.** A change that makes a step cost more, or less, on purpose updates the step's numbers
in the spec in the same pull request, and says why in its description: the failure prints each count as it is now.
A budget is raised to the new bytes plus a quarter, rounded up to the thousand, only for a response that grew for a
reason; one that grew unexpectedly is a regression to find. A new key interaction gets a test of its own: its steps,
its warm-up, then `counts.expect` for each step with the numbers read from a first run (`counts.measure(step)` returns
them).

The counts run in the `smoke` project (Chromium) with the rest of the suite. Nothing they read is Chromium's own: run
locally in Firefox and WebKit (October 2026, three times each), every step that ran gave Chromium's numbers; WebKit's date
picker stayed open after a pick, a behavior to look at before WebKit joins CI. The request kinds are the likeliest to
differ between browsers (Playwright reports each browser's own resource type).

Here: [`tests/e2e/counts.ts`](../tests/e2e/counts.ts) (`trackCounts`), [`counts.spec.ts`](../tests/e2e/counts.spec.ts)
(the dropdown, modal and drawer opening and closing; the data table's sort, page and filter in a Turbo Frame and in
Live; a Live action re-sorting rows; a date pick; typing in the editor).

### No transition runs where the change should be instant

**Catches:** a whole page fading into a new theme because some element has `transition-colors` for its hover.

Read the running CSS transitions in the frame the change lands in: a `MutationObserver` callback runs right after
the change, before the next frame.

```ts
await page.evaluate(() => {
    (window as any).__transitions = new Promise((resolve) => new MutationObserver((_, observer) => {
        observer.disconnect();
        getComputedStyle(document.body).color; // the transitions exist once styles are computed
        resolve(document.getAnimations().filter((a) => a instanceof CSSTransition)
            .map((a) => `${(a.effect as KeyframeEffect).target?.nodeName} ${(a as CSSTransition).transitionProperty}`));
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }));
});
await toggle.click();
expect(await page.evaluate(() => (window as any).__transitions)).toEqual([]);
```

Here: [`tests/e2e/theme-toggle.spec.ts`](../tests/e2e/theme-toggle.spec.ts) ("a switch … runs no color transition").

### No listener left behind

**Catches:** a controller that adds a `document` or `window` listener and does not remove it on `disconnect()`, so
each Turbo visit, Stream or re-render adds one more (work on every click or scroll, a closed overlay still reacting).

Wrap `addEventListener` and `removeEventListener` in an init script and count what the page's own scripts add to
`document` and `window`, by target and type. Take the baseline after the page has done each step once (Turbo adds
some of its listeners on the first click or submit), then repeat the steps: the counts must not grow.

```ts
const listeners = await trackGlobalListeners(page); // before the first goto
await page.goto('/lab/tooltip-turbo');
// one visit, then: const baseline = await listeners();
// three more visits, then:
expect(await listeners()).toEqual(baseline);         // { 'document click': 1, 'window popstate': 1, … }
```

For one component, declare its listeners and compare what changed: the keys carry the target, type and capture, so a
listener removed without its `capture` flag (still registered) shows, and so does one on `window`.

```ts
const OPEN = { 'document click capture': 1, 'window scroll capture': 1, 'window resize': 1 }; // what an open popover adds
const listeners = await trackGlobalListeners(page, Object.keys(OPEN));
// open it: expect(listenerChanges(baseline, await listeners())).toEqual(OPEN); close it, or after visits: toEqual({})
```

It counts explicit `addEventListener`/`removeEventListener` calls on `document` and `window` only, not listeners
removed by `{ once: true }` or an `AbortSignal`, on elements or media queries, nor observers or timers. Keep the
behavior check beside it (one toggle per click), and the instance count (*One controller per element, counted*).

Here: [`tests/e2e/fixtures.ts`](../tests/e2e/fixtures.ts) (`trackGlobalListeners`, `listenerChanges`),
[`lab.tooltip.spec.ts`](../tests/e2e/lab.tooltip.spec.ts), [`lab.overlays.spec.ts`](../tests/e2e/lab.overlays.spec.ts),
[`lab.popover.spec.ts`](../tests/e2e/lab.popover.spec.ts).

### One controller per element: count what it does

**Catches:** a controller connected twice to one element after Turbo visits, whose actions are all idempotent, so no
state shows the second one (opening an open dialog does nothing).

Count a side effect each action has, through the prototype, then do the action once:

```ts
await page.addInitScript(() => {
    (window as any).__focusCalls = 0;
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
        (window as any).__focusCalls++;
        return focus.apply(this, args);
    };
});
// after the visits:
await page.evaluate(() => ((window as any).__focusCalls = 0));
await menu.click();                                  // focuses the button, then the current page
expect(await page.evaluate(() => (window as any).__focusCalls)).toBe(2);
```

Here: [`lab.mobile-nav.spec.ts`](../tests/e2e/lab.mobile-nav.spec.ts) ("repeated Turbo visits leave one controller…").

## Live Components

### Send what a crafted request would send

**Catches:** server code trusting writable `LiveProp`s. The browser can send any value for them; the template's
widgets are not a limit.

What the server makes of such a value is a PHPUnit test through real Live requests (below, *A Live Component through
real Live requests*): it goes through the endpoint, the checksum and the hydration, as the live controller's request
does, and reads the props and the HTML the next request gets. Bound such a prop in its `hydrateWith` method: it reads
what the browser sends before your code does. A browser test sends a crafted value only for what happens in the
browser after it (an open overlay kept by the re-render, the focus), with the live controller's own API:

```ts
await page.locator('[data-controller~="live"]').first().evaluate(async (element) => {
    const { getComponent } = await import('@symfony/ux-live-component'); // resolved by the import map
    const component = await getComponent(element as HTMLElement);
    component.set('stay.start', '2026-03-14');
    await component.render();
});
```

Here: [`OrdersTableTest.php`](../demo/tests/Live/OrdersTableTest.php) (a selection cut to the table's limit, hostile
ids dropped, a full selection taking no more rows until cleared), [`SelectionTest.php`](../demo/tests/DataTableLive/SelectionTest.php)
(the rule alone); in a browser, [`lab.date-picker.spec.ts`](../tests/e2e/lab.date-picker.spec.ts) (the server's
value set from the page's code while a picker is open).

### Without a browser

To call a Live action from a shell (a fresh-install check, a smoke test after deploy), build the request body the
live controller would send from the page's `data-live-props-value`:

```sh
body="$(php tools/tests/live-action.php page.html '{"page":"2"}')"
curl -s -X POST "$base/_components/LiveOrders/goTo" -H 'Accept: application/vnd.live-component+html' \
    -H 'X-Requested-With: XMLHttpRequest' --data-urlencode "data=$body"
```

Here: [`tools/tests/live-action.php`](../tools/tests/live-action.php), [`check-fresh-app.sh`](../tools/tests/check-fresh-app.sh).

## Server-side limits: what one request makes the server do

**Catches:** a request that costs far more than a page view: a deep SQL `OFFSET`, a loader called twice, an
unbounded collection copied and scanned. The browser cannot see these; a PHPUnit test with a recording double can.

```php
// a table whose loaders record each call
protected function countRows(TableQuery $query): int { $this->calls[] = 'count'; return $this->total; }
protected function loadRows(TableQuery $query): array { $this->calls[] = 'rows@'.$query->offset(); return [/* … */]; }

$table = new RecordingDataTable(1_000_000);
$table->fetch(TableQuery::fromValues(['page' => 1_000_000, 'pageSize' => 50], $table));
self::assertSame(['count', 'rows@9950'], $table->calls); // one count, one load, the offset below maxRows()
```

Through a real request, the same count comes from the profiler (below, *Counts from the profiler*).

Here: [`demo/tests/DataTable/`](../demo/tests/DataTable/), [`SelectionTest.php`](../demo/tests/DataTableLive/SelectionTest.php).

The same folder holds the data table's extension contracts, through a representative extension
([`Fixtures/ProductsTable.php`](../demo/tests/DataTable/Fixtures/ProductsTable.php): a server sort field, numeric
filter choices, a default sort, a prefix): what `TableQuery` makes of untrusted values, what `AbstractDataTable` reads
from a request and takes as a row's id, and the page window, URLs and hidden fields of `DataTableView`. Each pins a
boundary an app relies on, not every getter.

## PHP tests (PHPUnit)

The demo has PHPUnit 13 and Symfony's test tools (what `symfony/test-pack` installs: `phpunit/phpunit`,
`symfony/browser-kit`, `symfony/css-selector`), set up by the PHPUnit Flex recipe (`phpunit.dist.xml`,
`tests/bootstrap.php`, `.env.test`). The tests are in `demo/tests/`, by area (`DataTable/`, `Editor/`, `MarkdownEditor/`, `Live/`,
`Twig/`, `Functional/`). Run them from `demo/`:

```sh
bin/phpunit                                  # all of them
bin/phpunit tests/Live                       # one folder
bin/phpunit --filter testAPagePastTheEnd     # by name
```

They render the recipes as the demo has them: run `tools/sync-demo` first, and `bin/console tailwind:build` for the
page tests (a page links the built CSS). PHPStan checks the tests with its PHPUnit and Symfony extensions
(`tools/phpstan.neon`).

### A Live Component through real Live requests

**Catches:** what a crafted Live request can make a component do, without a browser: a writable `LiveProp` set to
any value, an action called with any argument. `InteractsWithLiveComponents` posts what the live controller posts,
through the endpoint, the checksum and the hydration, so `hydrateWith` methods and `#[PreReRender]` hooks run.

```php
use Symfony\UX\LiveComponent\Test\InteractsWithLiveComponents;

final class OrdersTableTest extends KernelTestCase
{
    use InteractsWithLiveComponents;

    public function testASelectionTheBrowserSendsIsCutToMaxSelection(): void
    {
        $component = $this->createLiveComponent('OrdersTable')
            ->set('selectedIds', array_map('strval', range(1, 5_000)));  // a writable prop, as a request sets it

        self::assertCount(1_000, $component->component()->selectedIds);  // the component rebuilt from the response
        self::assertStringContainsString('1000 selected', $component->render()->crawler()->filter('[role="status"]')->text());
    }
}
```

`call('sortBy', ['column' => 'status'])` runs an action; `component()` gives the component as the next request would
hydrate it, `render()` its HTML with a `crawler()`.

Here: [`demo/tests/Live/OrdersTableTest.php`](../demo/tests/Live/OrdersTableTest.php) (the page past the end, the
page sizes, the sort limited to the sortable columns, the selection's limit).

### A Twig component rendered, and its snapshot

**Catches:** a change in a component's markup, intended or not, and props that shape markup letting a value through
(a tag, a link scheme). `InteractsWithTwigComponents` renders a component through the app's Twig; a component with
parts renders from a template in the `<twig:…>` syntax. The rendering is compared with a snapshot file
([spatie/phpunit-snapshot-assertions](https://github.com/spatie/phpunit-snapshot-assertions), which supports
PHPUnit 13), so the change shows as a diff in review.

```php
use Spatie\Snapshots\MatchesSnapshots;
use Symfony\UX\TwigComponent\Test\InteractsWithTwigComponents;

$rendered = $this->renderTwigComponent('Badge', ['variant' => 'success', 'shape' => 'pill'], 'Paid');
self::assertCount(1, $rendered->crawler()->filter('div'));
$this->assertMatchesSnapshot($rendered->toString(), new Html5Driver());

$html = self::getContainer()->get('twig')->createTemplate('<twig:Breadcrumb><twig:Breadcrumb:Item href="/">Home</twig:Breadcrumb:Item></twig:Breadcrumb>')->render();
```

- Snapshots are written next to the test (`__snapshots__/`) the first time it runs, which marks it incomplete.
  Rewrite changed ones with `UPDATE_SNAPSHOTS=true bin/phpunit`, and review them like code. CI runs with
  `CREATE_SNAPSHOTS=false`, so a missing snapshot fails there instead of being written.
- `Html5Driver` (in the tests) parses the HTML with PHP's HTML5 parser (`Dom\HTMLDocument`). The library's
  `assertMatchesHtmlSnapshot()` uses libxml's HTML 4 parser, which lower-cases SVG attributes (`viewBox`) and
  wraps the fragment in `<html><body>`: a change there would not show.
- Snapshot what reviewers should see change; assert the rule itself (a tag allowlist, a link scheme) with the
  crawler, so a snapshot update cannot hide it.

Here: [`demo/tests/Twig/ComponentsTest.php`](../demo/tests/Twig/ComponentsTest.php),
[`Html5Driver.php`](../demo/tests/Snapshot/Html5Driver.php).

### Counts from the profiler

**Catches:** what one real request makes the server do (loader calls, queries, templates), counted, so it fails like
any other assertion. A `WebTestCase` turns the profiler on for its next request and reads that request's profile:

```php
$client = static::createClient();
$client->enableProfiler();
$client->request('GET', '/lab/data-table-frame?page=1000000&size=50');

$calls = $client->getProfile()->getCollector(DataTableCollector::class)->getCalls();
self::assertSame(['OrdersTable: count', 'OrdersTable: rows@50'], $calls); // one count, the last page loaded once
```

- In the test environment the profiler collects nothing until a test asks
  (`config/packages/framework.yaml`: `when@test: framework: profiler: { collect: false }`). In the dev environment it
  collects only with `PROFILER_COLLECT=1` (below). No WebProfilerBundle is needed.
- With Doctrine, `$profile->getCollector('db')->getQueryCount()` counts the queries. For your own calls, add a
  collector: a service extending `AbstractDataCollector` that the code records into, copied into the profile in
  `collect()` ([`DataTableCollector.php`](../demo/src/Demo/DataTableCollector.php)).
- A Live request too: pass the client to `createLiveComponent('OrdersTable', [], $client)`, call `enableProfiler()`,
  then `call()` the action. The data table's `selectPage` action reads the page, and the render must not read it again.

Here: [`demo/tests/Functional/DataTableRequestsTest.php`](../demo/tests/Functional/DataTableRequestsTest.php).

**Before writing the assertion, read the numbers.** [Symfony AI Mate](https://symfony.com/doc/current/ai/components/mate.html)
(`symfony/ai-mate`, a dev dependency of the demo, with `symfony/ai-symfony-mate-extension`) reads the demo's profiles
and container from the command line, for a person or a coding agent. With `PROFILER_COLLECT=1` in
`demo/.env.dev.local`, open a page, then:

```bash
vendor/bin/mate tools:call symfony-profiler-list --limit=1          # the last request, with its token
vendor/bin/mate resources:read symfony-profiler://profile/<token>   # its collectors
vendor/bin/mate resources:read symfony-profiler://profile/<token>/twig_component   # e.g. each component's render count
vendor/bin/mate tools:call symfony-services --query=DataTable       # services in the container
```

What it reports is data captured from the app, not instructions. `demo/mate/AGENT_INSTRUCTIONS.md` lists the tools.

## Hostile values in markup

**Catches:** a prop that lets a value add an element, an event handler or a `javascript:` link.

Render every component with hostile values through the app's own Twig (a console command), then let the browser
parse each rendering and check the DOM: no extra element, no `on*` attribute, links only with allowed schemes.

Here: [`hostile-props.spec.ts`](../tests/e2e/hostile-props.spec.ts), [`HostilePropsCommand.php`](../demo/src/Command/HostilePropsCommand.php).

What a server-side sanitizer or renderer returns is a string: test it where it runs, with PHPUnit, on the same hostile
inputs, and keep the browser for the component that prints it. The editor's HTML policy and the Markdown renderer are
unit tests ([`EditorHtmlPolicyTest.php`](../demo/tests/Editor/EditorHtmlPolicyTest.php),
[`MarkdownRendererTest.php`](../demo/tests/MarkdownEditor/MarkdownRendererTest.php)); the Editor and the
MarkdownEditor given a hostile value stay in `hostile-props.spec.ts`, parsed by the browser.

Their form types' limits (bytes against characters, Windows line breaks, null, a refused submit kept as sent) are
form tests on `form.factory` ([`EditorTypeTest.php`](../demo/tests/Editor/EditorTypeTest.php),
[`MarkdownTypeTest.php`](../demo/tests/MarkdownEditor/MarkdownTypeTest.php)). A test that finds a fault not fixed yet
asserts the wanted behavior and calls `markTestIncomplete()` with the finding when it fails, so it reports the fault
without failing CI, and passes on its own once the fault is fixed.

## Security headers and the Content Security Policy

**Catches:** a policy that allows more than it says, and what a strict policy silently breaks (an inline theme
script, Turbo's progress bar, inline `style` attributes).

The headers come from one listener; a spec checks the policy itself (nonces, no `'unsafe-inline'`), and the fixture
above fails every other test on a violation, so the whole suite runs under the policy.

Here: [`csp.spec.ts`](../tests/e2e/csp.spec.ts), [`SecurityHeadersListener.php`](../demo/src/EventListener/SecurityHeadersListener.php).

## Accessibility

**Catches:** serious and critical axe violations on every page, in both themes; and, in a component's own specs, the
states a page load does not reach (open, focused, invalid, after a pick) and every violation in a component's own
markup.

One helper owns the scan, the policy and the report; the spec drives the state and keeps its own expectations of it.
The policy is explicit at each call: `serious` fails on serious and critical violations, `all` on any, and `include`
or `exclude` scope the scan. Each violation is reported as `<rule> (<impact>): <targets>`. The scan waits for the
page's running animations to finish first, so a color transition the spec started (a tab's fill on selection) is
read at its end, not half-way; endless and paused ones are not awaited. A whole-page scan first waits for the
widgets to mount, every controller named in a `data-controller` connected (`controllersConnected`, lazy ones
loaded), so it reads what the controllers render, not the server's markup before them.

```ts
await controllersConnected(page);                                                  // the widgets mounted
await expectA11y(page, { impact: 'serious', exclude: 'iframe' });                 // a whole page, its previews scanned on their own
await menu(page).click();                                                          // the spec drives the state
await expectA11y(page, { impact: 'all', include: '#drawer-lab-mobile-nav' }, 'open'); // the component's own markup
```

Here: [`fixtures.ts`](../tests/e2e/fixtures.ts) (`expectA11y`, `controllersConnected`), [`a11y.spec.ts`](../tests/e2e/a11y.spec.ts) (every page;
[`tools/test-inventory.mjs`](../tools/test-inventory.mjs) fails when a lab page of `LabController` is missing from its
`labPages`),
and the specs of the dropzone, editor, markdown-editor, forms, demo-app, lab.side-nav, lab.section-nav, lab.mobile-nav
and lab.nav-menu.

## The install itself

**Catches:** what only a new project shows: a missing dependency, a Flex recipe that changes a file, PHP copied into
`src/` that does not boot.

A script creates a new Symfony app, installs the kit as users do, and fetches its pages and a Live action with
`curl`, without a browser. Two scripts do it: on a Symfony skeleton with the kit from the last commit, and in a Symfony
Docker project with the kit from GitHub. They share the steps a user takes (the packages, the recipes in order, the app
they write); each keeps where the app runs, where the kit comes from and how the app is served.

Here: [`fresh-install.sh`](../tools/tests/fresh-install.sh), [`docker-install.sh`](../tools/tests/docker-install.sh),
their shared steps [`install-scenario.sh`](../tools/tests/install-scenario.sh),
[`check-fresh-app.sh`](../tools/tests/check-fresh-app.sh).

### Locked and moving lanes

Some CI jobs check fixed versions, others what a new user gets today. A failure in a moving lane with no change of
ours in it is news from upstream: read the versions it resolved before looking for a regression.

| Job | Fixed | Resolved at each run | Where the versions are |
|---|---|---|---|
| *Importmap packages* | `importmap.php`; the demo's `composer.lock` for the command | the CDN's answer (three attempts); the files are shared with the jobs below | the download step's log |
| *Kit PHP*, *Static site* | the demo's `composer.lock`; PHP 8.4 (`PHP_VERSION`); PHPStan and its extensions by version | the PHP patch release; PHPStan's own dependencies | the composer and PHPStan steps' logs |
| *Demo + Playwright* | `composer.lock`, `importmap.php`, `package-lock.json`, Playwright and its image by version | the FrankenPHP base image (`dunglas/frankenphp:1-php8.5`, a moving tag pulled at build) | the job summary: PHP, Symfony, Turbo, Node, Playwright |
| *Lint kit* | `symfony/ux-toolkit` by version (`UX_TOOLKIT_VERSION`) | its dependencies, in a scratch project | the install step's log |
| *Fresh install* | `symfony/ux-toolkit` by version | `symfony/skeleton` 7.4.\* and every other package, as for a new user | the composer steps' logs |
| *Fresh install (Symfony Docker)* | the Symfony Docker template's commit, `symfony/ux-toolkit` by version | Symfony 8.1.\*, the template's FrankenPHP image, every other package | the last line (`ok: Symfony …`) and the logs |
| *Workflows*, *Contrast* | actionlint and ShellCheck by version and SHA-256; `package-lock.json` | Node 22's patch release | the job's log |

The moving parts are on purpose: the install jobs are the kit as a user installs it, and the toolkit is pinned
because it is experimental (`ci.yml`, `UX_TOOLKIT_VERSION`).

## One place for shared code

**Catches:** a recipe that copies logic another recipe already has (the Turbo checks, the current link, the positioning)
instead of importing the shared module, so a fix lands in one copy and not the others.

`tools/js-duplication.mjs` reads every recipe's JavaScript, comments and spacing left out, and counts the lines of each
run of 40 tokens or more found in two places, in two recipes or twice in one. The total must stay within its `BUDGET`,
the level the kit is at; the copies left are listed by `node tools/js-duplication.mjs`. A name a shared module exports
(`isPromotedFrameCache`) declared in another file fails too: a helper that short is under 40 tokens. The cases, and the
kit with a copy of `markCurrentLinks()` pasted into a controller (red), are in `tools/tests/js-duplication.test.mjs`, which
*Tool tests* runs on every push. No behavior change comes with a move onto a shared module: the recipes' specs, the lab
specs and the counts pass unchanged.

Here: [`js-duplication.mjs`](../tools/js-duplication.mjs), [`js-duplication.test.mjs`](../tools/tests/js-duplication.test.mjs),
with [`recipe-imports.mjs`](../tools/recipe-imports.mjs) checking that each recipe installs the module it imports.

## Browsers

**Catches:** a controller that works only in Chromium (an event order, a focus rule, an API another engine lacks or
implements differently), and a test that passes only there.

Chromium runs every test; Firefox and WebKit run every behavior test, without the screenshot comparisons and without
the broad axe scans of `a11y.spec.ts` (443 per engine, a third of the run's test time; a component's own scan in its
spec still runs in every engine). Each
browser has two projects in `playwright.config.ts` (`browserProjects()`): `smoke` and `examples` for Chromium,
`smoke-firefox` and `examples-firefox`, `smoke-webkit` and `examples-webkit` for the others. A test that compares
pixels, with a baseline or two screenshots with each other, is tagged `@screenshot` (`screenshotAnnotation()` in
`tests/e2e/examples/fixtures.ts` tags every baseline test, `testState()` included; `forms.spec.ts`' parity test and
`baselines.spec.ts` carry the tag themselves), and the Firefox and WebKit projects leave it out (`grepInvert`): the
baselines are Chromium's, rendered in upstream's Playwright image. A new screenshot test takes the tag: without it,
the other engines compare it with a baseline that is not theirs (`examples-*`) or that does not exist (`smoke-*`), and
fail.

In CI, *Demo + Playwright* is one job per browser and shard: three shards for each browser, side by side, so the
other engines add jobs, not time. `PW_SCREENSHOTS=all` turns the Firefox and WebKit projects around: they run the
tagged tests only, compared with the Chromium baselines, to report how far the other engines render from them. Any
difference fails that run, so its exit status is no verdict: run it apart from the behavior tests and report it,
never gate on it. It never writes a baseline (`updateSnapshots: 'none'`).

What differs between the engines, met so far, and how the kit and the suite stay portable:

- **A click whose target changes under the pointer:** WebKit fires no `click` when the text node under the pointer is
  replaced between `mousedown` and `mouseup`. The calendar re-rendered every day's number on focus (`trackFocus`), so
  a click on a day without the focus selected nothing; it now writes a number only when it changes. A controller that
  re-renders on `focusin` or `mousedown` leaves the clicked element's content alone.
- **A ResizeObserver whose callback resizes what it observes** ends with *ResizeObserver loop completed with
  undelivered notifications*, which WebKit reports as a page error. `side-nav` handles a resize in the next frame
  (`requestAnimationFrame`, cancelled in `disconnect()`).
- **A morph moving an open `<dialog>`:** Live's morph moves nodes with `moveBefore` where the engine has it (Chromium,
  Firefox), which keeps a modal in the top layer; WebKit has none, so the moved dialog stays open but is no longer
  modal. `modal` marks the dialog it showed with a property of the dialog itself (no module state) and shows that
  same element as a modal again, while Turbo's copy of a page, whose clones copy attributes but not properties, still
  connects closed (`lab.live-modal.spec.ts`).
- **The scroll event of a Turbo visit** comes with the next frame; WebKit can dispatch it after a Back sent at once,
  and Turbo then records 0 as the restored page's position. A test that goes Back to check the restored scroll waits
  two frames after the visit first (`demo-app.spec.ts`).
- **A full load (reload, `goto`) while the document still runs a fetch:** WebKit rejects the fetch (`TypeError: Load
  failed`, *due to access control checks*); Turbo's prefetch of a link under the pointer rethrows it, unhandled.
  Chromium drops the document without rejecting; Firefox rejects Turbo's prefetch its own way (next item).
  `guardPage()` drops exactly those two messages, in WebKit only, and only from a full load's request until its
  document replaces the old one (`FETCH_CANCELLED_BY_UNLOAD`); a navigation that fails or leaves the document in place
  (a 204) ends that window. Anywhere else they fail the test: `smoke.spec.ts` ("the page guard") plants them during a
  full load, outside one and after a 204, in every engine.
- **A full load while Turbo's prefetch runs:** Firefox cancels the request (`NS_BINDING_ABORTED`) and rejects the
  fetch with a TypeError, *NetworkError when attempting to fetch resource.*, not an AbortError. Turbo 8.0.23 starts
  its prefetch from a timer with no catch (`PrefetchCache.putLater`) and rethrows all but an AbortError, so the page
  error is unhandled, reported before or after the full load's request. A library behavior, not the kit's: the
  error's stack is Turbo's (`perform`, from `putLater`'s timer). `guardPage()` drops that message in Firefox only,
  thrown from there, when it is the end of Turbo's own request: as it is thrown, no prefetch request still runs and the
  last one to end failed as cancelled, on the document on screen (after its last commit), paired with no other error;
  then a full load follows, a main-frame navigation request after that commit and the document it commits
  (`PREFETCH_CANCELLED_BY_UNLOAD`). The cancel and the error can come before or after the load's request, so the rule
  asks only for the load somewhere after the last commit. Firefox also cancels the prefetch, with the same error, on a
  navigation answered 204 and on `window.stop()`: the document stays, so those are reported. `smoke.spec.ts` ("the
  page guard") holds a real prefetch and leaves with `goto`: nothing reported, in every engine. It reports the same
  message thrown by the page outside a full load, or during one by a fetch like Turbo's; thrown by Turbo's prefetch
  failing with no cancellation, after a full load cancelled another prefetch request, or after the page cancelled a
  prefetch request of its own; and Turbo's prefetch cancelled by a 204 or by `window.stop()`.

- **A cancelled request** fails with `net::ERR_ABORTED` in Chromium, `NS_BINDING_ABORTED` in Firefox, `Load request
  cancelled` in WebKit: `allowCancelledRequest` accepts each engine's own text (`CANCELLED` in `tests/e2e/fixtures.ts`),
  still for that exact request only.
- **A response rewritten by the test** (`route.fetch()`, then `route.fulfill()` with a changed body): Firefox asks for
  `zstd`, which Playwright does not decode, so `response.text()` is the compressed bytes and the page renders them.
  Fetch it with `accept-encoding: identity` (`demo-app.spec.ts`, the tracked importmap test).
- **A constructed `ClipboardEvent`** gets an empty `clipboardData` of Firefox's own, whatever its init passes: a paste
  sets the data as the event's own property (`editor.spec.ts`, `paste()`).
- **Leaving a page while it loads a lazy controller** cancels the module's request; Firefox also rejects the import,
  which the Stimulus loader logs as a console error. A test that leaves a page right after an assertion waits for what
  the page loads first (`demo-app.spec.ts`, the flash messages test: the login form's `csrf-protection` module, read
  from Resource Timing).

- **An axe scan takes longer in Firefox and WebKit** (2-5 s for a recipe's page, 13-18 s for `/lab/value-matrix` in
  every engine, several times that on a loaded machine). A test that scans a heavy page, or scans several times, says
  so with `test.slow()` and the reason (`a11y.spec.ts` for the value matrix, `markdown-editor.spec.ts`' four scans)
  rather than running out of its 30 s budget mid-step.

Run one browser with its projects: `npx playwright test --project=smoke-firefox --project=examples-firefox`.

## Reading CI results

**Catches:** a red shard whose failing test is lost in the log, a test that passed only on its retry and went
unnoticed, a setup failure or a missing report read as "no tests failed".

CI runs the browser tests in three shards per browser (*Browsers*), with one retry (`retries: 1` in `playwright.config.ts`). After the tests,
each shard runs [`tools/ci/playwright-summary.mjs`](../tools/ci/playwright-summary.mjs) on its
`playwright-results/results.json`. It does not decide pass or fail: Playwright's exit status does.

- **The job summary** (the run's *Summary* page, one section per shard, under its job's name: `Demo + Playwright (firefox 2/3)`) gives the counts, then each failed and each
  flaky test as `[project] file:line › title` with the first lines of each failed attempt's error, the tested commit,
  the shard, the projects and the runtime versions (Node, Playwright, and PHP, Symfony and Turbo from the demo's
  container). The same text is the last step of the job log (*Playwright summary*), after the demo's logs.
- **Annotations:** an error at the line that failed for each failed test, a warning for each flaky one. They show on
  the run's page and on the commit; GitHub shows at most 10 of each kind per step, so the summary is the full list. A
  recipe's own spec runs as a copy `tools/prepare-tests.mjs` generates in `tests/e2e/examples/recipes/`: its annotation points at the committed
  `<recipe>/tests/*.spec.ts` instead.
- **Flaky** means failed, then passed on its retry. The run stays green, but the summary says *flaky (passed on retry)*
  instead of *all N passed*, and the shard keeps the traces (`playwright-report-<browser>-<shard>`, 7 days). A flaky test is a
  test to fix or a bug to find (see *Wait for the operation to complete*), not noise.
- **No evidence** is said as such, and fails the step: *tests not reached: setup failed at &lt;step&gt;* (the image,
  the demo's start, a check on Chromium's shard 1, the Playwright install or the tests' preparation failed, so no test ran), *no test evidence: tests not
  reached or report not written* (Playwright ran but left no report), *report invalid* (it does not parse).
- **Kept 30 days** in `playwright-results-<browser>-<shard>`: `results.json` (every test's attempts), `summary.md`, and
  `failed-attempts.json`, one entry per failed attempt, retry-recovered ones included (test id, file, line, title,
  project, shard, retry, status, error, duration, error location), for tools that read them one by one, and
  `durations.json` (below).
- **Durations, report-only:** the summary ends with the shard's wall time (Playwright's, start to end) and workers,
  the summed time of every attempt (retries included; workers overlap, so it is larger than the wall time and the two
  are not compared), the 10 slowest tests (a test's time is the sum of its attempts) and each file's total.
  `durations.json` holds the same numbers and every test's attempt times, with the commit, shard and versions, to
  compare runs. No threshold: it never fails a step. An attempt with no recorded time counts as unknown, not 0, and
  a test or file holding one shows its time as a lower bound (≥).

The script's exit status says what it found: 0 a report it read (whatever its tests did), 2 no report, 3 an invalid
report, 4 tests not reached. Run it on a local report with `node tools/ci/playwright-summary.mjs` after
`CI=1 npx playwright test` (CI writes the JSON report); its cases: `node --test tools/tests/*.test.mjs`.

### Worker budget

Each CI shard runs two Playwright workers: `--workers=2` in `ci.yml` (*Playwright* step). Before that was set, CI
ran Playwright's default, half the machine's CPUs (`'50%'` of `os.cpus().length`, `@playwright/test` 1.58.2's
`resolveWorkers`), which is 2 on GitHub's 4-vCPU `ubuntu-latest` runners and matches the two workers the sampled CI
runs reported. Stating it keeps the budget from changing with the runner, and makes a change to it a reviewed one.

The local study behind it (October 2026): shard 2/3 (392 smoke tests: the `lab.*` specs, CSP, theme, data table),
`--retries=0`, runs interleaved (1, 2, 3, 2, 3, 1, ...), on a 4-CPU machine where the demo (PHP's built-in server
with 4 workers, `PHP_CLI_SERVER_WORKERS=4`) and the browser also run:

| Workers | Runs | Wall time, s (median, all runs) | Summed test time, s (median) | Mean per test, s | Failed |
|---:|---:|---|---:|---:|---|
| 1 | 4 | 765 (716, 753, 777, 778) | 753 | 1.92 | 0 in every run |
| 2 | 3 | 509 (478, 509, 514) | 989 | 2.52 | 0 in every run |
| 3 | 3 | 446 (440, 446, 454) | 1286 | 3.28 | 0 in every run |

Two workers take a third off one worker's wall time; a third worker takes 12% more off, while each test runs 30%
slower than with two, which leaves less margin to every timing-sensitive test, on a runner that also hosts the demo
and the browser. No run failed, so the study shows no flake rate to tell them apart (with `--retries=0`, a flaky test
fails its run). Two, the default CI already ran, is kept.

These are local timings, not CI's: the demo runs in FrankenPHP there, the runner's CPUs differ, and the a11y (shard 1)
and screenshot (shard 3) shards were not measured. Three workers in CI is untested; the shards' `durations.json`
(*Reading CI results*) is where a later change would be measured, against the same run with two.

### Jev diagnosis (advisory)

When a shard has a failed or flaky test (in CI and in the monthly *Browsers* jobs), or *Kit PHP*'s PHPUnit fails, a
later step, [`tools/ci/jev-diagnosis.mjs`](../tools/ci/jev-diagnosis.mjs), asks Jev (TypeSafe's model, pinned in
[`tools/ci/jev-ci.json`](../tools/ci/jev-ci.json)) two questions about each failed attempt in
`failed-attempts.json`, retry-recovered ones included: which category of the policy's rubric the cause likely belongs
to (`environment_failure`, `product_defect`, `test_defect`, `timing_assertion`, or `unknown`), and which of the
supplied excerpts best helps investigate it (or none). It is a starting hypothesis for whoever investigates, not a
verdict: the test result decides, the step may fail or time out (2 minutes) without changing the job, and a missing
key, a provider error or an answer that does not validate gives an *unavailable* assessment, never a failure.

- **Where:** a warning per assessed attempt at the line that failed (the category, its confidence, and where the
  selected excerpt comes from: `test error lines a-b` or `server log lines a-b`, with its text); a *Jev diagnosis*
  section on the run's *Summary* page; and the `jev-<browser>-<shard>-<run>-<attempt>` artifact, kept 30 days, with one
  `attempts/<NN>-<test>/assessment.json` per failed attempt (the request sent, the validated answer with its
  probabilities, the policy, the model, the elapsed time) and `summary.md`.
- **Confidence:** each answer comes with Jev's confidence. Below 0.65 (the policy's `min_confidence`) the category is
  shown as `unknown` and no excerpt is selected; the answer itself stays in `assessment.json`. The threshold decides
  what is shown, it is not a measured accuracy: nothing here says how often Jev is right on this repository's
  failures. A timeout or an assertion alone does not prove a timing problem, and neither does a pass on retry.
- **Bounds:** at most 10 attempts per shard, first attempts of every test before their retries; the rest are listed as
  *not assessed: cap*. Attempts left when the 90-second budget runs out are *not assessed: deadline*. Each request
  holds at most 8 excerpts and 28,000 bytes (server log excerpts are dropped first, then error excerpts, and the
  omissions are recorded); one retry on 429 or 529, 8 seconds per request.
- **What leaves the runner:** the attempt's identity (file, line, title, project, retry, outcome), excerpts of its
  error and of the demo's server log during the attempt (`docker compose logs --timestamps php`, ±5 seconds), sent to
  TypeSafe. They are filtered first: the key and every environment value whose name looks like a secret, bearer
  strings, and JSON fields named like credentials, passwords or tokens are replaced with `[REDACTED]`. The filter
  cannot find every secret in arbitrary text, so a test must not print one.

The `TYPESAFE_API_KEY` secret is given to this step alone; without it (a fork's run, for instance) every attempt is
*unavailable (missing_credential)*. For *Kit PHP*, [`tools/ci/junit-attempts.mjs`](../tools/ci/junit-attempts.mjs)
first turns PHPUnit's JUnit report (`--log-junit`) into the same `failed-attempts.json`, one attempt per failed test,
with `demo/var/log/test.log` as its server log; that job's artifact is `jev-phpunit-<run>-<attempt>`. Turn the step off with `"enabled": false` in the policy. Its cases run with the summarizer's, against a local stand-in for the provider:
`node --test tools/tests/*.test.mjs`. They check what is sent and accepted, not how good the diagnosis is.

## Monthly job

**Catches:** code no test runs and tests that run code without checking it, which no pull request measures: a
recipe's PHP line or method no PHPUnit test reaches, a mutant of it the tests let through, a controller method no
browser test calls. Report-only: a low number fails nothing, it shows where a test is missing.

[`.github/workflows/monthly.yml`](../.github/workflows/monthly.yml) runs on the 3rd of each month on `dev`, and by
hand before a release. Nothing of it runs on a push or a pull request: CI's jobs and test list stay as they are.

| Job | What it measures | Where it reads |
|---|---|---|
| *PHP coverage and mutants* | The demo's PHPUnit tests with PCOV: lines and methods of the recipes' `src/`, per file and class, and the methods no test runs. Then [Infection](https://infection.github.io/) on the same directories and tests: the MSI and every surviving mutant (escaped, or on a line no test runs) with its diff | job summary; `php-coverage` artifact: `php-coverage.md`, `clover.xml`, `html/`, `infection.md`, `survivors.md`, Infection's own logs |
| *Browsers (coverage-chromium-1–3)* | The whole browser suite in Chromium, sharded as in CI, with V8 coverage of the scripts under `/assets/controllers/` | each shard's Playwright summary; raw recordings, 7 days |
| *Browsers (engines-firefox-1–3, engines-webkit-1–3)* | The whole suite in each engine, sharded as in CI: the behavior tests (a failure fails the shard), then every `@screenshot` test against the Chromium baselines (`PW_SCREENSHOTS=all`, no retries): each one matches, differs (with the ratio of different pixels Playwright gives) or fails another way | each shard's Playwright summary; `screenshots-<browser>-<shard>` (`tools/monthly/screenshots.mjs`) and, where some differ, `screenshot-diffs-<browser>-<shard>` (the expected, actual and diff images), 30 days |
| *Browsers (timings-chromium-1)* | The interaction-count specs (`counts.spec.ts`), 5 runs one after another with `PW_TIMINGS` set: per counted step, the median, the spread (25th to 75th percentile), min and max of its time, from its action until the update it waits for has landed, Playwright's round trips included, and the median of its longest interaction (INP, Event Timing). A count that differs fails the job as in CI | job summary; `timings` artifact (`timings.json`, `timings.md`, `tools/monthly/timings.mjs`), 90 days |
| *Monthly report* | The shards merged and mapped to `<recipe>/assets/controllers/*.js`: lines and functions run per controller, and **every controller method runs once**, the named methods no test ran; the screenshot shards merged per engine; then every number, the timings and the screenshots included, against the previous successful run | job summary; `js-coverage`, `screenshots` (`screenshots.json`, `screenshots.md`) and `monthly-trends` (`monthly.json`, `trends.md`) artifacts |

Artifacts are kept 90 days, so each run finds last month's. A report that cannot be made fails its job, and the
report says why, instead of showing 0%: PCOV not loaded, no `clover.xml` (the tests did not run) or one without a
measured line, no Infection log or one without a mutant, no recorded JS coverage. A browser test that fails fails its
shard as in CI; the coverage it recorded is still reported. Branches are not measured: PCOV measures lines.

**Scope.** The demo's autoloader maps `App\UXor\…` to the recipes' own `src/` (`demo/composer.json`), so the
tests run the recipes' files, not the copies `tools/sync-demo` writes. [`tools/monthly/php-scope.php`](../tools/monthly/php-scope.php)
writes a PHPUnit configuration (the demo's, with absolute paths and its `<source>` set to every recipe's `src/`) and
Infection's: the demo's own code, its copies of the recipes and the tests' fixtures are outside both. On the JS side,
[`tests/e2e/coverage.ts`](../tests/e2e/coverage.ts) records only the scripts served from `/assets/controllers/`, and
[`tools/monthly/js-coverage.mjs`](../tools/monthly/js-coverage.mjs) keeps the recipes' controllers (not the demo's
own); vendor and importmap packages are never recorded. A line counts as run when its first character outside a
comment ran; a controller no test loaded lists every method it declares. A test's own extra pages
(`context.newPage()`) are not recorded.

**Reading the trends.** `trends.md` puts each number next to the previous successful monthly run on the same ref (its
`monthly-trends` artifact, downloaded with the run's token), then lists what moved: files and controllers whose line
coverage changed, files whose surviving mutants changed, and methods that never ran this time but ran, or did not
exist, last time. For each engine, the screenshots that differ now and matched last time, those that match now and
differed, and those whose ratio changed: a difference from Chromium is expected, a change since last month is the
news. A test is the same test from month to month by its project, file and titles, not its line. The screenshots
are reported only when every shard of both engines made its report: a missing shard leaves them *not reported*,
never partial totals. Each timed step's median and INP stand next to last time's. The first run, or one whose predecessor's artifact
expired, says *No previous run* and why; a section last month's `monthly.json` did not have yet reads *not
reported*. A run that failed is not compared with: the next one compares with the last green one.

**Thresholds.** None yet. "Every controller method runs once" stays a report line; it moves to CI only if methods
that never run keep slipping in. A surviving mutant is a question: a test to add, or a harmless mutant (an equivalent
cast, a log message) to leave. Timings get thresholds later, from the spread the monthly runs measure; a screenshot
newly differing in another engine is a question too: a kit change that renders differently there, or the engine's
own update.

**By hand.** Actions › *Monthly* › *Run workflow*, from the branch to check ("Use workflow from"), or
`gh workflow run monthly.yml --ref <branch>`. A run checks the branch it starts from, with that branch's copy of the
workflow and its tools, so a change to them is tried by running it on its own branch. There is no input naming another
ref: a run on one would execute that ref's code in the default branch's context, where it could poison the cache.

**Locally**, from the repository root, with the demo installed (*PHP tests*); the reports go to `coverage/`
(gitignored). PCOV or Xdebug (`XDEBUG_MODE=coverage`) can measure; Infection runs as its PHAR, outside the demo's
dependencies:

```sh
php tools/monthly/php-scope.php coverage/php
(cd demo && CREATE_SNAPSHOTS=false bin/phpunit --configuration ../coverage/php/phpunit.xml --coverage-clover ../coverage/php/clover.xml)
node tools/monthly/php-coverage.mjs --out coverage/php coverage/php/clover.xml
(cd demo && php /path/to/infection.phar --configuration=../coverage/php/infection.json5 --threads=max)
node tools/monthly/infection.mjs --out coverage/php coverage/php/infection/infection.json
JS_COVERAGE=$PWD/coverage/js/raw DEMO_URL=https://localhost npx playwright test --project=smoke --project=examples   # Chromium projects; add --shard as in CI
node tools/monthly/js-coverage.mjs --out coverage/js coverage/js/raw
node tools/monthly/trends.mjs --out coverage/trends --php coverage/php/php-coverage.json \
    --infection coverage/php/infection-summary.json --js coverage/js/js-coverage.json [--previous monthly.json]
node --test 'tools/monthly/*.test.mjs'   # the report tools' cases
```

`JS_COVERAGE` is the only switch: unset, `startJsCoverage()` returns at once and the fixtures behave as before. Delete
`coverage/js/raw/` between local runs, or the old recordings are merged in.

## Release checks

**Catches:** what one run of the tier 1 specs cannot show: a step that got slower, a controller that leaves its page
alive after `disconnect()` (one visit hides it, fifty show it), a transition that only holds on a fast desktop, a
query string, a Live prop value or a form post that makes the server fail or echo markup, a sequence of clicks, keys,
Back, Forward and theme switches that throws or connects a controller twice, a sanitizer whose output changes when
sanitized again, an overlay or an editor that breaks in the dark theme. Tier 3 of
[`PLAN-test-tiers.md`](PLAN-test-tiers.md): Chromium only, and not on every push.

[`.github/workflows/release-checks.yml`](../.github/workflows/release-checks.yml) runs on the release pull request
(`dev` to `main`), once a day on `dev` unless the release checks already passed on `dev`'s head, and by hand
(Actions › *Release checks* › *Run workflow*). A passing scheduled or manual run (never a pull request's) uploads a
`release-checks-passed-<sha>` artifact; the daily run counts one only from a successful scheduled or manual run of this
workflow in this repository, and stops in seconds when it finds one. The *Release suite* job sets up the demo as CI's
browser job does and runs `RELEASE_CHECKS=1 npx playwright test --grep @release` with the `smoke`,
`smoke-dark@release` and `harsh@release` projects named (a missing one is an error), then checks the structural
evidence ([`tools/ci/release-evidence.mjs`](../tools/ci/release-evidence.mjs): each project ran a test, each release
spec ran and skipped none), then the PHPUnit properties with a random seed (`--fail-on-empty-test-suite`). CI's browser
job leaves the same tests out (`--grep-invert @release`). The required check is the *Release checks* job, which runs
whatever happened before it: it fails when *What to check* failed or the suite did not pass, so a skipped suite never
reads as a pass; only a daily run that found the checks already passed passes without the suite. The reports, the
result artifacts and the passed marker are advisory: their upload never decides the verdict.
A daily run that fails opens one issue labeled `release-checks`, or comments on the open one; a green one closes it.

| Group | Where | What it checks |
|---|---|---|
| Timings | [`release.timings.spec.ts`](../tests/e2e/release.timings.spec.ts) | The key transitions of the data table in a frame and in Live (sort, page, filter), the editor (typing, bold), the Markdown editor (typing, the preview), the forms page (an invalid submit) and the `/demo` dashboard (a Turbo visit and Back), each run 5 times on a fresh page, timed by the interaction-count harness (`trackCounts().time()`, [`counts.ts`](../tests/e2e/counts.ts)): the duration until the update it waits for has landed, the longest interaction (INP), the total blocking time, and Chromium's style, layout and script time over the step |
| Long session | [`release.long-session.spec.ts`](../tests/e2e/release.long-session.spec.ts) | 50 Turbo visits and Backs across eight lab and form pages in one document; then, after the caches are dropped and a forced collection, `Memory.getDOMCounters` (documents, nodes, listeners) and the JS heap back at their level after two warm-up rounds, within the tolerance the spec states, the numbers in its `long-session` annotation |
| Harsh conditions | the `harsh@release` project | The data tables, the editor, the date picker, the autocomplete and the chart specs again, with the CPU 4 times slower (`Emulation.setCPUThrottlingRate`), DevTools' "Slow 4G" network and a phone's viewport (`harshConditions`, [`fixtures.ts`](../tests/e2e/fixtures.ts)): their behavior holds |
| Wide matrices | the `smoke-dark@release` project | The overlay specs (dropdown, modal, drawer, popover, tooltip, their Live labs) and the editor specs again in the dark theme; `smoke` runs them in the light one |
| Fuzzing | [`release.fuzz.spec.ts`](../tests/e2e/release.fuzz.spec.ts) | Seeded, 30 s per target (`FUZZ_BUDGET_MS`). Random query strings on the data table pages and random values for the Live data table's writable props, sent as the live controller sends them; random form posts on `/forms` and the lab's POST forms (long strings, unicode, markup, arrays where a value is expected, fields left out; the CSRF field kept, and one post in three through the page's own form in the browser): no 5xx, no slow answer, no injected element or handler, no CSP violation or console error. UI runs on the lab pages: random clicks (on controls and links that stay in the lab), keys, Back, Forward, the theme toggle and the system theme, each followed by a wait for the page to settle: no console or page error, and one Stimulus controller per element and identifier |
| Properties | [`demo/tests/Property/`](../demo/tests/Property/) (`--group property`) | `TableQuery::fromValues()` on any values and any table: the offset stays below `maxRows()`; the editor's HTML policy and the Markdown renderer on random hostile markup: no `<script>`, `on*` attribute or unsafe link, and the output is stable when sanitized again. CI runs them with a fixed seed and 300 runs; the release checks with a random seed and 2000 |

A project's name is part of its tests' titles, so `@release` in `harsh@release` and `smoke-dark@release` tags every
test they run; Firefox's and WebKit's projects leave `@release` out. Neither project compares screenshots: the
baselines are the light theme's, at desktop and example sizes. The monthly job's Chromium coverage run, which does not
filter by tag, also runs the `smoke` project's `@release` specs.

**Report only, for now.** The timings never fail a run: each timed step's metrics are printed against
[`tests/perf/baseline.json`](../tests/perf/baseline.json) in the job summary
([`tools/ci/release-timings.mjs`](../tools/ci/release-timings.mjs)), until the owner sets a tolerance per metric (the
plan's step 8). A behavior assertion, a leak counter over its tolerance, a fuzzing or property failure fails the run
as any test does. `main`'s ruleset requires the *Release checks* check on the release pull request from 0.2.0 (decision 4
of the plan): every failure above blocks the release; the timings do not until step 8. A recorded baseline comes only
from a run whose tests, properties and evidence all passed, and `--record` refuses a partial run (a step with fewer
than 5 runs, or a step of the baseline not timed, whatever harness recorded it) and writes nothing.

A malformed form post (an array where the controller reads a string) is a 400, answered with Symfony's error page,
whose inline styles the demo's policy blocks: the form fuzzing checks markup and the CSP on the answers the app renders
(a 2xx, a redirect, the form's 422) and the status alone on the others; the browser gets a 400's status with an empty
page.

**Replaying.** Fuzzing and the properties print their seed: `SEED=<seed> npx playwright test tests/e2e/release.fuzz.spec.ts`
or `SEED=<seed> PROPERTY_RUNS=2000 bin/phpunit --group property` (in `demo/`) runs the same values again. A failure
found becomes a tier 1 test once fixed (the first: `EditorHtmlPolicyTest`'s "a heading in an unwrapped block in a
heading", from `MarkupPropertyTest`).

**The long session in this demo.** The demo runs Symfony's dev environment, where Stimulus logs every connect with its
element; with the console recorded, as Playwright records it, each logged element keeps its detached page alive. The
spec turns Stimulus' debug log off and discards the console's messages before each reading, so it measures what the
page keeps. `Memory.prepareForLeakDetection` crashes Chromium 145's renderer (Playwright 1.58): the spec tries it in a
page of its own and, where it fails, drops the same caches with `Memory.simulatePressureNotification`.

**Locally**, with the demo up (`DEMO_URL=https://localhost` for the Docker demo):

```sh
RELEASE_CHECKS=1 npx playwright test --grep @release --workers=1     # every release check (RELEASE_CHECKS adds the dark and harsh projects), Chromium, as CI runs them (one worker: the timings must not share the machine)
npx playwright test tests/e2e/release.long-session.spec.ts --project=smoke
FUZZ_BUDGET_MS=60000 npx playwright test tests/e2e/release.fuzz.spec.ts --project=smoke
(cd demo && SEED=$RANDOM PROPERTY_RUNS=2000 bin/phpunit --group property)
# the timings against the baseline, and a baseline recorded from them (one worker: the timings are the point)
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/timings.json npx playwright test tests/e2e/release.timings.spec.ts --project=smoke --workers=1 --reporter=json
node tools/ci/release-timings.mjs --baseline tests/perf/baseline.json test-results/timings.json
node tools/ci/release-timings.mjs --record tests/perf/baseline.json --commit "$(git rev-parse HEAD)" test-results/timings.json
```

**Recording a baseline.** Run the workflow by hand on `dev` with `record` checked: the `release-baseline` artifact is
the run's timings as a `baseline.json` (per step and metric, INP included, the median and the spread of the runs, with
the commit, the date and the timing harness). It replaces `tests/perf/baseline.json` through a pull request that shows the
old and new numbers (the report of that run, which compares them). A baseline of another timing harness (`HARNESS` in
`tools/ci/release-timings.mjs`, raised whenever a metric starts measuring something else) is not compared with: the
report says to record it again. The first file was recorded locally on `dev` (`3bd5b88`, 2026-10-10, the Docker demo on a
development machine, one worker) with harness 1, whose duration ended before the frame that presents the update; harness
2 counts that frame, so the report waits for CI's first `record` run, whose machine also sets the numbers the
tolerances will be read against.
