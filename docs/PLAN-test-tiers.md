---
status: open
recipes: none
---

# Plan: test tiers (behavior, basic performance, release checks)

_2026-10-08. Decided with the user on 2026-10-08:_

1. _**Three tiers:** behavior tests and basic performance checks on every pull request, and a heavier set of
   behavior and performance tests (the release checks) that runs before a release, by hand, and once a day when
   `dev` changed._
2. _**The demo is the fixture.** Performance is measured end to end in the demo, where recipes, Turbo, Live
   Components, `flowbite.min.css` and the strict CSP meet. Small component tests only where e2e cannot isolate a
   cost._
3. _**A baseline first:** timings are recorded on `dev` before anything is compared or gated._
4. _**Every tier must pass for a release.** First decided from 0.3.0; on 2026-10-10 the owner made `main`'s ruleset
   require the *Release checks* check for 0.2.0 already. Their timings report only until step 8 sets tolerances._
5. _**Fuzz and property testing** join the release checks (decided later the same day)._
6. _**PHP tests first:** PHPUnit and the Symfony UX test helpers are set up before the rest of this plan, from the
   survey of PHP and Symfony testing projects._
7. _**Before 0.2.0:** this plan, with the Turbo cleanup and the other work first planned after the release, is done
   before 0.2.0 is tagged, except step 8 (decided 2026-10-10: the gates need tolerances picked from the release
   checks' first reports, so step 8 follows the release; the timing gates apply from 0.3.0, the rest of the release checks from 0.2.0)._

_What led here: the theme toggle showed no icon under a dark system with the light theme chosen, and a theme switch
faded table rows (`fix(theme-toggle)`). Each component's states were tested, not the moves between them, and nothing
measured what a switch costs._

## The tiers

| Tier | What | When | Gates |
|---|---|---|---|
| 1. Behavior | State × transition specs: every state a component can be in, and every way it moves between them | Every pull request and push (today's CI) | The pull request; a release |
| 2. Basic performance | Deterministic counts, as assertions inside tier 1 specs | With tier 1 | The pull request; a release |
| 3. Release checks | Timings against the baseline, harsh conditions, long sessions, wide matrices | On the release pull request (`dev` to `main`), by hand, daily when `dev` changed | A release |

### 1. Behavior

The model is `tests/e2e/theme-toggle.spec.ts`: list the states (system light or dark × no, light or dark choice),
list the transitions (toggle, system change, Turbo visit, Back, reload), and after each transition check the whole
state (class, `aria-pressed`, visible icon, saved choice, first paint).

- **Per recipe with behavior:** an inventory of its states and transitions, and which spec covers each. The inventory
  is the first deliverable: it shows the gaps before any test is written. It is
  [`TEST-INVENTORY.md`](TEST-INVENTORY.md), with its ranked gaps.
- **Transitions every interactive recipe is checked against:** Turbo Drive visit, Back and Forward, the cache
  snapshot, a frame visit (with and without `data-turbo-action="advance"`), a Stream `replace` and `update`, a Live
  re-render, `data-turbo-permanent`, the theme switch, and the system theme changing while the page is open.
- **Deterministic only.** A test that needs throttling, repetition or timing to show its bug belongs in tier 3.

### 2. Basic performance

Counts, not timings: the same build gives the same numbers, so they fail like any other assertion.

| Check | How |
|---|---|
| No stray transitions or animations after a state change | `document.getAnimations()` in the frame the change lands (the theme toggle spec does this) |
| No layout shift after load and after a transition | A `PerformanceObserver` for `layout-shift` entries |
| No duplicate requests on a Turbo visit, Back or a Live re-render | The page's requests, per URL |
| One controller instance per element after repeated visits | Stimulus itself: `application.controllers` filtered by identifier, against the elements carrying it, after N visits. Page-wide totals (`Performance.getMetrics`: `Nodes`, `JSEventListeners`) depend on garbage collection and cached snapshots, so they are not counts; leaks are a release check (below) |
| JavaScript and CSS bytes per demo page under a budget | Resource Timing `encodedBodySize`, per page, budgets in a checked-in JSON file |

Budgets change only through a pull request that says why.

**Server-side counts with the Symfony profiler.** PHP functional tests (`WebTestCase`, `$client->enableProfiler()`)
read each request's profile: the Twig templates rendered, memory, Doctrine queries, and demo-only collectors (for
example a data table's `countRows()` and `loadRows()` calls). They assert counts like "a table request runs one count
and one row load" (`demo/tests/Functional/DataTableRequestsTest.php`, with the demo's `DataTableCollector`). The
profiler slows every request, so it stays off for the release checks' timings and the baseline.

### 3. Release checks

| Group | What |
|---|---|
| Timings | Per scenario, the median of 5 runs, compared with the baseline with a tolerance per metric: total blocking time (long tasks); **immediate feedback**, the slowest input's next paint (Event Timing, which ends there by design); **completion**, from the input to the first frame presented after the expected update lands (a mark at the input, the update observed by its own event, `turbo:render`, `turbo:frame-render` or Live's `render:finished`, or a `MutationObserver`, then `requestAnimationFrame` twice), so a slow response or DOM update after the first paint is measured; and Chromium's `RecalcStyleDuration`, `LayoutDuration`, `ScriptDuration` over the transition. |
| Harsh conditions | The tier 1 transitions of the heavy recipes (data tables, editors, chart, autocomplete, date picker) under 4× CPU throttling, a slow network, and a phone viewport. |
| Long sessions | 50 Turbo visits and Backs across the demo: after `Memory.prepareForLeakDetection` and a forced collection (`HeapProfiler.collectGarbage`), the leak-detection counters (`Memory.getDOMCounters`: documents, nodes, listeners) and the JS heap must come back to their level after the first visit (leaks a single visit hides). |
| Wide matrices | The state × transition matrix of tier 1 extended to every overlay (modal, drawer, dropdown, popover, tooltip) and editor, in both themes. |
| Fuzz and properties | Seeded, with a time budget per target; each run prints its seed and `SEED=…` replays it. **Requests:** random query strings for the data tables, random values for every writable Live prop (sent as the live controller sends them), random form posts: no 5xx, no response over a time budget, no injected element, no CSP violation. **Properties** of the server code: `TableQuery::fromValues()` (the offset stays below `maxRows()`), the editor's HTML policy and the Markdown renderer (sanitized output is stable when sanitized again, no `<script>` or `on*` attribute, length limits hold). **UI runs:** random clicks, keys, Back/Forward and theme switches on the lab pages under the test fixture: no console or page error, one controller instance. A failure found becomes a fixed tier 1 test. |

Scenarios, all in the demo: the `/demo` dashboard, the data-table and data-table-live labs, the editor and
markdown-editor labs, the chart page, the forms page, and the Turbo labs. Server time is excluded: every metric is
taken in the browser after the response, so FrankenPHP (CI) and `php -S` (local) give comparable numbers.

## The baseline

- Recorded on `dev` in CI's setup (the demo's FrankenPHP container, the browser in the pinned
  `mcr.microsoft.com/playwright` image), by the release checks workflow run by hand with a `record` input.
- Stored as `tests/perf/baseline.json`: per scenario and metric, the median, the spread of the runs, the commit and
  the date. Updated only by a pull request that shows the old and new numbers.
- **Report only at first.** The first runs print each metric against the baseline without failing. The user reviews
  the numbers and picks each tolerance; then the timings gate.

## Workflows

- **`ci.yml` (tiers 1 and 2):** unchanged in shape. Tier 3 specs are tagged `@release` and excluded with
  `--grep-invert @release`.
- **`release-checks.yml` (tier 3), new:**
  - `pull_request` targeting `main`: the release pull request from `dev`. `main`'s ruleset requires this check, so
    merging the release pull request needs it green;
  - `schedule` once a day, on `dev`: first asks whether the release checks already passed on `dev`'s head (a
    `release-checks-passed-<sha>` artifact, GitHub API) and stops in seconds when they did;
  - `workflow_dispatch`, with a `record` input to write a new baseline as an artifact;
  - Runs `npx playwright test --grep @release` in the same setup as CI.
  - A failed daily run opens one issue (label `release-checks`), or comments on the open one, instead of failing
    anyone's pull request after the fact. A green run closes it.
- **`release.yml`:** unchanged: it tags and publishes once the release pull request is merged and CI passed on
  `main`. The release checks already passed on that pull request. A failure blocks the merge until it is fixed, or
  until the user waives that check for that release in writing (the CHANGELOG entry says which and why).

Specs live with the others in `tests/e2e/`; tier 3 is a tag, not a separate tree.

## Delivery

One pull request each, in order:

1. **This plan** (`docs/PLAN-test-tiers.md`), reviewed.
2. **PHP tests:** PHPUnit 13 and `symfony/test-pack` in the demo, the PHPStan Symfony and PHPUnit extensions,
   `tools/tests/data-table.php` ported to PHPUnit; Live and Twig component tests with the UX packages' helpers
   (`InteractsWithLiveComponents`, `InteractsWithTwigComponents`), snapshot tests of rendered components, and
   `composer audit` in CI.
3. **The inventory:** per recipe, its states and transitions and the spec covering each:
   [`TEST-INVENTORY.md`](TEST-INVENTORY.md). A file of its own, not a table here: every pull request that changes
   coverage updates its rows, while this plan stays the record of what was decided. Its ranked gaps are step 6's
   input.
4. **Baseline:** the timing harness, `release-checks.yml` with `workflow_dispatch` and `record`, report only, and the
   first `tests/perf/baseline.json`. _Done: `trackCounts().time()` and `tools/ci/release-timings.mjs`; the first
   baseline recorded locally on `dev`, replaced by CI's first `record` run ([`TESTING.md`](TESTING.md), *Release checks*)._
5. **Tier 2:** the count checks and the byte budgets, in the existing specs.
6. **Tier 1 gaps:** the missing state × transition specs from the inventory, a recipe group per pull request.
7. **Tier 3 and the release gate:** harsh conditions, long sessions, wide matrices, fuzz and property tests, the daily
   schedule and its issue, the check on the release pull request. _Done, report only: `@release` specs (timings, long
   session, fuzzing of queries, Live props, form posts and UI runs) and projects (dark theme, harsh conditions with the
   chart), `demo/tests/Property/` ([`TESTING.md`](TESTING.md), *Release checks*). `main`'s ruleset requires the
   check from 0.2.0. Not yet: an overlay open while the theme switches._
8. **Gates on:** the tolerances the user picked after reviewing the reports.

## Open questions

1. Tolerances per timing metric: decided after the report-only runs (step 8).
2. ~~How many runs per scenario?~~ **Decided 2026-10-10:** 5 (`TIMING_RUNS` in `release.timings.spec.ts`, 5 by
   default).
3. ~~Firefox and WebKit?~~ **Decided 2026-10-10:** Chromium only for now: the metrics above are Chromium's.
4. ~~The work lands before 0.2.0 (decision 7): does the release gate then already apply to 0.2.0, or still from 0.3.0?~~
   **Decided 2026-10-10:** from 0.3.0, then brought forward the same day: `main`'s ruleset requires the *Release
   checks* check for 0.2.0. Steps 1–7 land before 0.2.0; step 8 (the timing tolerances) follows the release, once the
   user has reviewed the first reports.
