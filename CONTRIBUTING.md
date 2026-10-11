# Contributing to UXor

UXor is a Symfony UX Toolkit kit: `manifest.json` at the root, one recipe per top-level directory
holding a `manifest.json`. This page covers the repository, the conventions, adding a recipe, and the commit
and pull request standard.

## Repository layout

| Path | In the `ux:install` download | What it is |
|------|---------------------------|---|
| `manifest.json`, `INSTALL.md`, `kit.css`, `kit.js`, `icon.svg`, `<recipe>/` (minus `<recipe>/tests/`), `README.md`, `LICENSE`, `NOTICE` | yes | the kit, its readme and license |
| `demo/` | no | a Symfony app showing every recipe (`/r/<recipe>`), test pages for Turbo and Live Components (`/lab`), and a small application made of the layouts and blocks (`/demo`); `bin/console app:export-static` saves its showcase as the static gallery; its PHPUnit tests in `demo/tests/` |
| `tools/sync-demo` | no | copies every recipe into `demo/` the way `ux:install --force` does |
| `tools/demo-php` | no | runs PHP in the demo's container, for the Playwright specs (`DEMO_URL`) |
| `tools/contrast/` | no | WCAG contrast check of the theme's color roles |
| `tools/llms-txt.mjs` | no | writes `llms.txt` and the recipe table of `FOR-AGENTS.md` from `docs/RECIPES.md`'s recipe tables, and checks the plans' status |
| `tools/docs-lint.mjs`, `tools/fence-coverage.mjs` | no | what the markdown examples teach, and a gallery page for every recipe and README example (*Docs*) |
| `tools/recipe-imports.mjs` | no | every relative import in a recipe's JavaScript names a file the recipe or its recipe dependencies install (*Checks*) |
| `tools/js-duplication.mjs` | no | the copies of code in the recipes' JavaScript: the duplicated lines stay within a budget, and no recipe declares again a name a shared module exports (*Checks*, *Shared code*) |
| `tools/readme-versions.mjs`, `tools/readme-pairing.mjs` | no | each recipe README renders its manifest's dependencies (`::: installation`) and writes no version table, and changes with the recipe's code unless a commit waives it (*Docs*) |
| `tools/icon-lint.mjs` | no | every icon in the recipes' templates and the markdown is a `flowbite:` name written in full (*Docs*) |
| `tools/ci/playwright-summary.mjs` | no | reads a CI shard's Playwright report: the job summary, annotations, `failed-attempts.json` and `durations.json` ([`docs/TESTING.md`](docs/TESTING.md), *Reading CI results*) |
| `tools/ci/jev-diagnosis.mjs`, `tools/ci/jev-ci.json`, `tools/ci/junit-attempts.mjs` | no | the advisory Jev diagnosis of each failed attempt in `failed-attempts.json`, and its policy; `junit-attempts.mjs` writes that file from *Kit PHP*'s PHPUnit report ([`docs/TESTING.md`](docs/TESTING.md), *Jev diagnosis*) |
| `tools/ci/release-timings.mjs` | no | the release checks' timings against `tests/perf/baseline.json`, report only, and a new baseline from a run ([`docs/TESTING.md`](docs/TESTING.md), *Release checks*) |
| `tools/ci/release-evidence.mjs` | no | the release checks' structural evidence: each release project ran a test, each release spec ran and skipped none ([`docs/TESTING.md`](docs/TESTING.md), *Release checks*) |
| `tools/release-plan.sh` | no | what `release.yml` tags and publishes for each version: the commit, the tag's state, the notes; refuses a tag on another commit (*Releases*) |
| `tools/monthly/` | no | the monthly job's scope and reports: PHP coverage of the recipes' `src/` and Infection's surviving mutants, the controllers' JS coverage, the Firefox and WebKit screenshots against the Chromium baselines, the interaction timings, and the trends against the previous run ([`docs/TESTING.md`](docs/TESTING.md), *Monthly job*) |
| `tools/phpstan.neon` | no | PHPStan's level and extensions (Symfony, PHPUnit) for the recipes' PHP and the demo's tables and tests |
| `tools/tests/` | no | the cases of `tools/ci-changes.sh`, `tools/ci/playwright-summary.mjs`, `tools/ci/jev-diagnosis.mjs`, `tools/ci/release-timings.mjs`, `tools/ci/release-evidence.mjs`, `tools/prepare-tests.mjs`, `tools/icon-lint.mjs`, `tools/readme-versions.mjs`, `tools/readme-pairing.mjs`, `tools/recipe-imports.mjs` and `tools/js-duplication.mjs` (both also on the kit itself) and `tools/release-plan.sh`; `sync-demo` parity with `ux:install`; install of the kit on a fresh Symfony skeleton (exported kit, Symfony 7.4) and in a fresh Symfony Docker project (GitHub's archive, Symfony 8.1) |
| `tests/e2e/`, `playwright.config.ts`, `<recipe>/tests/` | no | Playwright tests against the demo; screenshot baselines |
| `tests/perf/baseline.json` | no | the release checks' timing baseline: per step and metric, the median and spread, with the commit and date ([`docs/TESTING.md`](docs/TESTING.md), *Release checks*) |
| `tools/build-static.sh` | no | builds and checks the gallery as a static site, for CI's *Static site* job and `pages.yml` (*Releases*) |
| `tools/prepare-tests.mjs` | no | what the browser tests need, safe with several Playwright processes in one checkout: the recipe specs' runnable copies and the demo's CSS (*Checks*) |
| `FOR-AGENTS.md`, `llms.txt` | no | the page for coding agents given the repository's URL, and the list of every page for them ([llms.txt](https://llmstxt.org/)) |
| `docs/`, `.github/` | no | notes on the toolkit and platform behavior this repository works around ([`docs/NOTES.md`](docs/NOTES.md)), a snippet that projects using the kit paste into their own `AGENTS.md` ([`docs/PROJECT-AGENTS-SNIPPET.md`](docs/PROJECT-AGENTS-SNIPPET.md)), the testing patterns ([`docs/TESTING.md`](docs/TESTING.md)), CI, the gallery on GitHub Pages (`pages.yml`), CodeQL code scanning, the weekly `npm audit`, the monthly coverage, mutation, cross-browser and timings reports (`monthly.yml`), the release checks (`release-checks.yml`: on the release pull request, daily on `dev` and by hand), Dependabot's update pull requests, the pull request template |

`ux:install` downloads GitHub's archive of the whole repository; `export-ignore` in `.gitattributes` keeps
everything else out of it (the demo, tests, tools, and repository files such as this one, `AGENTS.md`,
and `SECURITY.md`). Keep any new path out of the archive the same way unless users need it.

## Setup

The demo runs in [Symfony Docker](https://github.com/dunglas/symfony-docker): FrankenPHP in worker mode, PHP 8.5,
HTTPS. You need Docker and Node.js (CI uses 22); no PHP on your machine. Playwright's browser also runs in Docker,
in the same `mcr.microsoft.com/playwright` image as the Symfony UX Toolkit's own tests, so screenshots match the
committed baselines.

```bash
cd demo
docker compose up --wait                            # builds the image the first time, then installs the Composer packages
docker compose exec php php ../tools/sync-demo      # copy every recipe into demo/ (safe to re-run; deletes nothing)
docker compose exec php bin/console tailwind:build  # add --watch to rebuild the CSS as you edit
cd .. && npm ci
```

Open https://localhost (the demo listens on this machine only) and accept the certificate of Caddy's local
authority. The container sees the whole repository in `/app` and runs the demo from `/app/demo`, as on disk;
FrankenPHP restarts its workers when a file changes. After changing a recipe, run `tools/sync-demo` and
`tailwind:build` again. `tools/sync-demo` never deletes: remove a renamed or deleted recipe file from `demo/`
yourself. `docker compose down` stops the demo.

Without Docker, with PHP 8.4 or later and Composer: run `tools/sync-demo`, then
`(cd demo && composer install && php bin/console tailwind:build && php bin/console asset-map:compile)`, and serve
the demo with `php -S 127.0.0.1:8000 -t demo/public`. PHP's built-in server only serves the compiled CSS and
JavaScript in `demo/public/assets/`, so compile again after each change.

To inspect the running demo from the command line (the profile of a request, the container's services), the demo
ships [Symfony AI Mate](https://symfony.com/doc/current/ai/components/mate.html) as a dev dependency: set
`PROFILER_COLLECT=1` in `demo/.env.dev.local`, then run `vendor/bin/mate tools:list` in `demo/`
([`docs/TESTING.md`](docs/TESTING.md), *Counts from the profiler*). Coding agents read `demo/AGENTS.md`, which Mate
generates.

The demo trusts the repository it serves. It compiles every `{"preview":true}` README example as a Twig template and
runs it with the app's services, and shows the result in its own origin, where the previews' frames share the
pages' cookies and storage. README examples are code: review them as such, and never run the demo on a kit, a
branch or a pull request you do not trust. Sandboxing the preview frames does not help: it stops their Stimulus
controllers. Previewing untrusted code would need a separate origin and container.

## Checks

CI runs them on every push, each job only when the change could affect what it checks
([`tools/ci-changes.sh`](tools/ci-changes.sh)); pushes to `main` and `dev`, and a run by hand, run everything. A
branch is compared with where it left `dev`, so each push checks the whole pull request. The rulesets require the one
*CI result* check, which passes when every job passed or was skipped, and `dev`'s requires a branch to be up to date
with it before it merges: merge `dev` in and push, so that CI has run on the code that lands (there is no merge
queue; a work order's jobs need not be up to date with it, *Work orders* below). CI runs the script as the base branch has it, so a branch cannot change its own checks; a job the base's
script does not know yet runs. A path no row below names counts as part of the kit until `tools/ci-changes.sh` and its
test (`tools/tests/ci-changes.sh`) say otherwise. A deleted file counts as a change to its path, a renamed one as a
change to both paths.

| A change to | runs |
|---|---|
| `LICENSE`, `NOTICE`, `.github/dependabot.yml` | nothing |
| `docs/`, `CHANGELOG.md`, `CONTRIBUTING.md`, `AGENTS.md`, `FOR-AGENTS.md`, `SECURITY.md`, `.github/pull_request_template.md` | *Contrast*, which checks the docs (*Docs*) |
| `kit.js`, `manifest.json`, `.gitattributes`, any other root file no row names | *Lint kit*, *Kit PHP*, *Static site*, both *Fresh install* jobs, *Demo + Playwright* |
| a recipe (any of its files but `tests/`: Contrast pairs its code with its `README.md`, and its `README.md` with its `manifest.json`), `kit.css`, `README.md`, `INSTALL.md`, any file in a directory no other row names | the same and *Contrast* |
| a spec: `tests/e2e/*.spec.ts`, a recipe's `tests/*.spec.ts` | *Contrast* (`tools/test-inventory.mjs`), *Demo + Playwright* |
| any other file in `tests/` or a recipe's `tests/`, `playwright.config.ts`, `tools/prepare-tests.mjs`, `tools/tests/prepare-tests.test.mjs`, `tools/tests/sync-demo.sh`, `tools/tests/fixtures/sync-kit/` | *Demo + Playwright* |
| `tools/ci/junit-attempts.mjs` | *Kit PHP* |
| `tools/ci/jev-diagnosis.mjs`, `tools/ci/jev-ci.json` | *Kit PHP*, *Demo + Playwright* |
| any other file in `tools/ci/` (the browser job's results summary) | *Demo + Playwright* |
| `tools/tests/*.test.mjs`, `tools/tests/fixtures/playwright-results/`, `tools/tests/fixtures/junit/`, `tools/monthly/` (every tool's cases, and the monthly report tools) | nothing else: *Tool tests* runs all the tools' cases on every run, in seconds, with no install |
| `package.json`, `package-lock.json` | *Contrast*, *Demo + Playwright* |
| any other markdown file outside `demo/` | *Contrast* (`tools/docs-lint.mjs`, `tools/icon-lint.mjs`), and the jobs its path runs |
| `tools/contrast/`, `tools/llms-txt.mjs`, `tools/docs-lint.mjs`, `tools/test-inventory.mjs`, `llms.txt` | *Contrast* |
| `tools/icon-lint.mjs` | *Contrast* |
| `tools/readme-versions.mjs`, `tools/readme-pairing.mjs` | *Contrast* |
| `tools/fence-coverage.mjs` | *Contrast*, *Static site* |
| `tools/build-static.sh` | *Static site* |
| `tools/phpstan.neon` | *Kit PHP* |
| `tools/release-plan.sh`, `tools/tests/release-plan.sh` | *Workflows* |
| `tools/tests/fresh-install.sh`, `docker-install.sh`, their shared steps `install-scenario.sh`, `check-fresh-app.sh`, `live-action.php`, `tools/tests/fixtures/fresh-app/` | both *Fresh install* jobs |
| any other file in `tools/` | *Kit PHP*, *Static site*, *Demo + Playwright* |
| `demo/compose.yaml`, `demo/frankenphp/Caddyfile` | *Kit PHP*, *Static site*, both *Fresh install* jobs, *Demo + Playwright* |
| `demo/tests/`, `demo/src/Controller/LabController.php` | *Kit PHP*, *Static site*, *Contrast* (`tools/test-inventory.mjs`), *Demo + Playwright* |
| any other file in `demo/` | *Kit PHP*, *Static site*, *Demo + Playwright* |
| `.github/workflows/pages.yml` | *Workflows*, *Static site* (the same build, `tools/build-static.sh`, without the upload) |
| `.github/workflows/release.yml` | *Workflows*, both *Fresh install* jobs (it runs `docker-install.sh`), *Static site* (it calls `pages.yml`); nothing runs the release itself, *Workflows* runs its plan as a dry run |
| `.github/workflows/audit.yml`, `.github/workflows/codeql.yml` | *Workflows*; each also runs itself on the pull request that changes it |
| `.github/workflows/monthly.yml` | *Workflows*; it runs on its schedule and by hand, never on a push |
| `.github/workflows/release-checks.yml` | *Workflows*, *Demo + Playwright* (its setup, and the same projects and fixtures); it runs on the release pull request, daily on `dev` and by hand, never on a push |
| `.github/workflows/ci.yml`, `tools/ci-changes.sh`, `tools/tests/ci-changes.sh`, any other file in `.github/` (a new or renamed workflow) | everything |

*Workflows* runs [actionlint](https://github.com/rhysd/actionlint) with ShellCheck on every workflow: YAML, expressions,
job graph, action and reusable workflow inputs, and the shell of each `run` step. Then it runs
`tools/tests/release-plan.sh` and `tools/release-plan.sh --dry-run --ref origin/main` (*Releases*): it fails when a
version's tag points at another commit than the one `release.yml` would tag.

The PHP ones run on your machine as shown, or in the container: prefix them with
`docker compose exec php` from `demo/`, with paths relative to `demo/`
(`docker compose exec php bash ../tools/tests/sync-demo.sh`).

```bash
# lint the kit as users download it (git archive exports committed files only: commit first)
tmp=$(mktemp -d) && git archive HEAD | tar -x -C "$tmp" && demo/vendor/bin/ux-toolkit-kit-lint "$tmp"
demo/vendor/bin/ux-toolkit-kit-debug .              # lists each recipe with its files and dependencies: check yours

node tools/contrast/check.mjs                       # every pair in tools/contrast/pairs.json meets its contrast minimum
cmp kit.css theme/assets/styles/uxor.css            # the theme recipe ships kit.css unchanged
node tools/llms-txt.mjs --check                     # llms.txt and FOR-AGENTS.md's recipe table match docs/RECIPES.md's recipe tables (without --check: rewrites both; see Docs)
node tools/name-check.mjs                           # no file names a former repository of the kit (tools/kit-former-names.json) by its github.com, raw or gallery URL (see Renaming the kit)
node tools/docs-lint.mjs                            # no markdown example teaches Flowbite JS, palette colors, dark: overrides, inline handlers or styles; no recipe template uses a palette color (see Docs)
node tools/icon-lint.mjs                            # every icon in the recipes' templates and the markdown is a flowbite: name written in full; lists the names chosen by a Twig expression (see Docs)
node tools/fence-coverage.mjs                       # every README example is one the demo reads; with --site _site, after app:export-static: every recipe and example has its pages (see Docs)
node tools/test-inventory.mjs                       # docs/TEST-INVENTORY.md has a matrix row per recipe with a controller, a row per rule of FOR-AGENTS.md's Working well, and names existing tests; a11y.spec.ts scans every lab page
node tools/readme-versions.mjs                      # each recipe README renders its manifest.json with ::: installation and has no version table (see Docs)
node tools/readme-pairing.mjs [--base <ref>]        # each recipe whose code your commits change has its README changed, or a Docs-waiver trailer; base: where HEAD left origin/dev (see Docs)
node tools/recipe-imports.mjs                       # every relative import in a recipe's JS names a file the recipe or its dependencies.recipe install (a shared module: floating, navigation, turbo)
node tools/js-duplication.mjs                       # the recipes' JS copies no run of 40 tokens beyond the budget it lists, and declares no name a shared module exports (see Shared code)
node --test tools/tests/*.test.mjs                  # the cases of the CI tools (tools/ci/: results summary, Jev diagnosis, JUnit attempts), of tools/prepare-tests.mjs, of tools/icon-lint.mjs, of the README checks, of tools/recipe-imports.mjs and of tools/js-duplication.mjs, which also run them on the kit
tools/tests/sync-demo.sh                            # tools/sync-demo copies what ux:install copies, on a test kit (needs demo/vendor)
find */src -name '*.php' -not -path 'demo/*' -not -path 'tools/*' -print0 | xargs -0 -n1 php -l   # the syntax of the recipes' PHP
(cd demo && bin/phpunit)                            # the PHP tests (demo/tests/): the data tables' limits, Live and Twig components, snapshots, profiler counts
phpstan analyse -c tools/phpstan.neon --autoload-file=demo/vendor/autoload.php data-table/src data-table-live/src editor/src markdown-editor/src demo/src/Demo demo/tests   # PHPStan with its Symfony and PHPUnit extensions installed next to it (CI pins all three); run the tests first
tools/tests/fresh-install.sh                        # a new Symfony app installs dashboard-home, signup and data-table from the last commit (PHP=…, COMPOSER_BIN=…: other binaries)
KIT_REF=<pushed commit SHA or tag> tools/tests/docker-install.sh   # the same in a new Symfony Docker project (Symfony 8.1), kit downloaded from GitHub
npx playwright test                                 # every browser test, in Chromium, Firefox and WebKit: see below
npx playwright test --project=smoke --project=examples   # Chromium only, the screenshots included: the quicker loop
npx playwright test --grep-invert @release                # what CI's browser job runs; RELEASE_CHECKS=1 … --grep @release runs the release checks (docs/TESTING.md, Release checks)
node --test 'tools/monthly/*.test.mjs'              # the cases of the monthly job's report tools (tools/monthly/)
php tools/monthly/php-scope.php coverage/php        # the monthly job's PHP scope: coverage/php/phpunit.xml and infection.json5 (the recipes' src/)
(cd demo && bin/phpunit -c ../coverage/php/phpunit.xml --coverage-clover ../coverage/php/clover.xml) && node tools/monthly/php-coverage.mjs --out coverage/php coverage/php/clover.xml   # PHP coverage per recipe class (needs PCOV, or Xdebug with XDEBUG_MODE=coverage)
(cd demo && php infection.phar -c ../coverage/php/infection.json5) && node tools/monthly/infection.mjs --out coverage/php coverage/php/infection/infection.json   # Infection's MSI and surviving mutants (the PHAR CI pins in monthly.yml)
JS_COVERAGE=$PWD/coverage/js/raw npx playwright test --project=smoke --project=examples && node tools/monthly/js-coverage.mjs --out coverage/js coverage/js/raw   # the controllers' JS coverage and the methods no test runs (Chromium)
PW_TIMINGS=1 PLAYWRIGHT_JSON_OUTPUT_NAME=coverage/timings.json npx playwright test tests/e2e/counts.spec.ts --project=smoke --repeat-each=5 --workers=1 --reporter=json && node tools/monthly/timings.mjs --out coverage/timings coverage/timings.json   # the interaction timings, report only (Chromium)
PW_SCREENSHOTS=all PLAYWRIGHT_JSON_OUTPUT_NAME=coverage/screens.json npx playwright test --project=smoke-firefox --project=examples-firefox --retries=0 --reporter=json; node tools/monthly/screenshots.mjs --browser firefox --shard 1/1 --out coverage/screens coverage/screens.json   # Firefox's screenshots against the Chromium baselines (fails on any difference; the report reads it)
node tools/monthly/trends.mjs --out coverage/trends --php coverage/php/php-coverage.json --infection coverage/php/infection-summary.json --js coverage/js/js-coverage.json --timings coverage/timings/timings.json   # the numbers in one monthly.json, against --previous <monthly.json>
actionlint                                          # every workflow, with ShellCheck on its run steps (CI pins actionlint 1.7.12 and ShellCheck 0.11.0)
```

The PHP tests render the recipes as the demo has them, and the demo's pages with their CSS: run `tools/sync-demo` and
`bin/console tailwind:build` first. A change in a component's markup changes its snapshot in
`demo/tests/Twig/__snapshots__/`: rewrite it with `UPDATE_SNAPSHOTS=true bin/phpunit` and review it like code. CI
runs them with `CREATE_SNAPSHOTS=false`, so a missing snapshot fails there. The patterns are in
[`docs/TESTING.md`](docs/TESTING.md) (*PHP tests*).

`npx playwright test` runs six projects, two per browser: `smoke` and `examples` in Chromium, `smoke-firefox` and
`examples-firefox`, `smoke-webkit` and `examples-webkit`. Firefox and WebKit run every behavior test and no screenshot
comparison: a test that compares pixels is tagged `@screenshot` and runs in Chromium only, and so do the broad axe
scans of `a11y.spec.ts`. Pick projects with
`--project` (several allowed). See [`docs/TESTING.md`](docs/TESTING.md), *Browsers*.

CI runs *Demo + Playwright* as three shards per browser, nine jobs side by side, each with its own demo and
browser. Each shard retries a failed test once and ends with its summary: the counts, every failed test and every
flaky one (passed only on its retry) with its error, on the run's *Summary* page, as annotations at the failing lines
and as the last step of the job log; a shard whose tests did not run says which step failed. A flaky test keeps the run
green but is reported as flaky, never as a clean pass. See [`docs/TESTING.md`](docs/TESTING.md), *Reading CI results*.

The demo's importmap packages are downloaded once per run, by the *Importmap packages* job (three attempts against
the CDN), and shared as the `importmap-packages` artifact with every job that installs the demo: the nine shards,
*Kit PHP* and *Static site*. AssetMapper skips a package that is already there, so their installs download nothing;
each shard checks that its install left the packages as downloaded. The *Fresh install* jobs still download for
themselves: that is part of what they check.
A shard with a failed or flaky test then asks Jev (TypeSafe) for a likely cause of each failed attempt, at most 10 per
shard: a warning per attempt and the `jev-<browser>-<shard>-<run>-<attempt>` artifact, kept 30 days. It is advisory: it cannot
fail the job, and the attempt's sanitized error and server log excerpts are sent to TypeSafe. *Kit PHP* does the same
when PHPUnit fails (`jev-phpunit-<run>-<attempt>`). See *Jev diagnosis* in the same section.

- `smoke` runs the specs in `tests/e2e/`: the demo pages, the forms, the `/lab` pages for Turbo and Live
  Components, the components given hostile prop values (`hostile-props.spec.ts`), the demo's security headers and
  Content Security Policy (`csp.spec.ts`), an axe accessibility scan of every demo page (no serious or critical
  issue), and the counts of the key interactions (`counts.spec.ts`: requests, Stimulus controllers connected and
  disconnected, listeners left, response bytes under a budget; a change that moves one updates its number in the spec,
  [`docs/TESTING.md`](docs/TESTING.md), *Interaction counts*).
- `examples` compares a screenshot of every README example and of every `/demo` page with the committed one, and
  runs the recipes' own specs (`<recipe>/tests/*.spec.ts`, ported to `tests/e2e/examples/recipes/`). It fails
  on a committed screenshot that no test compares (`baselines.spec.ts`).

A test that brings a new technique (a way to provoke a state, to observe a cost, to send what a crafted request
sends) is written up in [`docs/TESTING.md`](docs/TESTING.md), with its core and a link to the spec: apps built with
the kit reuse those patterns.

Every test of every project blocks requests leaving the demo, and fails on a console error, a page error, a local
request that fails or answers >= 400, or a Content Security Policy violation (`tests/e2e/fixtures.ts`).
The demo enforces a strict policy (`demo/src/EventListener/SecurityHeadersListener.php`): scripts and styles run
only with the request's nonces, which the layouts print (`layouts/README.md`), and no inline event handler or style
attribute runs, README previews included.

Against the Docker demo, run `DEMO_URL=https://localhost npx playwright test`: the specs then run PHP in the
container (`tools/demo-php`). Without `DEMO_URL`, Playwright serves the demo itself with `php -S 127.0.0.1:8000`.
Either way it starts the browser container, unless something already listens on port 3000. Before the tests, it
builds the demo's Tailwind CSS when the files it scans changed since the last build (a SHA-256 of their content,
kept in `demo/var/tailwind/sources.sha256`), so no screenshot is taken against stale CSS; with nothing changed, it
builds nothing. `tools/prepare-tests.mjs` does that, and writes the recipe specs' runnable copies
(`tests/e2e/examples/recipes/`) when Playwright loads its configuration; each step holds a lock, and nothing is
written when nothing changed, so several Playwright processes can share a checkout, and `--list` builds nothing.
CI runs it as its own step before the tests (`node tools/prepare-tests.mjs`). A demo serving `demo/public/assets/`
still needs `asset-map:compile` after that. The demo shows all of a recipe's examples at `/r/<recipe>`, and one example
alone at `/preview/<recipe>/<example>?theme=light` (or `dark`). `<example>` is the slug of the heading above the
example: `default` for the one under the title, with `-2`, `-3`… added when a heading repeats.

## Conventions

- **Behavior in Stimulus only.** No `import 'flowbite'` and no `initFlowbite()`. A controller's `connect()` must work
  when it runs again on the same element, since Turbo and Live Components reconnect controllers. `disconnect()` undoes
  everything `connect()` set up. No global state, and no `DOMContentLoaded` or `turbo:load` listeners. A Stimulus action on
  `turbo:before-cache@document` is allowed, to reset state before Turbo snapshots the page (`popover` closes). A frame
  visit promoted to history dispatches it too, with the page still on screen and the copy already taken: skip the
  reset then, and reset what Back must not show when the copy connects. The `turbo` recipe's module answers both
  questions (`isPromotedFrameCache()`, `isKeptOnCache(element)`, `isCachedCopy(controller, mark)`): import it.
- **Shared code.** Logic two recipes need lives once, in an assets-only recipe (`floating`, `navigation`, `turbo`): a
  `manifest.json` copying `assets/`, a module `assets/lib/uxor-<name>.js` with no dependency, a README listing
  its exports. A recipe imports it by its relative path (`../lib/uxor-turbo.js`) and lists the recipe in
  `dependencies.recipe` (`tools/recipe-imports.mjs` checks it); add the module to `demo/.gitignore` and a row to
  `docs/RECIPES.md`'s *Shared code* table. A shared function has one meaning wherever it is called: what differs
  between recipes stays in each controller. `node tools/js-duplication.mjs` fails a new copy of 40 tokens or more
  beyond the budget it holds, and a declaration of a name a shared module exports; lower its `BUDGET` when a change
  removes copies.
- **No inline code.** Recipes print no `<style>` element and no `style="…"` or `on…="…"` attribute, and an inline
  `<script>` only in the layouts' `<head>`, with `csp_script_nonce`. A Content Security Policy blocks inline code
  without its nonce, no nonce covers an attribute, and with a nonce per request Turbo reports the `<style>` of every
  page it fetches. Behavior goes in a controller, CSS in the theme, and a size computed from data in an attribute
  other than `style` (`Progress` draws its bar as an `<svg width>`). The demo's policy fails the browser tests on a
  violation (*Checks*).
- **Props that shape markup are checked** (`docs/GUIDE.md`, *Security*). A tag prop (`as`) is lower-cased and kept
  only when it is one of the tags its `##` line lists, right after `{% props %}`:
  `{%- set as = as|lower in ['div', 'a'] ? as|lower : 'div' -%}`. An attribute name taken from data is escaped with
  `|e('html_attr_relaxed')`. A link prop goes through the scheme guard of
  `breadcrumb/templates/components/Breadcrumb/Item.html.twig`, and the template prints the guarded variable. Add each
  new one to `demo/src/Command/HostilePropsCommand.php`, which `tests/e2e/hostile-props.spec.ts` checks.
- **Recipe format** (checked by `ux-toolkit-kit-lint`):
  - `manifest.json` with `type` and `name`;
  - `README.md` opening with `# Title`, then a one-line summary;
  - each prop in `{% props %}` preceded by a `## <type> <description>` line, and each `{% block %}` preceded by a
    `{##- <description> -#}` comment (see `stat-card/templates/components/StatCard.html.twig`);
  - root element `attributes.defaults({...|tailwind_classes})`, variants with `html_cva`;
  - a controller's `@target`, `@value` and `@action` comment tags, if it has any, match its code.
- **Naming.** Recipe folders in lower kebab case (`stat-card`), components in PascalCase (`StatCard`, parts
  `Sidebar:Item`), controller files in snake case and used in kebab case (`theme_toggle_controller.js`,
  `data-controller="theme-toggle"`). Copied recipe and controller names stay unchanged.
- **Colors** only through the theme's role utilities (`bg-brand`, `text-heading`, `border-default`…); text on a solid
  fill through its on-fill role (`text-fg-on-brand` on `bg-brand`, `fg-on-dark` on `bg-dark`…).
- **CSS order.** `flowbite.min.css` loads after Tailwind's utilities, so when both define a class, Flowbite's copy
  wins.
  - A variant class that Flowbite does not define loses to a plain class that it does: in `flex max-md:hidden` the
    element stays `flex`. Write `max-md:hidden!`, or make the variant more specific
    (`max-md:not-data-mobile-open:hidden`).
  - Flowbite's `max-w-2xl` is 16rem, not 42rem: do not use it.

  Check the computed style in the browser. Details are in [`docs/NOTES.md`](docs/NOTES.md).
- **Motion.** A transition names the properties it animates (`transition-colors`, `transition-[translate,border-color]`,
  never `transition-all`, no layout property unless it is the point, like the sidebar's width) and stops under reduced
  motion with `motion-reduce:transition-none!` (important, because of the CSS order above). An animation that is the
  content (a spinner, a skeleton's pulse) runs three times slower there instead. A controller that waits for a fade
  before hiding or removing an element does it at once under `prefers-reduced-motion`; never wait for a
  `transitionend` that may not come. `tests/e2e/motion.spec.ts` checks each moving recipe.
- **Twig inside components.** In a component's content (`<twig:X>…</twig:X>`), `block('name')` and `{% block %}`
  belong to the component: reach the surrounding template's blocks with `block(outerBlocks.name)`.
- **Turbo forms.** A submitted form answers with a redirect (303) when it succeeds and 422 when it shows errors;
  Turbo Drive rejects a 200.
- **PHP in recipes.** A recipe may ship PHP classes, in `<recipe>/src/UXor/<Recipe>/`: `ux:install` copies
  them into the app's `src/` unchanged, so their namespace is `App\UXor\<Recipe>` (Symfony's default root
  namespace, and apart from the app's own classes). Apps extend them; the classes themselves stay generic. The demo
  autoloads them from the recipe (a `psr-4` line per recipe in `demo/composer.json`), so it boots before
  `tools/sync-demo` has copied them: add that line with a new recipe's PHP. The kit
  lint does not read PHP: CI checks its syntax and runs PHPStan at level 8 on it (*Kit PHP* job), and the
  fresh-install tests run it in a new app. The README documents the PHP contract by hand: the generated API section
  covers Twig props and Stimulus controllers only.
- **Never commit** `demo/vendor/`, `demo/var/`, `demo/public/assets/`, `demo/assets/vendor/`, `node_modules/`,
  Playwright output (`test-results/`, `playwright-report/`, `playwright-results/`).

## Adding a recipe

1. Create `<recipe>/manifest.json`. Copy the `$schema` line from one of this kit's own recipes (`stat-card`): the
   copied ones carry a path that only resolves in `symfony/ux`. Then set:
   - `type`: `component`, or `block` for a page section;
   - `name`: the component name (`StatCard`);
   - `copy-files`: `{"templates/": "templates/"}`, plus `"assets/": "assets/"` when the recipe has a controller and
     `"src/": "src/"` when it ships PHP (see *PHP in recipes*);
   - `dependencies`: `recipe` lists the kit recipes it uses, `composer` the packages its templates need.
     `tailwind_classes` needs `tales-from-a-dev/twig-tailwind-extra:^1.3.0`, `twig/html-extra:^3.24.0` and
     `symfony/ux-twig-component:^3.5`; `html_cva` needs `twig/html-extra` and `twig/extra-bundle`; icons need
     `symfony/ux-icons`. The lint's `composer.symbol-undeclared` warning names a missing one.

   Give a package no constraint (`symfony/form`) or a single range (`^3.5`), never `^7.4|^8.0`: `ux:install` prints
   the constraints in a `composer require` command users paste, and the shell reads `|` as a pipe.
2. Add the files: the component in `<recipe>/templates/components/<Name>.html.twig`, each part `<Name>:<Part>` in
   `<recipe>/templates/components/<Name>/<Part>.html.twig`, and a controller in
   `<recipe>/assets/controllers/<snake_name>_controller.js` (`theme_toggle_controller.js` for `theme-toggle`).
3. Write `<recipe>/README.md` in this order: `# Title`, a one-line summary, a first example, `## Installation` holding
   only the line `::: installation` (the toolkit replaces it with the install steps), `## Usage`, then more examples
   under `##` or `###` headings. Open each example with ```` ```twig {"preview":true} ````: the demo renders it and
   Playwright screenshots it in light and dark. A plain ```` ```twig ```` block is shown as code only.
4. Run `tools/sync-demo`, then `(cd demo && php bin/console tailwind:build && php bin/console asset-map:compile)`: the
   demo's CSS only holds the classes it has seen, and the demo serves the compiled files. Start the demo (see *Setup*)
   and open `/r/<recipe>` and `/preview/<recipe>/<example>?theme=dark`.
   - Icons: Iconify on demand is off in the demo, so import each icon the recipe uses
     (`(cd demo && php bin/console ux:icons:import flowbite:<name>)`) and commit it under `demo/assets/icons/`.
   - A block that takes a Symfony form gets one for its previews in `demo/src/Kit/PreviewForms.php`.
5. Record the recipe's screenshots with `npx playwright test --project=examples --update-snapshots=missing`. It writes
   only the baselines that do not exist yet, as `<recipe>/tests/screenshots/<example>-light.png` and `-dark.png`.
   Look at each one, and add them to the same commit as the recipe.
6. A recipe with a controller gets a Playwright spec in `tests/e2e/`. If the behavior must survive Turbo visits,
   frames or streams, or Live Component re-renders, test it on a `/lab` page:
   - add the scenario to `SCENARIOS`, with a route, in `demo/src/Controller/LabController.php`;
   - add its template to `demo/templates/lab/`;
   - write the spec as `tests/e2e/lab.<scenario>.spec.ts`;
   - add its path to `labPages` in `tests/e2e/a11y.spec.ts` (a route without GET goes to `notPages` in
     `tools/test-inventory.mjs` instead, with its reason).

   Either way, add the recipe's row to the matrix of `docs/TEST-INVENTORY.md`: `node tools/test-inventory.mjs` fails
   while a recipe with a controller has no row, or a lab page is not scanned.

   If the recipe puts a text, icon or bar color on a background that `tools/contrast/pairs.json` does not cover yet,
   add a row there: `fg`, `bg`, `min` (4.5 for text, 3 for icons, bars and focus rings) and `usage`.
7. Add a row for the recipe to the matching table in `docs/RECIPES.md` (mark it ✦ if it ships a Stimulus
   controller), run `node tools/llms-txt.mjs` to add it to `llms.txt` and to `FOR-AGENTS.md`'s table, and add an
   entry to `CHANGELOG.md` (see *Changelog*). If it is close to another recipe, say which to pick in the list under
   that table (*Which recipe*). Commit, then run
   the checks that cover a new recipe: the kit lint, `ux-toolkit-kit-debug`, `node tools/contrast/check.mjs` if you added pairs, and
   `npx playwright test`. CI runs all of them.

## Docs

The lists of recipes that agents read are written from `docs/RECIPES.md`'s recipe tables by `tools/llms-txt.mjs`: edit a
row there, never the copies, then run `node tools/llms-txt.mjs` and commit what it writes. CI's *Contrast* job runs
it with `--check`, which fails when:

- a directory with a `manifest.json` is missing from the tables, listed twice, or a row names no recipe;
- a plan's status does not match the recipes that ship (*Plans* below);
- `llms.txt`, or the table between `<!-- recipes:start` and `<!-- recipes:end -->` in `FOR-AGENTS.md`, is not what
  the script writes;
- `FOR-AGENTS.md` or `docs/PROJECT-AGENTS-SNIPPET.md` names a recipe that does not exist (`ux:install <name>`, a
  `<name>/README.md` link).

`llms.txt` links the raw files of the tree it describes, never `main`: the version of the newest `## [X.Y.Z]`
heading in `CHANGELOG.md` (the tag `release.yml` puts on the commit that adds it), or `dev` while
`## [Unreleased]` has entries. A release pull request therefore rewrites it to the new tag, and the first pull
request that adds an unreleased entry after a release rewrites it back to `dev`: `--check` says when.

**What the docs teach.** Agents copy examples from the markdown, so `node tools/docs-lint.mjs` (also in *Contrast*)
fails a code block, in any markdown file outside `demo/`, that shows `initFlowbite`, `import 'flowbite'` or a
`flowbite.js` file; a palette color (a color utility naming a Tailwind palette color that is not a theme role, from
`tailwindcss/theme.css` and `kit.css` as the contrast check reads them: `bg-blue-700`, `text-white`); a `dark:` color
override; an inline `on…=` handler; or a `style=` attribute. Raw HTML in prose counts too. Inline code does not: the rules quote what they forbid there. Every line of a recipe's templates
(`<recipe>/templates/**/*.twig`) is checked for palette colors too: text on a solid fill uses its `fg-on-*` role. A
block that shows what not to do says so after its language:

````markdown
```twig do-not
<button onclick="openMenu()">Menu</button>
```
````

A `markdown` block is read as a document: its code blocks are checked, its prose is not.

**Icons.** `node tools/icon-lint.mjs` (in *Contrast*) reads every `<twig:ux:icon>` and `ux_icon()` in the recipes'
templates and in the markdown, as docs-lint reads it, and fails a name that is not a quoted name of UX Icons'
`flowbite` set written in full (`flowbite:search-outline`): `ux:icons:lock` only finds those. A name chosen by a Twig
expression (`name="{{ icons[variant] }}"`) passes when it builds no name (no `~`, no text around `{{ }}`), changes
none with a filter other than `default`, every quoted value it can take is a `flowbite:` name written in full (keys
and compared strings are not values), and its template or code block writes the names in full (Toast's `icons` map);
the check lists each one. Its cases are in `tools/tests/icon-lint.test.mjs`.

**Every example has its page.** `node tools/fence-coverage.mjs` (in *Contrast*) reads each recipe's README as the
demo does (`demo/src/Kit/KitReader.php`): a block opening at the start of a line with
```` ```<language> {"preview":true} ```` is an example, named after the heading above it. A block that looks like
one but that the demo skips (indented in a list, JSON that does not parse, `"preview"` not `true`) fails, and so does
a recipe without a README. `tools/build-static.sh` (*Static site*, `pages.yml`) runs it again with `--site` after
`app:export-static`: every recipe needs its `r/<recipe>/` page and a link from the index, every example its light and
dark preview pages, and a saved page that no source names fails too.

**READMEs state the manifest.** `node tools/readme-versions.mjs` (in *Contrast*) reads each recipe's `README.md`.
It must have the `::: installation` line, on a line of its own outside code blocks: the toolkit renders the install
steps from the recipe's `manifest.json`, which is what `ux:install` reads, so the versions match by construction. A
README writes no version of its own: a table with a Version column outside code blocks fails, even one that matches
the manifest. There is no waiver: fix the README.

**A recipe change comes with its README.** `node tools/readme-pairing.mjs` (in *Contrast*) reads the branch's changes
since where it left `dev`, the base the *Changes* job computes in the workflow (a merge that brings `dev` in adds
nothing). A recipe whose code changed (any file under it but `README.md` and `tests/`, its `manifest.json`
included) fails unless its `README.md` changed too, or a commit of the branch waives it with a trailer, in the last
paragraph of its message:

```text
fix(alert): order the variant classes as Flowbite does

Docs-waiver: alert class order only, nothing the README shows changes
```

`Docs-waiver: <recipe> <reason>`, one line per recipe: the recipe must exist and the reason must say why the README
still holds. A waiver for another recipe, or without a reason, fails. Each accepted waiver is printed and listed in
the job summary, so reviewers see them; prefer updating the README. Run it before pushing:
`node tools/readme-pairing.mjs`, or `--base <ref>` for another base.

**Plans.** `docs/PLAN-*.md` and `docs/ROADMAP.md` record decisions; they are not instructions. Each plan opens
with front matter naming its status and the recipes it adds:

```yaml
---
status: open        # open, shipped or abandoned
recipes: chart      # comma-separated, or none for a plan that adds no recipe
---
```

The roadmap's *Sequence* table has the same two columns per package. `--check` fails an `open` plan or roadmap row
whose recipes are all in `docs/RECIPES.md`'s tables, and a `shipped` one naming a recipe that is not: the pull request
that adds a plan's last recipe marks the plan `shipped`. `llms.txt` never links a plan that is not `open`.

**Renaming the kit.** `manifest.json`'s `name` (the display name) and `homepage` (the repository,
`https://github.com/<owner>/<repo>`) are the only place the tools and the demo read them: `tools/llms-txt.mjs`
(through `tools/kit-identity.mjs`), the demo's pages (the `kit_reader` Twig global), the browser tests' index heading,
`tools/tests/docker-install.sh`'s default repository, and `release.yml`'s tag message; the gallery's base path is the
repository's name (`ci.yml`, `pages.yml`). The markdown keeps literal URLs, because GitHub renders it as written. To
rename: change `manifest.json`, add the old `owner/repo` to `tools/kit-former-names.json`, rename the repository on
GitHub, run `node tools/llms-txt.mjs`, then `node tools/name-check.mjs` (CI's *Tool tests* job runs it), which lists
every URL of a former repository (`github.com/<owner>/<repo>`, its raw files, `<owner>.github.io/<repo>`) in any
file, and the homepage's repository written in another case; the owner's other repositories pass;
`CHANGELOG.md`'s released sections are history and are left as written. The display name in prose (`UXor is…`) and
the code names (`App\UXor`, `uxor-*.js`, `uxor*.css`) are renamed by hand, with a breaking entry in `CHANGELOG.md`.

## Screenshots

`<recipe>/tests/screenshots/*.png` are the baselines Playwright compares screenshots with. Never update them as a
side effect. A visual change is a commit of its own:

1. Run `npx playwright test --project=examples --update-snapshots`. It rewrites every baseline that differs.
2. Keep only the files you meant to change (check `git status`), and review them.

## Commits and pull requests

**Commit subject:** `type(scope): what changes`, in plain words, at most 72 characters, no trailing period.

- `type`: `feat` (new recipe or behavior), `fix`, `docs`, `test`, `ci`, `chore` (tooling, dependencies).
- `scope`: the recipe (`sidebar`, `form-theme`) or the area (`demo`, `ci`, `tools`); left out when several apply.
- Body, when the subject is not enough: why, and what was checked.

Examples: `feat(stat-card): show the trend as text`, `fix(layouts): every layout shows flash messages`.

**Branches:** `main` holds released code only. Work branches start from `dev` and their pull requests target `dev`;
a release is a pull request from `dev` to `main` (*Releases* below). Work made of several pull requests goes through
a work order (below); a single change stays one branch and one pull request into `dev`.

**Work orders:** one objective delivered in several reviewable parts, without each part merging into `dev` on its own.

- **Branches:** the work order is `claude/wo-<name>`, made from `dev`; each part (a job) is
  `claude/wo-<name>--<job>`, made from the work order and merged back into it by its pull request. The names are
  siblings, not `<name>/<job>`, which Git cannot hold beside `<name>`. The work order's ruleset (`claude/wo-*`,
  leaving out `claude/wo-*--*`) requires *CI result* and *CodeQL*, merge commits and resolved conversations, but not
  being up to date, so jobs merge as they are ready. Job branches take ordinary pushes, review fixes included.
- **The record:** the work order's pull request into `dev`, opened as a draft once its first job has merged, holds the
  objective, what is in and out, the completion criteria, each revision of them and why, a row per job (outcome,
  branch, pull request, merged head, disposition) and what is still open.
- **A job's pull request** follows the standard here, Codex review included, and carries its own `CHANGELOG.md`
  entries and `docs/TEST-INVENTORY.md` rows. A conflict with a job merged before it is resolved in the job's branch,
  by merging the work order in.
- **Bringing `dev` in:** the work order takes no direct push (a new commit has no checks yet), so `dev` comes in
  through a job, `claude/wo-<name>--sync`, that merges it; once just before the final pull request, and earlier
  when a job needs something `dev` gained.
- **CI on the work order:** while its pull request into `dev` is a draft or not open, a push to `claude/wo-<name>` (a
  job's merge) runs only *Changes* and *Tool tests*, and *CI result* fails with "work order draft: CI ran no tests":
  each job already ran CI on its own branch. Once the pull request is ready, re-run the work order's latest CI run
  (*Re-run all jobs*); that run checks everything, and its push event is what the rulesets count.
- **Finishing:** the work order's pull request into `dev` is marked ready when every job has merged, `dev` included;
  its CI is then re-run and must pass on that commit, and its description checks each completion criterion against
  it. It merges like any pull request into `dev`. Each job ends merged, superseded (naming its successor) or abandoned
  (saying why); its branch is deleted once its work is in the work order or recorded as dropped.

**Pull request:** one topic, with a title in the commit subject format. The description follows
[the template](.github/pull_request_template.md):

- *What* lists the changes.
- *Why* gives the problem or the goal.
- *Coverage map* lists each guarantee the change adds or touches, at which scope it is tested and whether that
  coverage is new, extended, moved or removed, then what was reused, the new shared test support and the gaps left
  (see [`docs/TESTING.md`](docs/TESTING.md)), and updates the rows it changes in the suite-wide map,
  [`docs/TEST-INVENTORY.md`](docs/TEST-INVENTORY.md). A pull request with no behavior or test change says so.
- *Checks* says whether CI passed on the last commit and what you verified by hand.

Use plain words throughout, and no AI attribution lines (`Co-Authored-By`, "Generated with" footers). Pull requests
are merged with a merge commit (no squash, no rebase), so every commit of the branch lands on `dev`, then on
`main`: each one follows the commit standard above.

**Changelog:** a user-visible change (a recipe added, changed or removed, a fix users notice) gets an entry under
`## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), in the pull request that makes it: one line naming the recipe,
under `### Added`, `### Changed`, `### Fixed` or `### Removed`, as Keep a Changelog does.

## Releases

Versions are git tags `X.Y.Z` ([Semantic Versioning](https://semver.org/)) without a `v`: the toolkit cannot
install a `v` tag (see [`docs/NOTES.md`](docs/NOTES.md)). The version is declared in one place: a
`## [X.Y.Z] - YYYY-MM-DD` heading in `CHANGELOG.md`.

A release is a pull request from `dev` to `main`, opened as a draft when the maintainer decides to release. Its own
commit moves the entries under `## [Unreleased]` to the new `## [X.Y.Z] - YYYY-MM-DD` section and updates the compare
links at the bottom. It also runs `node tools/llms-txt.mjs`, which points `llms.txt`'s links at the new tag (*Docs*). Pick the version from the entries: only *Fixed* is a patch, *Added* or *Changed* a minor
version, *Removed* or anything that breaks an installed recipe a major version (a minor one while the version is
`0.x`). CI runs on this pull request like on any other, and so do the release checks (`release-checks.yml`: timings, harsh
conditions, long sessions, wide matrices, fuzzing and properties; [`docs/TESTING.md`](docs/TESTING.md), *Release
checks*). Their timings are reported against the baseline and fail nothing until their tolerances are set; everything else in
them can fail. `main`'s ruleset requires the *Release checks* check beside *CI result* from 0.2.0
(`docs/PLAN-test-tiers.md`, decision 4), so a release merges only with both green. Merging it is the release.

A fix that cannot wait for the next release goes to `main` in its own pull request with its version heading (a
patch), and `main` is then merged into `dev`.

Once the release pull request is merged and CI has passed on `main`, `.github/workflows/release.yml` does the rest: it
checks that the merge commit installs from GitHub in a fresh Symfony Docker project
(`tools/tests/docker-install.sh`), tags it `X.Y.Z`, and publishes a GitHub Release with the section as its notes. If
it fails, fix the cause and re-run it: it skips what is already done.

[`tools/release-plan.sh`](tools/release-plan.sh) makes that decision for each version: the commit is the first one of
`main`'s first-parent history that adds the version's heading (the release pull request's merge commit), the notes
are the version's section of `CHANGELOG.md` at that commit (a later edit to an old section changes no published
notes), and an existing tag, lightweight or annotated, must point at that commit. A tag that points elsewhere is
refused: the run fails at *Plan the tags and notes*, before any install check, tag or release. Look at what the tag
holds, then delete it (`git push origin :refs/tags/X.Y.Z`, and locally `git tag -d X.Y.Z`) or move it to the commit
the plan names, and re-run. See the plan before a release, or after a refusal, with
`git fetch origin main --tags && tools/release-plan.sh --dry-run --ref origin/main`: for every version, the tag, the
commit, whether the tag exists and where it points, the decision and the notes; it creates nothing. CI's *Workflows*
job runs the same dry run, and the script's cases (`tools/tests/release-plan.sh`), whenever `release.yml` or the
script changes. If GitHub refuses the workflow's tag push
("refusing to allow a GitHub App to create or update workflow … without `workflows` permission", as for `0.1.0`,
whose commit's workflows differed from `main`'s), push the tag by hand
(`git tag -a X.Y.Z <merge commit> -m "UXor X.Y.Z" && git push origin X.Y.Z`) and re-run the workflow: it
checks the tag and publishes the Release. After a release, it publishes the gallery on GitHub Pages (`pages.yml`);
if that part fails, use *Re-run failed jobs* (a full re-run finds the release done and skips the gallery), or run
`pages.yml` by hand on `main`. CI's *Static site* job builds the same pages on every push, so a page that does not render fails a pull request,
not the release: both run `tools/build-static.sh <dir> --base-path=/<repository>` (`pages.yml` adds
`--release-from-tags`, so the install commands name the release), which installs the demo, saves the pages with
`app:export-static` and checks them. Locally, delete `demo/public/assets/` after it, or the demo serves those copies.
In that copy, Live Components are switched off and the recipe pages say what needs the server
(`ExportStaticCommand::SERVER_ONLY`): add a recipe there when its examples need Symfony behind them.
