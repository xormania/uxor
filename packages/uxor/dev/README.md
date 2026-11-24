# UXor package: development consumer and environment

`packages/uxor/dev/` is a repository-only test harness for UXor's Composer package, `xormania/uxor`, exercised
through an independent consuming application in `app/`. It is separate from the recipe demo in `demo/` and is
excluded from the archive that Composer and `ux:install` download (`.gitattributes`).
[Project boundaries](../../../CONTRIBUTING.md#project-boundaries) explains the contributor and consumer contexts;
[local agent guidance](AGENTS.md) applies while working on this fixture. The [package README](../README.md)
describes the product consumers install.

This fixture follows UXor's contribution policies because it is part of UXor's development repository. Its installed
package guidance describes application integration; it does not impose UXor's contribution, publication or release
policies on real consuming projects. Use this harness's runner and application runtime, not the demo's dependencies,
cache or Mate profiles.

## Three roots

| Root | Path | What it is |
|---|---|---|
| Repository | the checkout | the kit, and the root `composer.json` that defines the package |
| Package | `packages/uxor/` | the package's code, guidance and tools |
| Consumer | `packages/uxor/dev/app/` | an independent Symfony application with its own `composer.json`, lock file, autoloading (`App\`), configuration and cache |

The consumer installs the package through a Composer path repository, `../../../..`, which is the repository root,
because Composer reads the package's definition there. It pins that local package to the synthetic version
`dev-main`, so it always uses this checkout, a feature branch included, never a download. Keep the override and the
matching `require-dev` constraint together. The installed package is a symbolic link to the repository root, so
`vendor/xormania/uxor` inside the consumer leads back to the checkout: tools that follow links must not walk into
`packages/uxor/dev/app/vendor/`.

The consumer has no database and no direct source-path wiring to the kit's recipes. The customer workflow below
installs recipe copies through Toolkit. Its lock installs Symfony FrameworkBundle 8.1.11
and Symfony UX Toolkit 3.8.0. It requires PHP 8.4 or later (`config.platform.php` is 8.4.1), and the Docker
environment runs PHP 8.5. CI's *Fresh install* job exercises the kit on Symfony 7.4 with Toolkit 3.5.1.

The runner, `run.py`, receives the three roots from its own location: the repository root is what Docker mounts at
`/workspace` and what Serena binds; commands run in `/workspace/packages/uxor/dev/app`.

## Native development

With PHP 8.4 or later and Composer 2, from the repository root:

```sh
python3 packages/uxor/dev/run.py --native prepare
python3 packages/uxor/dev/run.py --native check
python3 packages/uxor/dev/run.py --native serve
```

`serve` runs in the foreground; stop it with Ctrl-C. In a second terminal, `python3 packages/uxor/dev/run.py --native
status` checks a real request to `/health` (it answers `uxor-ready`) and prints the application's URL. The default
port is stable for the checkout's path, and separate worktrees get separate ports; set `UXOR_DEV_HTTP_PORT` on every
command to choose one.

`PHP_BIN` selects the PHP executable; `COMPOSER_BIN` selects an executable or a `.phar`, run through `PHP_BIN`. They
are paths, not shell commands. `prepare --no-assets` skips the importmap downloads for console-only work.

`prepare` installs the repository's and the consumer's lock files, keeps an existing `.env.local` (or writes one with
a private development secret), warms the container, runs Mate's `init` and then `discover`. Repeating `init` keeps
its existing configuration. Commit intentional lock file changes with the change that needs them.

## Live Composer lifecycle in tmux

From the repository root, use Python 3, tmux, Git, Composer 2, PHP 8.4+ with the consumer's extensions, and
Node.js (CI uses 22). Composer and Symfony need network access to fetch uncached dependencies and assets.
The harness creates its own disposable application. You can start it from an ordinary shell or inside tmux.

```sh
harness=packages/uxor/dev/lifecycle-tmux.py
run=$(python3 "$harness" start)
printf '%s\n' "$run"
python3 "$harness" attach "$run"
```

Detach with **Ctrl-b d**. When nested under another default tmux session, use **Ctrl-b Ctrl-b d** to detach the
inner session. The attached status bar shows the current phase, command and elapsed seconds during quiet commands.
Give the printed run directory to another person or agent on the same host and account to follow the same run.
CI's *Package* job runs the full lifecycle once through `start` and `watch`. It exercises install, first agent
handoff, update, production without dev dependencies, restore, removal and the historical upgrade.

| Command | Result |
|---|---|
| `python3 "$harness" watch "$run"` | Read the log from the beginning, follow output to completion and return the suite's exit code. |
| `python3 "$harness" status "$run"` | Read the active phase and command, its elapsed seconds and the last successful operation as JSON. |
| `python3 "$harness" wait "$run"` | Wait quietly and return the suite's exit code. |
| `python3 "$harness" collect "$run"` | Read the pinned revision, options, verdict, operation timeline and evidence paths, including after the session closes. |
| `python3 "$harness" stop "$run"` | Stop the selected run and its child processes. Other sessions keep running. |
| `python3 "$harness" repeat "$run"` | Run the same story, revision, target and timeout in a fresh directory. |

To run only the real release upgrade, select its story. To test a numbered upcoming release on an unreleased
checkout, add `--target-version X.Y.Z` with the maintainer's chosen number.

```sh
upgrade=$(python3 "$harness" start --story release-upgrade)
python3 "$harness" watch "$upgrade"
```

The starting package is the commit tagged `0.3.2` with Mate 0.14. A shallow checkout fetches that exact commit.
The candidate is the unmodified distribution from the selected commit. An upcoming release with a dated
changelog heading uses that number, including when the tag has yet to be published. Development after a
published release can use `dev-candidate` until the maintainer chooses the next number.
The test verifies the before and after versions in the consumer's Composer lock and through its installed UXor CLI.
The baseline applies through **0.9.9 inclusive**. The other install, update and removal checks continue beyond it.

Each run has a private temporary directory with `run.json`, `output.log`, an operation journal in
`events.jsonl` and a final `result.json`. Operations have stable names and IDs. Parent IDs associate commands
such as `composer.require` with their phase, such as `release-upgrade`. The transcript holds command output.
The journal records start, outcome and timing. The final result preserves the timeline for the CI failure artifact.
If an observer discovers that the worker vanished, the last recorded event provides a lower bound on elapsed
time. The end time is unknown. A damaged journal reports a telemetry error alongside the suite's own verdict.
An ordinary package-check failure also retains the disposable application for inspection. `--timeout SECONDS`
sets a run's time limit (default 1200). Local evidence remains available after detach, failure or repeat.
CI retains the transcript and run records for a failed lifecycle step for seven days.

For a CI failure, open **Package → Composer package lifecycle in a live Symfony consumer**. The transcript names
the installed baseline and candidate. The failed-run artifact contains the harness records and console output.
For the Symfony application files and profiler data available at the point of failure, inspect a failed local run.

The consumer's own browser workflow also runs in *Package*. The demo's separate Chromium shards can reuse a
verified pass when only the Composer package or this fixture changes. Editing the diagnostics recorder shared
with the demo triggers its browser tests too. See [Reused lanes](../../../docs/TESTING.md#reused-lanes).

When adding a lifecycle case, *Package* already discovers `test_*.py` in `packages/uxor/dev/tests/`.
To check whether a committed change affects demo reuse, compare the `lanes.demo` values printed by
`node tools/ci/lane-evidence.mjs fingerprint --sha <base-commit>` and the same command with `--sha HEAD`.
Matching fingerprints make an earlier verified Chromium pass eligible for reuse.

### Observe a real run from a local agent session

From the repository root, run the observer test on a host with the native dependencies listed above.

```sh
UXOR_TEST_LIVE_CONSUMER=1 python3 packages/uxor/dev/tests/test_live_consumer.py -v
```

The test prints a run directory once it has resolved the candidate and started the private tmux session.
It observes an operation during the real 0.3.2 upgrade, then finds that same operation in the completed timeline
and checks the installed versions. In CI, `UXOR_TEST_TMUX=1` enables this focused upgrade during *Package*'s
development harness tests. Running discovery locally with that flag also requires the native Composer, PHP and
tmux environment listed above. To watch as well, attach from your own terminal. Keep your local coding agent
in its usual session on the same host and give it the checkout and the printed run directory.

Ask the agent to run `status` while the test is running and report the current operation's ID, name, elapsed
seconds and last success. After it finishes, have the agent use `collect` to find that ID and report its outcome
and the suite's exit code. A fast run may finish before the agent connects. `repeat` starts a fresh run with the
same inputs when you need another live observation. The agent session stays open after the lifecycle worker exits.

## Docker development

The Docker runner uses Python, Git and Docker with Compose v2. UXor builds the PHP and editor images locally
from [the FrankenPHP recipe](images/php/Dockerfile) and [the Serena recipe](images/serena/Dockerfile). Preparing a new environment downloads the pinned upstream inputs and the
application's Composer dependencies.

```sh
python3 packages/uxor/dev/run.py up
python3 packages/uxor/dev/run.py status
python3 packages/uxor/dev/run.py check
python3 packages/uxor/dev/run.py exec bin/console list make --format=json
python3 packages/uxor/dev/run.py exec vendor/bin/mate tools:list --format=json
python3 packages/uxor/dev/run.py down
```

The stack serves FrankenPHP with this directory's `Caddyfile` on a loopback port. Each worktree has its own
Compose project, port and cache. The repository mounts at `/workspace` so the consumer's Composer path repository
can resolve UXor. Installed dependencies and compiled application files belong to the checkout user. Run
`down` from the same checkout to stop its stack.

## Commands in the consumer

Commands run in `packages/uxor/dev/app` through the selected runtime (add `--native` for host PHP):

```sh
python3 packages/uxor/dev/run.py exec bin/console debug:container App\\Controller\\DevelopmentController
python3 packages/uxor/dev/run.py exec bin/console make:command
python3 packages/uxor/dev/run.py exec vendor/bin/uxor catalog --query=modal --format=json
python3 packages/uxor/dev/run.py exec vendor/bin/mate tools:list --format=json
```

Mate uses the consumer's compiled container. `app/mate/config.php` advertises the runner's invocation for the
selected mode (`UXOR_DEV_NATIVE`), so prepare with the runner after switching modes. `mate.php_version` is not
pinned: PHP 8.4 and 8.5 are both development candidates.

### The customer workflow

`install-uxor.py` installs the workflow's recipes (`theme`, `data-table`, `modal`, `toast`, `form-theme`) with
`ux:install` from this checkout's kit: the committed `HEAD`, exported with `git archive` as GitHub's archive gives
it, as a local Toolkit kit (`uxor-candidate`, the same route as `tools/tests/fresh-install.sh`). Uncommitted changes
are not installed. It then builds the assets. A receipt, `app/var/workflow-uxor.json`, records the commit, the recipes
and each installed file's hash: a later run never overwrites the application's copies, and stops when they were
customized or installed from another commit.

```sh
python3 packages/uxor/dev/run.py --native prepare
python3 packages/uxor/dev/install-uxor.py
cd packages/uxor/dev && npm ci && npx playwright install chromium && npm run test:workflow
```

The browser check (`e2e/customer-workflow.spec.mjs`, `playwright.config.mjs`, `package.json`) belongs to the
consumer, separate from the kit's browser suite at the repository root. It loads the diagnostics fixture from the
consumer's installed UXor package.

To reproduce the customer workflow check in the [Package job](../../../.github/workflows/ci.yml), run from the root
of a disposable Ubuntu worktree with Node.js 22. The runner installs the fixture and recipes, runs the customer
browser suite, then removes the fixture's dev dependencies and checks that `/customers` still renders in production.

```sh
(cd packages/uxor/dev && npm ci && npx playwright install --with-deps chromium) &&
    bash packages/uxor/dev/check-workflow.sh
```

### Browser diagnostics

After preparing the customer workflow, run a targeted headless Chromium check from `packages/uxor/dev`:

```sh
npm run test:workflow:diagnostics -- -g 'a saved row leaving the active search'
```

The diagnostic run retains `trace.zip` and `browser-diagnostics.json` for each test under `app/var/browser-diagnostics`,
including passes. Read the selected manifest through the installed UXor tools. Pass the path relative to `app/`:

```sh
artifact=var/browser-diagnostics/TEST_OUTPUT_DIRECTORY/browser-diagnostics.json
python3 run.py --native exec vendor/bin/mate tools:call uxor_browser_diagnostics --path="$artifact" --format=json
python3 run.py --native exec php vendor/bin/uxor browser-diagnostics "$artifact" --format=json
```

Read an exact response's Symfony profile through the same PHP runtime that served the application:

```sh
token=TOKEN_FROM_BROWSER_DIAGNOSTICS
python3 run.py --native exec vendor/bin/mate tools:call symfony-profiler-get --token="$token" --format=json
```

The diagnostic command starts its own profiled PHP server by default. To use an existing server, start it with
`PROFILER_COLLECT=1` on `run.py --native serve` or `run.py up` and set `UXOR_DEV_BASE_URL` to the URL reported by
`run.py status` in the same mode. Omit `--native` from the Mate command for the Docker stack. Profile collection is
off by default in the app and the ordinary browser check.

### Verify without development dependencies

From the repository root:

```sh
composer install --working-dir=packages/uxor/dev/app --no-dev --prefer-dist --no-interaction
php packages/uxor/dev/app/bin/console cache:clear --env=prod --no-debug --no-interaction
php packages/uxor/dev/check-workflow-runtime.php
```

## Serena v2 REPL

Prepare the provider once, then register the stdio command in the agent's MCP configuration:

```sh
python3 packages/uxor/dev/run.py serena --prepare
python3 /absolute/path/to/uxor/packages/uxor/dev/run.py serena --write
```

Omit `--write` to inspect only. Starting MCP pulls no image. Each worktree has its own index and project binding:
Serena can read the entire checkout, including ignored files. With `--write` it can edit the entire checkout.
PHPactor indexes PHP, and the optional editor image supplies Node.js for TypeScript and JavaScript navigation.
The kit, package and consumer share one project, and the consumer is at
`packages/uxor/dev/app`. Install the dependencies before indexing.

`python3 packages/uxor/dev/check-serena.py` collects real provider evidence after `prepare`: PHP symbol lookup,
variables kept across cells, an edit that remains after a deliberately failed cell, and a reconnect that drops the
REPL's variables and keeps the edit. It edits only a uniquely named temporary probe, closes both sessions and removes
the probe; a per-worktree lock serializes runs. The receipt is `.state/serena-evidence.json` in this directory, and it
names the bound application. `--package` adds the installed package's CLI and Mate tools, an inspection of the bound
application and a targeted recovery of a customized probe, in the same session. The mocked harness tests do not
establish any of this.

Start a session with `initial_instructions`, use its session ID in every `serena_repl` call, and look up the current
operations before calling them:

```python
s.info('lsp.find_symbol', 'lsp.find_referencing_symbols')
s.lsp.find_symbol('DevelopmentController', relative_path='packages/uxor/dev/app/src/Controller/DevelopmentController.php')
```

A failed or interrupted cell may already have changed files: inspect the error and the source before retrying.
Nothing is replayed after a reconnect. PHPactor finds explicit PHP symbols and references; Twig, service names and
Stimulus names need a text search too, so an empty references result does not prove code unused.

## Checks

| Check | Command | In CI |
|---|---|---|
| The runner and Serena harness, without Docker or PHP | `python3 -m unittest discover -s packages/uxor/dev/tests -p 'test_*.py'` | *Package* |
| Install, update and remove the archive with Composer, use its Mate tools and skills and render the customized Kbd recipe across dev and production installs. | [Live Composer lifecycle in tmux](#live-composer-lifecycle-in-tmux) or `python3 packages/uxor/tools/check-package.py --consumer` | *Package* through tmux |
| Observe a quiet command from a live terminal and match its operation ID to the final timeline. | [Run the local observer](#observe-a-real-run-from-a-local-agent-session). For controller and journal cases, run `UXOR_TEST_TMUX=1 python3 -m unittest discover -s packages/uxor/dev/tests -p 'test_lifecycle_*.py'`. | *Package* exercises real attach/detach and observes the focused release upgrade. |
| The consumer's container, Twig and Mate | `python3 packages/uxor/dev/run.py --native check` | not yet |
| The customer workflow in a browser, then without development dependencies | `bash packages/uxor/dev/check-workflow.sh` after the [browser setup](#the-customer-workflow) | *Package* |
| The installed Mago launcher and its real language server, including empty scopes, a clean application, a type error and a symbol lookup | Prepare both providers in the [package README](../README.md#optional-php-checks-and-serena-with-mago), then run `uv run --script packages/uxor/dev/check-mago.py` from the repository root | *Mago providers* |
| The Docker stack and the editable Serena session | `run.py up`, `status`, `check`, `run.py serena --prepare`, then `check-serena.py --package` | *Development images* |

`check` lints the container and the Twig templates, lists Mate's tools and asks Mate about the compiled controller
service; `status` gets a real health response. Neither one replaces the browser journey or the archive install.

Two separately marked archives exercise Composer's automatic update hooks. The historical upgrade
uses the actual released and candidate distributions and can also run directly with
`python3 packages/uxor/tools/check-package.py --release-upgrade`.
