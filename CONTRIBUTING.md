# Contributing to UXor

This guide covers contributions to UXor's Symfony UX Toolkit recipes and its Composer development package.
The kit lives in the root `manifest.json` and the recipe directories. Root `composer.json` defines
`xormania/uxor`, with its code in `packages/uxor/`. To use either product in a Symfony application, start
with the [Composer setup guide](packages/uxor/README.md) or the [direct Toolkit setup](INSTALL.md).

The official Symfony UX `flowbite-4` kit was an initial reference only. UXor's requirements and compatibility
commitments govern its design, APIs, documentation and tests; inherited names, markup and behavior carry no
requirement to match that kit. Toolkit installation support, Flowbite CSS and the icon set are current integration
choices, which can change as UXor's needs change. Preserve legal attribution in `NOTICE` and assess changes to
shipped interfaces for compatibility, regardless of where their implementation began.

For a first contribution, fork the repository, create a descriptive branch from `dev`, and open a pull request
back to `dev`. A draft is welcome while you investigate or finish checks. Small fixes do not need a work order.
The [commit and pull request guide](#commits-and-pull-requests) explains the review process.

You do not need an AI assistant, a particular editor or access to the maintainer's services to contribute.
Use the checks relevant to your change, and describe any environment limitation in the pull request.

## Project boundaries

UXor has two deliverables: the Toolkit kit of UI recipes and the Composer development package `xormania/uxor`,
which supplies guidance and tools to applications using the kit. Each has its own development and verification work.

This guide governs contributions to UXor and publication of UXor project work. It is not a policy for applications
that install UXor: those applications keep their own instructions, ownership, review and release decisions.

| Context | Source or application root | Guidance and runtime |
|---|---|---|
| Toolkit contribution | Root `manifest.json` and top-level recipe directories | This guide and [root agent guidance](AGENTS.md); edit recipe sources here |
| Composer dev package development | Root `composer.json`; implementation in `packages/uxor/` | Root Composer dependencies and tests; packaged instructions and skills are product content for consuming applications |
| Project documentation website | `website/` | Builds release guides, recipe pages, portable Markdown and discovery files from the kit and Composer package sources. See [Docs](#docs). |
| Symfony example application and Toolkit test host | `demo/` | [Local Docker setup](#setup) and [demo guidance](demo/AGENTS.md). Pages uses the exported example app at `/demo/` and recipe previews at `/preview/`. The host also runs the local lab and form fixtures. |
| Package consumer fixture | `packages/uxor/dev/app/` | [Fixture guide](packages/uxor/dev/README.md); independent Composer application, runner and browser suite; installs the package and recipes through consumer workflows |
| Application using UXor | The application's own root | [FOR-AGENTS.md](FOR-AGENTS.md) for kit use; the installed package's instructions and skills for its tools; the application owner's governance and runtime |

Editing a packaged instruction or skill here is a contribution to UXor. Using that guidance in an installed
application is an application task; it must not import this repository's branch, publication or release policies.
The demo and package consumer fixture are separate test applications, not interchangeable environments. Diagnose
each application through the PHP runtime, dependencies, cache and Mate installation that actually serve it.

Read task-specific contributor procedures when needed: [Setup](#setup), [Checks](#checks), [Docs](#docs),
[Mago and Serena](#mago-and-serena) and [Releases](#releases). Keep personal preferences and work assignments in
local, ignored settings rather than tracked project guidance. The ignore rules cover `CLAUDE.local.md` and
`.claude/settings.local.json`; use equivalent private configuration for other clients.

## Repository layout

| Path | In the `ux:install` download | What it is |
|------|---------------------------|---|
| `manifest.json`, `INSTALL.md`, `kit.css`, `kit.js`, `icon.svg`, `<recipe>/` (minus `<recipe>/tests/`), `README.md`, `LICENSE`, `NOTICE` | yes | the kit, its readme and license |
| `composer.json` | yes | the Composer package `xormania/uxor`: its name, requirements, the autoload of `packages/uxor/src/` (`Xormania\UXor\`), the `uxor` executable and the Mate metadata. Composer and Packagist read it at the root; it has no `version`: the tags are the versions (*Releases*) |
| `packages/uxor/` (minus `tests/`, `tools/`, `dev/`, `phpunit.xml.dist`) | yes | the package's code and what it installs: the CLI (`bin/uxor`), its services (`config/`), the PHP (`src/`: the operations, the console commands, the Mate tools and resources), the guidance agents read (`INSTRUCTIONS.md`, `OPERATIONS.md`, `README.md`), the Mate skills (`skills/`), the workflow guides (`resources/workflows/`) and the bundled references (`resources/uxor/`: UXor's docs and recipe READMEs with an `index.json` of their SHA-256 and of their inputs', generated by `php packages/uxor/tools/generate-reference.php` from the working tree: never edit them by hand; regenerate them in the commit that changes a doc, recipe README or manifest they copy). It is not a recipe: it has no `manifest.json`, and the toolkit reads recipes one level down only |
| `composer.lock`, `packages/uxor/tests/`, `packages/uxor/phpunit.xml.dist`, `packages/uxor/tools/` | no | the package's development: its locked dependencies (consumers resolve their own), its PHPUnit tests (`composer test`), the archive payload check (`check-package.py`) and the reference generator (`ReferenceGenerator.php`, `generate-reference.php`) |
| `packages/uxor/dev/` | no | the package seen from an application that uses it ([`packages/uxor/dev/README.md`](packages/uxor/dev/README.md)): `app/`, an independent Symfony consumer with its own `composer.json` and lock file, which installs the package from the repository root (a path repository, `../../../..`); `run.py`, which prepares, serves and checks it natively or in UXor’s locally built image (`compose.yaml`, `Caddyfile` and the image recipe); `install-uxor.py`, which installs the workflow's recipes from this commit; the consumer's own browser check (`e2e/`, `playwright.config.mjs`, `package.json`); and the harness tests (`tests/`) |
| `website/` | no | Static project website. It renders release documentation, including the Composer package guides, from the checkout. |
| `demo/` | no | Symfony example app, browser fixtures and recipe previews. Its exporter saves a visual copy of the example app under `/demo/` and renders preview frames under `/preview/`. |
| `tools/sync-demo` | no | copies every recipe into `demo/` the way `ux:install --force` does |
| `tools/demo-php` | no | runs PHP in the demo's container, for the Playwright specs (`DEMO_URL`) |
| `tools/contrast/` | no | WCAG contrast check of the theme's color roles |
| `tools/llms-txt.mjs` | no | writes the website’s recipe category index, `llms.txt` and the recipe table of `FOR-AGENTS.md` from `docs/RECIPES.md`'s recipe tables, and checks the plans' status. It also maintains each recipe README’s published catalog link and offline lookup beside `::: installation` |
| `tools/docs-lint.mjs`, `tools/fence-coverage.mjs` | no | what the markdown examples teach, and a gallery page for every recipe and README example (*Docs*) |
| `tools/recipe-imports.mjs` | no | every relative import in a recipe's JavaScript names a file the recipe or its recipe dependencies install (*Checks*) |
| `tools/js-duplication.mjs` | no | the copies of code in the recipes' JavaScript: the duplicated lines stay within a budget, and no recipe declares again a name a shared module exports (*Checks*, *Shared code*) |
| `tools/readme-versions.mjs`, `tools/readme-pairing.mjs` | no | each recipe README renders its manifest's dependencies (`::: installation`) and writes no version table, and changes with the recipe's code unless a commit waives it (*Docs*) |
| `tools/icon-lint.mjs` | no | every icon in the recipes' templates and the markdown is a `flowbite:` name written in full (*Docs*) |
| `tools/ci/playwright-summary.mjs` | no | reads a CI shard's Playwright report: the job summary, annotations, `failed-attempts.json` and `durations.json` ([`docs/TESTING.md`](docs/TESTING.md), *Reading CI results*) |
| `tools/ci/jev-diagnosis.mjs`, `tools/ci/jev-ci.json`, `tools/ci/junit-attempts.mjs`, `tools/ci/step-attempts.mjs`, `.github/actions/jev-diagnosis/` | no | the advisory Jev diagnosis of each failed attempt in `failed-attempts.json`, and its policy; `junit-attempts.mjs` writes that file from a JUnit report (*Kit PHP*'s PHPUnit, *Tool tests*' Node), `step-attempts.mjs` from a failed step's captured log; the composite action is the one Jev step every job calls, collecting without the key, and `.github/workflows/jev.yml` the one job that diagnoses with it ([`docs/TESTING.md`](docs/TESTING.md), *Jev diagnosis*) |
| `tools/ci/ci-metrics.mjs` | no | CI's own numbers for later optimizations, report only: each browser shard's build cache and setup times (`job-metrics.json`), and in the *CI metrics* job the run's shard balance, setup and test time per shard, slowest tests and files, retried tests and every job's step times (`ci-metrics.json`) ([`docs/TESTING.md`](docs/TESTING.md), *CI metrics*) |
| `tools/ci/wait-for-job.mjs` | no | waits, bounded, for another job of the same run, found by its name through GitHub's API, and goes on only when it succeeded, in this attempt or in an earlier one this attempt did not re-run; it backs off (3 s to 15 s), stops after 60 requests and waits out a rate limit's reset rather than polling: the browser shards' wait for *Importmap packages* |
| `tools/ci/background.mjs` | no | starts a command in the background of a CI job and waits for it in a later step, bounded, failing with the command's own error: the browser jobs' Playwright image pull ([`docs/TESTING.md`](docs/TESTING.md), *CI metrics*) |
| `tools/ci/shard-plan.mjs`, `tests/shard-timings.json` | no | splits each browser's CI shards by recorded test time (`--test-list`), checks that the shards hold every test once, falls back to `--shard` without usable timings, and refreshes the timings from a run ([`docs/TESTING.md`](docs/TESTING.md), *Shard balance*) |
| `tools/ci/release-timings.mjs` | no | the release checks' timings against `tests/perf/baseline.json`, report only, and a new baseline from a run ([`docs/TESTING.md`](docs/TESTING.md), *Release checks*) |
| `tools/ci/release-evidence.mjs` | no | the release checks' structural evidence: each release project ran a test, each release spec ran and skipped none ([`docs/TESTING.md`](docs/TESTING.md), *Release checks*) |
| `tools/release-plan.sh` | no | what `release.yml` tags and publishes for each version: the commit, the tag's state, the notes; refuses a tag on another commit (*Releases*) |
| `tools/monthly/` | no | the monthly job's scope and reports: PHP coverage of the recipes' `src/` and Infection's surviving mutants, the controllers' JS coverage, the Firefox and WebKit screenshots against the Chromium baselines, the interaction timings, and the trends against the previous run ([`docs/TESTING.md`](docs/TESTING.md), *Monthly job*) |
| `tools/check-github-mentions.mjs`, `tools/hooks/commit-msg`, `.github/mention-allowlist` | no | the required account-reference check on pull request metadata and commit messages, plus a self-contained local hook (*Commits and pull requests*); this is not a complete public-attribution check |
| `tools/security-policy.mjs`, `tools/security-sinks.json` | no | the repository trust gate: immutable Actions, read-only workflow defaults, reviewed executable rendering sinks, no tracked generated output, current release support and protected agent instructions ([`docs/AGENT-ASSURANCE.md`](docs/AGENT-ASSURANCE.md)) |
| `tools/phpstan.neon` | no | PHPStan's level and extensions (Symfony, PHPUnit) for the recipes' PHP and the demo's tables and tests |
| `mago.toml`, `tools/mago`, `.codex/config.toml`, `.mcp.json` | no | local PHP checks and Serena navigation in the checkout ([Mago and Serena](#mago-and-serena)) |
| `tools/tests/` | no | the cases of `tools/ci-changes.sh`, `tools/ci/lane-evidence.mjs`, `tools/ci/playwright-summary.mjs`, `tools/ci/ci-metrics.mjs`, `tools/ci/shard-plan.mjs`, `tools/ci/background.mjs`, `tools/ci/wait-for-job.mjs`, `tools/ci/jev-diagnosis.mjs`, `tools/ci/junit-attempts.mjs`, `tools/ci/step-attempts.mjs`, `tools/ci/release-timings.mjs`, `tools/ci/release-evidence.mjs`, `tools/prepare-tests.mjs`, `tools/icon-lint.mjs`, `tools/readme-versions.mjs`, `tools/readme-pairing.mjs`, `tools/recipe-imports.mjs` and `tools/js-duplication.mjs` (both also on the kit itself), `tools/security-policy.mjs`, `tools/check-github-mentions.mjs` and `tools/release-plan.sh`; `release.yml`'s check and release jobs, with `gh`, `git push` and the install check stubbed; that every workflow reads only build caches some build writes; `sync-demo` parity with `ux:install`; install of the kit on a fresh Symfony skeleton (exported kit, Symfony 7.4) and in a fresh Symfony Docker project (GitHub's archive, Symfony 8.1) |
| `tests/e2e/`, `playwright.config.ts`, `<recipe>/tests/` | no | Playwright tests against the demo; screenshot baselines |
| `tests/perf/baseline.json` | no | the release checks' timing baseline: per step and metric, the median and spread, with the commit and date ([`docs/TESTING.md`](docs/TESTING.md), *Release checks*) |
| `tools/build-static.sh` | no | builds the documentation website and the static example app, separately in CI and together for Pages (*Releases*) |
| `tools/prepare-tests.mjs` | no | what the browser tests need, safe with several Playwright processes in one checkout: the recipe specs' runnable copies and the demo's CSS (*Checks*) |
| `FOR-AGENTS.md`, `llms.txt` | no | the page for coding agents given the repository's URL, and the list of every page for them ([llms.txt](https://llmstxt.org/)) |
| `docs/`, `.github/` | no | notes on the toolkit and platform behavior this repository works around ([`docs/NOTES.md`](docs/NOTES.md)), the demo's deployment boundary and route inventory ([`docs/DEMO-SECURITY.md`](docs/DEMO-SECURITY.md)), agent assurance and adversarial evaluations ([`docs/AGENT-ASSURANCE.md`](docs/AGENT-ASSURANCE.md)), a snippet that projects using the kit paste into their own `AGENTS.md` ([`docs/PROJECT-AGENTS-SNIPPET.md`](docs/PROJECT-AGENTS-SNIPPET.md)), the testing patterns ([`docs/TESTING.md`](docs/TESTING.md)), CODEOWNERS, CI, the gallery on GitHub Pages (`pages.yml`), CodeQL code scanning, the weekly npm, Composer and importmap dependency audits (`audit.yml`; all tracked npm and Composer lockfiles and the demo's and the consumer's `importmap.php`, also on relevant pull requests), the monthly coverage, mutation, cross-browser and timings reports (`monthly.yml`), the release checks (`release-checks.yml`: on the release pull request, daily on `dev` and by hand), Dependabot's update pull requests, the pull request template |

`ux:install` downloads GitHub's archive of the whole repository; `export-ignore` in `.gitattributes` keeps
everything else out of it (the demo, tests, tools, and repository files such as this one, `AGENTS.md`,
and `SECURITY.md`). Composer installs the package from the same archive, so it also receives the kit's files; the
package's runtime and agent files stay in it, its development files do not. Keep any new path out of the archive the
same way unless users of the kit or of the package need it.

## Setup

The demo runs in [Symfony Docker](https://github.com/dunglas/symfony-docker) with FrankenPHP in worker mode,
PHP 8.5 and HTTPS. Docker is enough to serve it locally. Symfony AssetMapper fetches browser packages and
TailwindBundle builds CSS with the standalone Tailwind binary. The [example app stylesheet](demo/assets/styles/demo-app.css)
scans the example app's templates. The [Toolkit fixture stylesheet](demo/assets/styles/toolkit-fixtures.css) scans labs,
forms, OAuth fixtures, and the recipe README examples. Both import [the installed Toolkit and shared host styles](demo/assets/styles/shared.css).
When adding utility sources, include each source in the stylesheet that uses it and in the
[CSS rebuild check](tools/prepare-tests.mjs).

```bash
(
    cd demo
    docker compose up --wait
    docker compose exec php php ../tools/sync-demo
    docker compose exec php bin/console app:build-styles
)
```

The first startup builds the image and installs the Composer packages. Add `--watch` to the Tailwind command to
rebuild CSS as you edit.

The demo starts with Xdebug off. To debug with it, set a mode on the `up` command, from `demo/`:
`XDEBUG_MODE=debug docker compose up --wait` (or `develop`); Compose recreates the container with the new setting.
Do not run the browser tests with `develop` on ([`docs/TESTING.md`](docs/TESTING.md), *Browsers*).

Open https://localhost to enter the example app (the demo listens on this machine only) and accept the certificate of Caddy's local
authority. The container sees the whole repository in `/app` and runs the demo from `/app/demo`, as on disk;
FrankenPHP restarts its workers when a file changes. After changing a recipe, run `tools/sync-demo` and
`app:build-styles` again. `tools/sync-demo` never deletes: remove a renamed or deleted recipe file from `demo/`
yourself. `docker compose down` stops the demo.

The demo image builds from the repository, not from `demo/`: `compose.override.yaml` sets `context: ..` and
`dockerfile: demo/Dockerfile`, and `demo/Dockerfile.dockerignore` is the list of what a build may read (BuildKit
uses it for this Dockerfile alone). To build it by hand, run `docker compose build` from `demo/`, or from the root
`docker buildx build -f demo/Dockerfile --target frankenphp_dev .`. `docker buildx bake` resolves a compose file's
relative `context` against its own working directory, not the file's, so CI's bake steps run from the root with
`--set '*.context=.'`.

The production image is the demo built to run on its own (target `frankenphp_prod`): the kit beside the app in the
image as on disk (`/app`, the app in `/app/demo`), its recipes copied and its CSS and assets compiled at build time.
GitHub Pages publishes only the static outputs described under [Releases](#releases). The dynamic app requires a production opt-in ([`docs/DEMO-SECURITY.md`](docs/DEMO-SECURITY.md)).
Build and check it with
`docker buildx build --platform linux/amd64 --target frankenphp_prod --load -t uxor-demo-prod -f demo/Dockerfile .`
then `tools/tests/prod-image.sh uxor-demo-prod`. The image copies whole directories of the checkout, so a local-only
file inside them (a `demo/config/packages/local.yaml`, a file a global gitignore hides) would be included: build it from
a clean clone, or run the harness's context check first (`tools/tests/prod-image.sh no-such-image`, which checks the
context without building). To run it yourself, pass `UXOR_DEMO_ALLOW_PRODUCTION=1`, a random
`APP_SECRET` of at least 32 characters and the Mercure keys `compose.yaml` sets (`docker run -e …`). CI builds and runs
it when the demo's files it holds or its build inputs change (*Production image*), and the release checks on every
release.

Without Docker, with PHP 8.4 or later and Composer: run `tools/sync-demo`, then
`(cd demo && composer install && php bin/console app:build-styles && php bin/console asset-map:compile)`, and serve
the demo with `php -S 127.0.0.1:8000 -t demo/public tools/plant-router.php`. The router forwards application
and AssetMapper routes to Symfony and serves public files directly. Recompile when using compiled assets.

For the repository's Node-based checks and Playwright runner, use Node.js (CI uses 22) and install the tooling
from the checkout root:

```bash
npm ci
cp tools/hooks/commit-msg "$(git rev-parse --git-path hooks)/commit-msg"   # once per clone, after reading it
```

Playwright's browser runs in Docker in the `mcr.microsoft.com/playwright` image pinned by digest in
`tools/playwright-image.json` so screenshots match the committed baselines. After bumping `@playwright/test`, run
`node tools/playwright-image.mjs --refresh` and commit the new pin ([`docs/NOTES.md`](docs/NOTES.md), *Screenshots*).

The Composer package is developed at the repository root, with PHP 8.4 or later and Composer, apart from the demo:
`composer install` (the root `vendor/`, from `composer.lock`), then `composer test`, and `php packages/uxor/bin/uxor list`
to run its CLI (Composer links `vendor/bin/uxor` in the applications that install the package, not in its own
checkout). It has its own requirements and lock file; the demo keeps `demo/composer.json` and `demo/vendor/`. To use
it from an application, `python3 packages/uxor/dev/run.py --native prepare` installs the independent consumer in
`packages/uxor/dev/app/` (its own `composer.json`, lock file and `vendor/`), and `--native serve` serves it; the same
runner builds the development PHP image from this repository ([`packages/uxor/dev/README.md`](packages/uxor/dev/README.md)).

To inspect the running demo from the command line (the profile of a request, the container's services), the demo
ships [Symfony AI Mate](https://symfony.com/doc/current/ai/components/mate.html) as a dev dependency. Set
`PROFILER_COLLECT=1` in `demo/.env.dev.local` and use the runtime serving the demo: from `demo/`, run
`docker compose exec php vendor/bin/mate tools:list` for the Compose stack, or `vendor/bin/mate tools:list` for a
native setup ([`docs/TESTING.md`](docs/TESTING.md), *Counts from the profiler*). Coding agents read
`demo/AGENTS.md`; Mate maintains the marked block, while repository guidance lives outside it.

The demo trusts the repository it serves. It compiles every `{"preview":true}` README example as a Twig template and
runs it with the app's services, and shows the result in its own origin, where the previews' frames share the
pages' cookies and storage. README examples are code: review them as such, and never run the demo on a kit, a
branch or a pull request you do not trust. Sandboxing the preview frames does not help: it stops their Stimulus
controllers. Previewing untrusted code would need a separate origin and container.

The public gallery is the static export. The dynamic application refuses to boot in production unless its operator
explicitly opts in and supplies a non-default secret; that is an accident guard, not permission to expose its lab and
trusted-code preview routes. See [`docs/DEMO-SECURITY.md`](docs/DEMO-SECURITY.md).

### Mago and Serena

The *Mago providers* workflow checks provider changes in pull requests against their base and on pushes to `dev`
and `main`.

Before running `tools/mago` or enabling the `uxor-mago` server in Codex or Claude Code, review the checkout's
launcher and `mago.toml`, including any configuration it inherits through `extends`. Use a checkout only if you
trust those files and the programs they select. The launcher runs on your host. Inside the provider container,
Mago can start worker programs declared under `[extension-hosts]` during analysis or language-server startup.
Application commands require `--trust-project-code` before the command because configured workers and Serena's
preparation checks can execute application PHP and its Composer autoloader. The default mount is read-only;
`--write` separately permits checkout changes, including repository metadata. Offline execution does not make
untrusted project code safe to run. Provider preparation, image/version queries and top-level help do not require
application trust.
[Mago extension hosts](https://mago.carthage.software/1.60.2/en/extensions/configuration/)

The checkout and Composer package share the same Mago 1.60.2 pins. The CLI uses the official release binary
in the official PHP 8.4.28 runtime. A separate UXor image builds language-server support from the same Mago
release and pins upstream Serena at `7f7d6245`. Both recipes ship with the Composer package and build Linux
containers for amd64 and arm64. Run `tools/mago pull` from Linux, macOS or a Windows WSL2 distribution
with access to Docker and the checkout. See [provider host setup](packages/uxor/OPERATIONS.md#prepare-the-providers-on-the-docker-host).
`UXOR_MAGO_IMAGE` selects a compatible custom build. [Mago 1.60.2](https://github.com/carthage-software/mago/releases/tag/1.60.2)

```bash
tools/mago pull cli
tools/mago version
tools/mago pull serena
tools/mago --trust-project-code format
tools/mago --trust-project-code lint
tools/mago --trust-project-code analyze
```

Mago checks the package, recipe PHP and demo PHP, including their tests. The development consumer
and test fixture apps have isolated `App\` namespaces and stay outside this shared scope. Run the
demo's Composer install from the setup above before analysis and navigation so Mago can resolve dependency types
from `demo/vendor/` for all three code areas. The checks run offline against a read-only checkout.
`tools/mago --trust-project-code format` checks formatting. `tools/mago --trust-project-code check` runs the three checks in order and stops
at the first failure. Run them individually to see every report while the existing diagnostics
are being addressed. PHPStan and the checks below still apply.

Codex loads the optional `uxor-mago` server from `.codex/config.toml` when you trust the checkout.
Claude Code reads `.mcp.json` and prompts for project-server approval. Review the server command and
the Mago configuration above before granting trust in Codex or approving the server in Claude Code.
The checked-in client bindings omit execution permission, so Serena refuses to start through those definitions.
For an authorized session, configure the MCP launch explicitly with the absolute path to the reviewed checkout's
`tools/mago` and `["--trust-project-code", "serena"]` as its arguments. Use the client's local configuration when
saving that choice; keep execution permission out of shared repository settings. A saved flag authorizes every
later connection at that path, including after branch changes, until it is removed. It does not expire with a commit.
To revoke it, stop the provider and remove that flag from the local client configuration before reconnecting.
The checkout's launcher must itself be trusted before it runs. Open the chosen checkout or a directory inside it so
the repository binding resolves that worktree's Git root. The server uses stdio and defaults to read-only PHP navigation.

To check the integration locally, run `uv run --script packages/uxor/dev/check-mago.py --repository`.
It looks up package, recipe and demo symbols and compares the analyzer's diagnostics with Serena's.

### Publishing consumer guides

Each entry in the [guide registry](packages/uxor/resources/guides.json) names one Markdown file, its public URL
slug, its product section and the task it helps a visitor complete. Register a guide once to publish it in the
website directory, HTML, portable Markdown, sitemap, machine-readable index and installed agent references.
Write onboarding and testing procedures in their source guides. Edit the recipe groupings in
[the toolkit catalog](docs/RECIPES.md). Both the website and the installed package use those groupings.

From a repository checkout with its Composer dependencies installed, run `composer docs:generate`
after editing a source. It refreshes the command and configuration guides first, then the category and discovery
indexes, then the installed reference bundle. Run `composer docs:check` to verify all three stages without
writing files. The [checks below](#checks) also list the individual generators.

## Checks

CI runs on every branch push and on pull requests from forks. Fork contributions are checked at their proposed
merge with the target branch; a maintainer may need to approve a first-time contributor's workflow run in GitHub.
Same-repository pull requests use their branch's push run, with a differently named skipped result on the pull
request event so it cannot satisfy the required *CI result* early. GitHub can display the unevaluated name
expression for this skipped job. Read the branch push's *CI result* for its verdict.
Each job runs when the change could affect what
it checks ([`tools/ci-changes.sh`](tools/ci-changes.sh)); pushes to `main`, and a full run by hand, run everything.

Feature pushes normally use their merge base with `dev`. For a release branch with a verified CI result, CI can use the nearer shared commit on that branch. A fork pull request uses the target base supplied by GitHub
and runs selected lanes fresh, without reusing evidence from other runs. A push to `dev` is compared with the commit
of its last successful run, so every merge since is checked; with none, everything runs. *Tool tests* runs in every
full CI run and checks what any path can break: bundled reference links, test inventory names and archive contents.

On a stacked or release branch, the comparison with `dev` can include work the parent branch already validated.
In the *Changes* job, *Plan the lanes* shows whether Chromium will run and the reason. A verified browser pass
can cover a package or documentation follow-up even on a branch's first push. See
[Reused lanes](docs/TESTING.md#reused-lanes) for the inputs and evidence that decide this.

Once a day on `dev`, the jobs that install freshly resolved dependencies run alone (both *Fresh install* jobs and
*Package*). GitHub schedules run on the default branch, `main`; each scheduled workflow starts its work on `dev`,
where fixes land. The rulesets require *CI result*, which passes when each applicable lane passed or reused valid
evidence. Daily and engines-only runs report their own result names, so they cannot satisfy that required check
([`docs/TESTING.md`](docs/TESTING.md), *Reused lanes*). Other required checks depend on the target branch.

`main` requires the branch to be up to date before merge. The current `dev` ruleset does not; maintainers may ask
for an update when another change affects the contribution. There is no merge queue. If *CI result* rejects reused
evidence that expired, disappeared or was superseded by a failure, use *Re-run all jobs*: it replans and runs the
lane. *Re-run failed jobs* keeps the first plan. The classifier is read from the comparison base, so a change cannot
alter its own lane selection; a lane that base does not know runs. A path with no classification counts as kit
input until the classifier and its tests say otherwise. A deletion counts as a change to its path, and a rename
as a change to both paths.

*Tool tests*, *Contrast* and *Workflows* below are checks, run as the steps of one job, *Quick checks*: Tool tests on
every run, the other two when selected. *Toolkit browser verification* runs the Toolkit's Chromium shards when selected
with no reusable result. *Demo app browser checks* runs the example app in one Chromium job. Firefox and WebKit run on `dev`'s daily run, on
`main`, in a manual run with *engines* and before a release, a trial set by `ENGINES_ON` in `ci.yml`
(`docs/TESTING.md`, *Browsers*).

To see which jobs a path selects, run the classifier from the repository root:

```sh
printf '%s\n' website/templates/pages/index.html.twig | bash tools/ci-changes.sh
git diff --name-only --no-renames <base> HEAD | bash tools/ci-changes.sh <base>
```

The [classifier cases](tools/tests/ci-changes.sh) cover individual and combined inputs. A change to
website navigation selects the website checks. A change to a recipe README can also affect live
previews because its annotated examples execute as Twig. A change to the browser diagnostics
recorder affects the Playwright fixtures that import it. The *Changes* job records the paths and
decisions for the actual run.

*Lint kit* lints the kit as users download it: a copy of `git archive`'s export with only `packages/` removed. The
toolkit's lint fails every root directory without a `manifest.json`, and `packages/` holds the Composer package, not a
recipe; any other directory without one still fails, so a recipe missing its manifest is still caught. Never add a
placeholder `manifest.json` to `packages/`, nor leave the package out of the archive to make the lint pass. The *Fresh
install* jobs install from the complete archive, `packages/` included.

*Quick checks* verifies that the generated references match their inputs and that `git archive HEAD` includes the
required kit and package payload. The archive checker reads the committed tree, so commit changes before using it.

*Package documentation* checks Composer metadata, the generated command guide and the reference tests when a change
reaches the package's docs without a fresh *Package* run. The classifier uses the comparison commit to recognize
documentation command edits in `composer.json` and prose edits under an unchanged release heading in `CHANGELOG.md`.

*Package* validates, installs, lints and tests the Composer package. Its archive consumer checks Mate
initialization and discovery, an upgrade that preserves application-owned work, and rendering without dev
dependencies. The independent [consumer fixture](packages/uxor/dev/README.md#checks) provides the locked
Chromium journey and production `/customers` check. Its check table lists the commands and their CI coverage.
[*Development images*](.github/workflows/development-images.yml) checks the consumer's Docker stack on matching
pushes and manual runs.

*Workflows* runs [actionlint](https://github.com/rhysd/actionlint) with ShellCheck on every workflow: YAML, expressions,
job graph, action and reusable workflow inputs, and the shell of each `run` step. Then it runs
`tools/tests/release-plan.sh` and `tools/release-plan.sh --dry-run --ref origin/main` (*Releases*): it fails when a
version's tag points at another commit than the one `release.yml` would tag.

The PHP ones run on your machine as shown, or in the container: prefix them with
`docker compose exec php` from `demo/`, with paths relative to `demo/`
(`docker compose exec php bash ../tools/tests/sync-demo.sh`).

```bash
# lint the kit as users download it, without packages/ (the Composer package; see Lint kit above). git archive exports committed files only: commit first
tmp=$(mktemp -d) && git archive HEAD | tar -x -C "$tmp" && rm -rf "$tmp/packages" && demo/vendor/bin/ux-toolkit-kit-lint "$tmp"
demo/vendor/bin/ux-toolkit-kit-debug .              # lists each recipe with its files and dependencies: check yours

node tools/contrast/check.mjs                       # every pair in tools/contrast/pairs.json meets its contrast minimum
cmp kit.css theme/assets/styles/uxor.css            # the theme recipe ships kit.css unchanged
node tools/llms-txt.mjs --check                     # website categories, llms.txt and the FOR-AGENTS.md recipe table match their sources (see Docs)
node tools/name-check.mjs                           # no file names a former repository of the kit (tools/kit-former-names.json) by its github.com, raw or gallery URL (see Renaming the kit)
node tools/docs-lint.mjs                            # no markdown example teaches Flowbite JS, palette colors, dark: overrides, inline handlers or styles; no recipe template uses a palette color (see Docs)
node tools/icon-lint.mjs                            # every icon in the recipes' templates and the markdown is a flowbite: name written in full; lists the names chosen by a Twig expression (see Docs)
node tools/fence-coverage.mjs                       # every README example is one the demo reads; after tools/build-static.sh _site, --site _site checks every recipe, example and linked demo destination
node tools/test-inventory.mjs                       # docs/TEST-INVENTORY.md has a matrix row per recipe with a controller, a row per rule of FOR-AGENTS.md's Working well, and names existing tests
node tools/readme-versions.mjs                      # each recipe README renders its manifest.json with ::: installation and has no version table (see Docs)
node tools/readme-pairing.mjs [--base <ref>]        # each recipe whose code your commits change has its README changed, or a Docs-waiver trailer; base: where HEAD left origin/dev (see Docs)
node tools/recipe-imports.mjs                       # every relative import in a recipe's JS names a file the recipe or its dependencies.recipe install (a shared module: floating, navigation, turbo)
node tools/js-duplication.mjs                       # the recipes' JS copies no run of 40 tokens beyond the budget it lists, and declares no name a shared module exports (see Shared code)
node tools/security-policy.mjs                      # immutable Actions and read-only defaults; reviewed executable sinks; no generated output; current support and protected agent rules
node --test tools/tests/*.test.mjs                  # the cases of the CI tools (tools/ci/: results summary, CI metrics, shard plan, Jev diagnosis, JUnit and step attempts), of tools/prepare-tests.mjs, of tools/icon-lint.mjs, of the README checks, of tools/recipe-imports.mjs and of tools/js-duplication.mjs, which also run them on the kit, and the repository security policy
tools/tests/sync-demo.sh                            # tools/sync-demo copies what ux:install copies, on a test kit (needs demo/vendor)
find ./*/src -name '*.php' -not -path './demo/*' -not -path './tools/*' -print0 | xargs -0 -n1 php -l   # the syntax of the recipes' PHP
(cd demo && CREATE_SNAPSHOTS=false bin/phpunit)                            # the PHP tests (demo/tests/): the data tables' limits, Live and Twig components, snapshots, profiler counts
dirs=(); for manifest in */manifest.json; do if [ -d "${manifest%/manifest.json}/src" ]; then dirs+=("${manifest%/manifest.json}/src"); fi; done
phpstan analyse -c tools/phpstan.neon --autoload-file=demo/vendor/autoload.php -- "${dirs[@]}" demo/src/Demo demo/tests   # use the locked tool with its Symfony and PHPUnit extensions
tools/tests/fresh-install.sh                        # a new Symfony app installs dashboard-home, signup and data-table from the last commit (PHP=…, COMPOSER_BIN=…: other binaries)
KIT_REF=<pushed commit SHA or tag> tools/tests/docker-install.sh   # the same in a new Symfony Docker project (Symfony 8.1), kit downloaded from GitHub
KIT_REF=<pushed commit SHA or tag> tools/tests/docker-install.sh --smoke   # Docker CI: representative installed pages, assets and a Live action over HTTPS
npx playwright test                                 # every browser test, in Chromium, Firefox and WebKit: see below
npx playwright test --project=smoke --project=examples   # Toolkit on Chromium, including screenshots
npx playwright test --project=demo-app                   # example app on Chromium, including layout screenshots
RELEASE_CHECKS=1 npx playwright test --project=release --project=release-dark --project=release-harsh --workers=1   # the three release browser projects (docs/TESTING.md also lists PHP properties and the production image)
node --test 'tools/monthly/*.test.mjs'              # the cases of the monthly job's report tools (tools/monthly/)
php tools/monthly/php-scope.php coverage/php        # the monthly job's PHP scope: coverage/php/phpunit.xml and infection.json5 (the recipes' src/)
(cd demo && bin/phpunit -c ../coverage/php/phpunit.xml --coverage-clover ../coverage/php/clover.xml) && node tools/monthly/php-coverage.mjs --out coverage/php coverage/php/clover.xml   # PHP coverage per recipe class (needs PCOV, or Xdebug with XDEBUG_MODE=coverage)
(cd demo && php infection.phar -c ../coverage/php/infection.json5) && node tools/monthly/infection.mjs --out coverage/php coverage/php/infection/infection.json   # Infection's MSI and surviving mutants (the PHAR CI pins in monthly.yml)
JS_COVERAGE=$PWD/coverage/js/raw npx playwright test --project=smoke --project=examples --project=demo-app && node tools/monthly/js-coverage.mjs --out coverage/js coverage/js/raw   # the controllers' JS coverage and the methods no test runs (Chromium)
PW_TIMINGS=1 PLAYWRIGHT_JSON_OUTPUT_NAME=coverage/timings.json npx playwright test tests/e2e/counts.spec.ts --project=smoke --repeat-each=5 --workers=1 --reporter=json && node tools/monthly/timings.mjs --out coverage/timings coverage/timings.json   # the interaction timings, report only (Chromium)
PW_SCREENSHOTS=all PLAYWRIGHT_JSON_OUTPUT_NAME=coverage/screens.json npx playwright test --project=smoke-firefox --project=examples-firefox --project=demo-app-firefox --retries=0 --reporter=json; node tools/monthly/screenshots.mjs --browser firefox --shard 1/1 --out coverage/screens coverage/screens.json   # Firefox's screenshots against the Chromium baselines (fails on any difference; the report reads it)
node tools/monthly/trends.mjs --out coverage/trends --php coverage/php/php-coverage.json --infection coverage/php/infection-summary.json --js coverage/js/js-coverage.json --timings coverage/timings/timings.json   # the numbers in one monthly.json, against --previous <monthly.json>
actionlint                                          # every workflow, with ShellCheck on its run steps (CI pins actionlint 1.7.12 and ShellCheck 0.11.0)

python3 packages/uxor/tools/validate-composer.py    # strict Composer validation of the package and lock; allows the two release-matched native provider pins
php packages/uxor/tools/generate-command-guide.php   # refresh the CLI and configuration references from the package (requires composer install)
php packages/uxor/tools/generate-reference.php      # refresh the Composer install command and bundle the guides from the working tree
php packages/uxor/tools/generate-reference.php --check   # the bundled references are up to date: lists the stale files, changes nothing
composer test                                       # the package's PHPUnit tests (packages/uxor/tests/, packages/uxor/phpunit.xml.dist)
python3 packages/uxor/tools/check-package.py        # the archive both installs receive holds what the script lists and composer.json declares, and nothing else: no development file, nothing outside the kit's root files, its recipes and the package's entries. It checks git archive HEAD, committed files only: commit first
php packages/uxor/bin/uxor list                     # the CLI starts and reads the bundled references
python3 -m unittest discover -s packages/uxor/dev/tests -p 'test_*.py'   # the consumer's development harness (roots, ownership, provider-check order), no Docker or PHP
python3 packages/uxor/tools/check-package.py --consumer   # that archive installed, updated and run without dev dependencies in the independent consumer (downloads its dependencies)
python3 packages/uxor/dev/run.py --native prepare && python3 packages/uxor/dev/run.py --native check   # the consumer's container, Twig and Mate (packages/uxor/dev/README.md)
```

Run `tools/sync-demo` and `bin/console app:build-styles` first so the PHP tests render the current recipes and CSS.
Use `CREATE_SNAPSHOTS=true bin/phpunit` to create intentionally added snapshots. A change in a component's markup changes its snapshot in
`demo/tests/Twig/__snapshots__/`: rewrite it with `UPDATE_SNAPSHOTS=true bin/phpunit` and review it like code. CI
runs them with `CREATE_SNAPSHOTS=false`, so a missing snapshot fails there. The patterns are in
[`docs/TESTING.md`](docs/TESTING.md) (*PHP tests*).

`npx playwright test` runs nine projects by default. Chromium uses `smoke`, `examples` and `demo-app`.
Firefox appends `-firefox` to each name and WebKit appends `-webkit`. Use `--project` to select one or
more projects. The standard Firefox and WebKit projects skip `@screenshot` comparisons and the broad axe
scans of `a11y.spec.ts`. See [Browsers](docs/TESTING.md#browsers) for the cross-browser screenshot report.

The [CI workflow](.github/workflows/ci.yml) uses eight Chromium shards for the Toolkit and one Chromium job
for the example app. Firefox and WebKit normally use three shards each. The dedicated `engines_only` dispatch
uses four per engine. Each shard has its own demo and browser. Each shard retries a failed test once and ends with its summary: the counts, every failed test and every
flaky one (passed only on its retry) with its error, on the run's *Summary* page, as annotations at the failing lines
and as the last step of the job log; a shard whose tests did not run says which step failed. A flaky test keeps the run
green but is reported as flaky, never as a clean pass. See [`docs/TESTING.md`](docs/TESTING.md), *Reading CI results*.

The demo's importmap packages are downloaded once per run, by the *Importmap packages* job (three attempts against
the CDN), and shared as the `importmap-packages` artifact with the active browser shards,
*Kit PHP* and *Runtime export*. AssetMapper skips a package that is already there, so their installs download nothing;
each shard checks that its install left the packages as downloaded. The shards do not queue behind that job: they
start beside it and wait for it by name just before they need its artifact ([`tools/ci/wait-for-job.mjs`](tools/ci/wait-for-job.mjs)),
and fail naming it when it did not succeed. The *Fresh install* jobs still download for themselves: that is part of
what they check.
A shard with a failed or flaky test then asks Jev (TypeSafe) for a likely cause of each failed attempt, at most 10 per
shard: a warning per attempt and the `jev-run-<source run>-<source attempt>` artifact, kept 30 days. It is advisory: it cannot
fail the job, and the attempt's sanitized error and server log excerpts are sent to TypeSafe. Every other job that can
fail does the same on a failure: *Kit PHP* (each failed PHPUnit test), *Tool tests* (each failed case, from Node's
JUnit report), and, from the failed step's captured log, *Lint kit*, *Importmap packages*, *Static site*, *Runtime export*, both *Fresh
install* jobs, *Contrast*, *Workflows*, *Changes*, *Package*, the monthly PHP job, both audits, *Mentions*, the
release's install check, tag and release, and the gallery's build (collected by `pages.yml`'s own *Jev diagnosis* job from the build's log, since the build job checks out a release and runs no local action). The
failed job collects its attempts with one composite action, [`.github/actions/jev-diagnosis`](.github/actions/jev-diagnosis/action.yml),
without the key; the independent *Jev diagnosis* workflow ([`.github/workflows/jev.yml`](.github/workflows/jev.yml))
consumes that source run and attempt's artifacts after completion. GitHub loads its YAML from the default branch;
it runs the trusted branch's `tools/ci`, and producers never receive or forward the key. Diagnostics and assessments
appear in that separate run, as `jev-run-<source run>-<source attempt>`. It becomes active when the consumer reaches
the default branch through a release. See *Jev diagnosis* in the same section for rollout and the environment setting
needed to protect a repository secret from a malicious branch writer.

- `smoke` checks Toolkit behavior, including forms, Turbo and Live Component labs, hostile props, CSP and
  interaction counts. Its Chromium accessibility scans cover forms, labs and actual light and dark recipe
  previews. See [Interaction counts](docs/TESTING.md#interaction-counts).
- `examples` compares the README example screenshots and runs each recipe's own specs
  (`<recipe>/tests/*.spec.ts`, prepared under `tests/e2e/examples/recipes/`).
- `demo-app` checks the example application's `/demo` routes, including behavior, accessibility and layout
  screenshots. Shared specs use `@demo-app` to select the cases owned by that project.
- The separate [website browser suite](website/tests/browser/website.spec.ts) scans the generated index, guides
  and recipe pages. It checks the preview iframe URLs and excludes iframe contents from its axe scan.

A test that brings a new technique (a way to provoke a state, to observe a cost, to send what a crafted request
sends) is written up in [`docs/TESTING.md`](docs/TESTING.md), with its core and a link to the spec: apps built with
the kit reuse those patterns.

Every test of every project blocks requests leaving the demo, and fails on a console error, a page error, a local
request that fails or answers >= 400, or a Content Security Policy violation (`tests/e2e/fixtures.ts`).
The demo enforces a strict policy (`demo/src/EventListener/SecurityHeadersListener.php`): scripts and styles run
only with the request's nonces, which the layouts print (`layouts/README.md`), and no inline event handler or style
attribute runs, README previews included.

Against the Docker demo, run `DEMO_URL=https://localhost npx playwright test --workers=2`: the specs then run PHP in
the container (`tools/demo-php`). Two workers is what each CI shard runs, against its own demo. A demo started with
other ports or a project name (`docker compose -p <name>`) needs `COMPOSE_PROJECT_NAME`, `HTTP_PORT`, `HTTPS_PORT` and
`HTTP3_PORT` exported in the shell for every command, because `tools/demo-php` finds the project only from the
environment, and a later `docker compose up` (such as turning Xdebug on) without the ports recreates the demo on the
default ports. Put the HTTPS port in `DEMO_URL` (`https://localhost:8443`). For a manually started native demo, pass its URL in `DEMO_URL` and route Symfony requests with the native setup command above.
For an already running native server, also set `PHP_BINARY=php` or its PHP executable. For managed native servers,
choose a free `DEMO_PORT`. [The Playwright configuration](playwright.config.ts) defines how the tests connect to
the browser server. Before tests run, `tools/prepare-tests.mjs` checks the source digest for each stylesheet
in `demo/var/tailwind/<entrypoint>.sources.sha256`. The example app uses `demo-app`. Labs, forms and recipe
previews use `toolkit-fixtures`, whose inputs include the README examples. Both use the shared recipe and host
styles. Playwright prepares runnable copies of the recipe specs in `tests/e2e/examples/recipes/` when it loads
its configuration and rebuilds changed CSS before running tests. Each step holds a lock so concurrent test
processes can share a checkout. When the server uses compiled assets in `demo/public/assets/`, rerun
`bin/console asset-map:compile` from `demo/` after rebuilding CSS.

The [website](#docs) lists each recipe's examples at `/r/<recipe>/`. The Symfony host renders individual
previews at `/preview/<recipe>/<example>?theme=light` or `?theme=dark`. The example ID comes from the
preceding heading, with `default` under the recipe title and `-2`, `-3` and so on for repeated headings.

### Image pins

Hosted browser CI uses the Microsoft Playwright image pinned in
[`tools/playwright-image.json`](tools/playwright-image.json). Xorder provides independent development images that can
be used for local diagnostics.

The [Refresh images workflow](.github/workflows/refresh-images.yml) checks the Playwright image and the packaged
browser pins daily. It proposes pin updates through ordinary PR checks. Set the repository variable `UXOR_IMAGE_REFRESH_APP_CLIENT_ID`
to the client ID of an App installed only for this repository with Contents and Pull requests write access.
Put `UXOR_IMAGE_REFRESH_APP_PRIVATE_KEY` in the `image-refresh` environment and restrict deployment branches
for that environment to `main`. Without the App configuration the workflow reports available changes.
Dependabot's regular version checks have a later weekly slot. GitHub runs the schedules after the workflows
are on the default branch.

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
  `|e('html_attr_relaxed')` and dropped when it starts with `on`. A template that prints its `attributes` on an
  element checks them first, with the line after `{% props %}` in `button/templates/components/Button.html.twig`
  (or at the top, without props): no `on…`, `srcset` or `ping`, and `href`, `formaction` and `src`, in any case,
  through the link and image policies; one that only passes them to another component (`{{ ...attributes }}`)
  leaves it to that component. A link prop goes through the scheme guard of
  `breadcrumb/templates/components/Breadcrumb/Item.html.twig`, and the template prints the guarded variable. Add each
  new one to `demo/src/Command/HostilePropsCommand.php`, which `tests/e2e/hostile-props.spec.ts` checks; it renders
  every component given `on…` attributes on its own (add the markup of one that does not render alone).
- **Recipe format** (checked by `ux-toolkit-kit-lint`):
  - `manifest.json` with `type` and `name`;
  - `README.md` opening with `# Title`, then a one-line summary;
  - each prop in `{% props %}` preceded by a `## <type> <description>` line, and each `{% block %}` preceded by a
    `{##- <description> -#}` comment (see `stat-card/templates/components/StatCard.html.twig`);
  - root element `attributes.defaults({...|tailwind_classes})`, variants with `html_cva`;
  - a controller's `@target`, `@value` and `@action` comment tags, if it has any, match its code.
- **Naming.** Recipe folders in lower kebab case (`stat-card`), components in PascalCase (`StatCard`, parts
  `Sidebar:Item`), controller files in snake case and used in kebab case (`theme_toggle_controller.js`,
  `data-controller="theme-toggle"`). Recipe and controller names are UXor interfaces; their origin does not constrain
  naming. Treat changes to shipped names as compatibility changes and document any migration.
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
  `transitionend` that may not come. Use the theme's `--uxor-motion-duration-fast` (100ms) for short feedback and
  `--uxor-motion-duration-normal` (150ms) for drawer and chart entrances. CSS entrances share
  `--uxor-motion-ease-out`. Update focus and selection as soon as the user acts. `tests/e2e/motion.spec.ts`
  checks each moving recipe.
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
- **Never commit** `vendor/`, `demo/vendor/`, `demo/var/`, `demo/public/assets/`, `demo/assets/vendor/`, `node_modules/`,
  Playwright output (`test-results/`, `playwright-report/`, `playwright-results/`).

### CI and test names

- **Workflows** use short sentence-case names for their responsibility, such as *Release checks* or *Refresh image
  pins*.
- **Jobs** use short sentence-case names that identify what they validate or produce, such as *Browser checks* or
  *Lint kit*. Use a literal display name for a job that can be skipped before matrix expansion. GitHub shows
  that name as written when the job is skipped. Keep the condition at job level so a skip uses no runner.
- **Matrix variants** append the inputs that distinguish each running job in parentheses. Use
  `(<suite>, <browser> <shard>/<total>)` for browser shards, as in *Browser checks (Toolkit browser verification,
  chromium 2/8)*, and the selected version or target for other matrices, as in *Lint kit (locked)*. Keep the base
  name consistent across variants. Verify the labels in Actions for both a run and a skip when changing them.
- **Steps** start with an action verb and name its target, such as *Verify the published release tag*.
- **Job and step IDs** use lower kebab case and describe the job or step's role, as in `lint-kit` or `verify-tag`.
  Keep IDs stable when changing display names.
- **Test titles** state the expected behavior in the present tense and include the condition that changes it. For
  example, `the deploy stops when a newer release appears or the tag moves`. Use group names for shared context
  and include the case or input in parameterized titles. Follow the framework's convention for method names.
- **Names read by tooling** are compatibility interfaces. Search for the exact name in workflow triggers, evidence
  checks, metrics, diagnostics and test selectors before renaming it. Update the consumers and fixtures together.
  Coordinate required check renames with the maintainer and the target branch rulesets. Reserve *CI result* for
  the required full verdict. Use distinct names for partial and skipped verdicts so they cannot satisfy that check.

## Adding a recipe

1. Create `<recipe>/manifest.json`. Copy the pinned `$schema` URL from one of this kit's own recipes (`stat-card`),
   which describes the current Toolkit installation format. Then set:
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
4. Run `tools/sync-demo`, then `(cd demo && php bin/console app:build-styles && php bin/console asset-map:compile)`: the
   host serves the compiled CSS. Open `/preview/<recipe>/<example>?theme=dark` on the running [Symfony host](#setup).
   To review the rendered documentation and its embedded previews together, build the complete [local site](#docs)
   and open `/uxor/r/<recipe>/`.
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
   - add its path to `tests/e2e/lab-pages.json`. For a route without GET, record its route name and reason in
     `NON_PAGE_ROUTES` in `demo/tests/Functional/LabPageInventoryTest.php`.

   Either way, add the recipe's row to the matrix of `docs/TEST-INVENTORY.md`: `node tools/test-inventory.mjs` fails
   while a recipe with a controller has no row. `LabPageInventoryTest` checks the scan against Symfony's registered routes.

   If the recipe puts a text, icon or bar color on a background that `tools/contrast/pairs.json` does not cover yet,
   add a row there: `fg`, `bg`, `min` (4.5 for text, 3 for icons, bars and focus rings) and `usage`.
7. Add a row for the recipe to the matching table in `docs/RECIPES.md` (mark it ✦ if it ships a Stimulus
   controller), run `composer docs:generate` to refresh the website categories, agent indexes and package references,
   and add an entry to `CHANGELOG.md` (see *Changelog*). If it is close to another recipe, say which to pick in the list under
   that table (*Which recipe*). Commit, then run
   the checks that cover a new recipe: the kit lint, `ux-toolkit-kit-debug`, `node tools/contrast/check.mjs` if you added pairs, and
   `npx playwright test`. CI runs all of them.

## Docs

Build the project website from the repository root with PHP, Composer and Node.js:

```sh
tools/build-static.sh _site --website-only --base-path=/uxor
```

The website reads the package's guide catalog, the Markdown it references and the kit's recipe
sources. Edit a guide at its source. The same tagged content reaches GitHub, the published
website and the installed agent references. Website templates, styles and navigation live in
`website/`. This build works without installing the example application.

A complete release adds the example app and rendered recipe previews from a second build.
To inspect the combined site locally, serve both outputs under the same base path:

```sh
tools/build-static.sh _site/uxor --base-path=/uxor
python3 -m http.server 8001 --bind 127.0.0.1 --directory _site
```

Open `http://127.0.0.1:8001/uxor/` for the documentation or `/uxor/demo/` for the visual example app.
Run the [Symfony host](#setup)
to exercise features that need a Symfony server.

The recipe tables in `docs/RECIPES.md` supply the website’s category index, the recipe lists in
`FOR-AGENTS.md` and the release index in `llms.txt`. Edit the table once, then run
`composer docs:generate` and commit the resulting indexes and packaged references. Within that
command, `node tools/llms-txt.mjs` generates the category and discovery indexes. CI runs its
`--check` mode in *Contrast*. It fails when:

- a directory with a `manifest.json` is missing from the tables, listed twice, or a row names no recipe;
- a plan's status does not match the recipes that ship (*Plans* below);
- the website category index in `website/resources/recipe-categories.json`, `llms.txt` or the generated recipe
  table in `FOR-AGENTS.md` differs from the generator output;
- `FOR-AGENTS.md` or `docs/PROJECT-AGENTS-SNIPPET.md` names a recipe that does not exist (`ux:install <name>`, a
  `<name>/README.md` link).

`llms.txt` describes a published release, never a branch: the version of the newest `## [X.Y.Z]` heading in
`CHANGELOG.md` (the tag `release.yml` puts on the commit that adds it). On the release pull request, before the tag
exists, the script writes it from the working tree with its links at that version; once the tag exists, `llms.txt`
is the copy the tag holds, so a recipe merged since never appears in it before its release. The script reads the
tags (`git fetch --tags` in a shallow clone); `--check` says when the file differs.

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
demo does (`tools/kit/KitReader.php`): a block opening at the start of a line with
```` ```<language> {"preview":true} ```` is an example, named after the heading above it. A block that looks like
one but that the demo skips (indented in a list, JSON that does not parse, `"preview"` not `true`) fails, and so does
a recipe without a README. `tools/build-static.sh` (*Static site*, `pages.yml`) runs it again with `--site` on the assembled release: every recipe needs its `r/<recipe>/` page and a link from the index, every example its light and
dark preview pages, and a saved page that no source names fails too. It then checks the discovery files: `sitemap.xml`
lists every recipe page under the base path and neither of them names the export's own origin, and each Markdown file
`llms.txt` links on the site is one the copy holds (by default the repository's GitHub Pages URL).

**READMEs state the manifest.** `node tools/readme-versions.mjs` (in *Contrast*) reads each recipe's `README.md`.
It must have the `::: installation` line, on a line of its own outside code blocks: the toolkit renders the install
steps from the recipe's `manifest.json`, which is what `ux:install` reads, so the versions match by construction. A
README writes no version of its own: a table with a Version column outside code blocks fails, even one that matches
the manifest. There is no waiver: fix the README.

**A recipe change comes with its README.** `node tools/readme-pairing.mjs` (in *Contrast*) reads the branch's changes
since the comparison base the *Changes* job computes in the workflow (a merge that brings `dev` in adds
nothing). A recipe whose code changed (any file under it but `README.md` and `tests/`, its `manifest.json`
included) fails unless its `README.md` changed too, or a commit of the branch waives it with a trailer, in the last
paragraph of its message:

```text
fix(alert): correct the variant class order

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
GitHub, run `node tools/llms-txt.mjs`, then `node tools/name-check.mjs` (CI's *Tool tests*, in *Quick checks*, runs it), which lists
every URL of a former repository (`github.com/<owner>/<repo>`, its raw files, `<owner>.github.io/<repo>`) in any
file, and the homepage's repository written in another case; the owner's other repositories pass;
`CHANGELOG.md`'s released sections are history and are left as written. The display name in prose (`UXor is…`) and
the code names (`App\UXor`, `uxor-*.js`, `uxor*.css`) are renamed by hand, with a breaking entry in `CHANGELOG.md`.

## Screenshots

`<recipe>/tests/screenshots/*.png` are the baselines Playwright compares screenshots with. Never update them as a
side effect. A visual change is a commit of its own:

1. Run `npx playwright test --project=examples --project=demo-app --update-snapshots`. It rewrites every baseline that differs.
2. Keep only the files you meant to change (check `git status`), and review them.

## Commits and pull requests

**Commit titles** use `type(scope): verb and outcome`, or `type: verb and outcome` when the change spans areas.
Write in plain words, begin the description with an imperative verb, and keep it to 72 characters without a
trailing period.

- `type`: `feat` (new recipe or behavior), `fix`, `docs`, `test`, `ci`, `chore` (tooling, dependencies).
- `scope`: the recipe (`sidebar`, `form-theme`) or the area (`demo`, `ci`, `tools`), in lower kebab case.
- Use the body to explain why and what was checked when the title needs more context.

Examples include `feat(stat-card): show the trend as text` and `fix(layouts): show flash messages in every layout`.

**Branches** use `type/short-topic` for ordinary contributions. Choose a commit type and a lower-kebab-case topic
that describe the work, such as `fix/modal-focus` or `docs/install-guide`. Keep agent, provider and harness names
out of branch prefixes and topics. Start work branches from `dev` and target ordinary pull requests at `dev`.
Maintainers use `release/X.Y.Z` for release branches that target `main` (*Releases* below). Work orders use the
names below, and automation uses its configured branch names. Existing integration and release branches can
finish under their current names. Maintainers review and merge contributions. Contributors can use a fork
and need only the permissions to open a pull request.

**Trying unreleased work in an app.** The consumer documentation (README, `INSTALL.md`, the guide, `FOR-AGENTS.md`,
`llms.txt`, the gallery) names a release ([`docs/PLAN-docs-automation.md`](docs/PLAN-docs-automation.md)).
Installing from a branch is for contributors: `--kit=https://github.com/xormania/uxor:dev` takes the work merged
since the last release, and a full 40-character commit SHA takes one commit (a branch name holding `/`, such as
`feat/x`, does not work: use its SHA). Without a version, `ux:install` takes `main`.

**Work orders (optional):** for a larger change, agree with a maintainer whether linked pull requests or an
integration branch will make review easier. Ordinary contributions need no work order or particular agent.

- An integration branch uses `work/<name>`, with jobs on `work/<name>--<job>`. Use lower kebab case for each name
  and job. The double hyphen avoids Git's conflict between a branch and a directory of the same name.
- Before using an integration branch, a maintainer verifies its branch pattern is covered by a
  [ruleset](https://github.com/xormania/uxor/rules) requiring pull requests, *CI result*, *CodeQL* and resolved
  conversations. The `work-orders` ruleset should include `work/*` and exclude `work/*--*` job branches.
  Keep earlier patterns while their integration branches are active. Jobs merge by pull request;
  updates from `dev` also arrive through a job, such as
  `work/<name>--sync`. Contributors should not push directly to the protected integration branch.
- Its draft pull request into `dev` records the objective, completion criteria, links to the jobs and remaining
  work. Each job receives normal review and includes the documentation, changelog and test evidence its change needs.
- CI runs on each integration merge. Existing lane evidence can be reused only under the ordinary CI rules
  ([`docs/TESTING.md`](docs/TESTING.md), *Reused lanes*).
- Mark the final pull request ready when its agreed scope is complete, it includes current `dev`, its checks pass
  and the description explains how the completion criteria were met. Record deferred or superseded work with links.
  The maintainer decides when to merge and when completed branches can be removed.

**Pull request titles** follow the commit title format and describe the overall outcome, such as
`ci: give skipped jobs readable names`. Keep each pull request to one topic. Use GitHub's Draft status while
work is in progress and [the template](.github/pull_request_template.md) to explain why and how it was checked.
GitHub-generated merge titles and automated dependency pull requests use their generated form.

For behavior or test changes, identify the affected guarantees and their tests, including coverage added, changed
or removed, reused test support and any remaining gaps. A short paragraph or list is enough; use a coverage table
when it makes a larger change easier to review. Update [`docs/TEST-INVENTORY.md`](docs/TEST-INVENTORY.md) when its
coverage map changes. Documentation-only changes can simply say that no runtime behavior changed. Report checks
as passed, failed or not run, and give the relevant CI result for the current commit before merge.

**Authorship and credit:** commit under your own chosen Git identity and preserve other contributors' human
authorship. Accurate human co-author trailers and acknowledgements are welcome. Preserve required legal attribution.
You remain responsible for reviewing the code, its provenance and the evidence you submit.

**Public work attribution:** do not publish which AI model, assistant, provider or version performed, reviewed or
routed project work. This applies to commit metadata and messages, branch names, pull requests, issues, reviews,
comments, repository files and published reports or artifacts. Omit AI co-author trailers, generated attribution
footers, identifying delegation or task-routing records, and session traces or links that disclose those assignments.

Technical documentation may identify a tool, dependency or supported integration to explain product behavior,
configuration or compatibility. It must not use that documentation to identify the AI system behind a project task.

**Account references:** the existing mention restriction remains in force. Pull request titles, descriptions and
commit messages must not contain an at-sign directly followed by an account or team name, including in code spans,
unless [`.github/mention-allowlist`](.github/mention-allowlist) permits it. Apply the same rule to comments and review
replies. Describe test tags, package scopes and bot commands in words in these public messages; a required account
reference needs the maintainer's agreement and an allowlist entry.

The *Metadata* workflow checks titles, descriptions and commit messages with
[`tools/check-github-mentions.mjs`](tools/check-github-mentions.mjs). Dependabot's own pull requests are exempt.
When a release carries dependency-update commits, an exemption requires GitHub evidence of a merged Dependabot
pull request in this repository; a human commit in it is still checked, and unavailable evidence grants no exemption.
The release's own title and description are always checked.

For a local preflight, install the reviewed, self-contained `tools/hooks/commit-msg` copy described in *Setup*.
Do not point `core.hooksPath` at unreviewed tracked code. The mention check covers account-reference syntax.
Review public text and attachments for AI execution attribution separately; passing that check does not prove
compliance with the public work attribution rule.

Use plain words throughout. Pull requests are merged with a merge commit (no squash, no rebase), preserving the
branch's commits and their authorship.

**Changelog.** Record user-visible changes in the pull request that makes them. During development, add the
entry under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md). When the pull request targets a prepared release
branch, add it to that release's numbered section so it appears in the published notes. Use the appropriate
`Added`, `Changed`, `Fixed` or `Removed` category and describe the change from the user's perspective.

## Releases

Versions are git tags `X.Y.Z` without a `v`, for compatibility with supported Toolkit versions
(see [`docs/NOTES.md`](docs/NOTES.md)). The version is declared in one place: a
`## [X.Y.Z] - YYYY-MM-DD` heading in `CHANGELOG.md`. The root `composer.json` has no `version` field:
Composer reads the version from the tag. The kit and the Composer development package share this version sequence.

The release workflow pushes the tag to GitHub. Packagist automatically indexes that tag as a version of
[`xormania/uxor`](https://packagist.org/packages/xormania/uxor). To verify publication, select the version on
Packagist and compare its source commit with `git rev-list -n 1 X.Y.Z` in a checkout with the tag.
Packagist also lists development versions such as `dev-main`. A release branch can appear there before its tag.

The maintainer chooses each release number and may skip unused numbers. An agent preparing a release uses the
number the maintainer supplied; changelog categories do not select it. UXor is in the initial `0.x` development
stage described by [Semantic Versioning](https://semver.org/): its public interfaces are not yet stable.
The changelog and release notes describe changes and migration needs, including anything that breaks installed
recipes or the package's commands, Mate tools, `uxor://` resources or skills.

The current release tools publish plain `X.Y.Z` versions. Prereleases such as `0.3.5-rc.1` need support in
version parsing, generated references and release publication before this workflow can publish them correctly.
The public gallery currently follows the latest non-prerelease.

When the maintainer decides to release, create `release/X.Y.Z` from `dev` and open its pull request
to `main` as a draft. Its release commit moves the entries under `## [Unreleased]` to the chosen version's dated
section, leaves an empty `## [Unreleased]` section, and updates the compare links at the bottom. Compare with the
previous actual release: a release of `0.3.5` after `0.3.2` links `0.3.2...0.3.5`; skipped numbers need no headings
or tags. Date the heading when preparing the release. GitHub records when it is published.

Run `node tools/llms-txt.mjs` and `php packages/uxor/tools/generate-reference.php` in that commit. Both take the
version from the new changelog heading, so the commit that release.yml tags already contains references linking
the chosen tag. During ordinary development, the generated references keep the last release's version.

CI runs on the release pull request, as do the release checks (`release-checks.yml`: timings, harsh conditions,
long sessions, wide matrices, fuzzing and properties; [`docs/TESTING.md`](docs/TESTING.md), *Release checks*).
Their timings report against the baseline and fail nothing until their tolerances are set; the other checks can
fail. The release pull request must satisfy all checks required by
[`main`'s ruleset](https://github.com/xormania/uxor/rules), including *CI result* and *Release checks*.
Merging it starts publication after CI passes on `main`.

A fix that cannot wait for the next development release starts from `main` on `release/X.Y.Z` and goes to
`main` in its own pull request. The maintainer chooses its version too; prepare its changelog heading, references
and checks as above. This keeps unrelated work on `dev` out of the urgent release.

After each release, including an urgent fix, merge `main` back into `dev` in a pull request of its own
(`git checkout -b sync/X.Y.Z origin/dev && git merge --no-ff origin/main`, with nothing else in it).
The tag `X.Y.Z` is on the release pull request's merge commit, which only `main` holds: until `dev` contains it,
`git describe` on `dev` (`tools/build-static.sh` reads it) still names the previous release, and the next release
pull request may need `main` merged into it before it can merge.

Once the release pull request is merged and CI has passed on `main`, `.github/workflows/release.yml` does the rest: its
*Check the new version's install* job, with a read-only token, checks that the merge commit installs from GitHub in a
fresh Symfony Docker project (`tools/tests/docker-install.sh`); then its *Tag and publish new versions* job, which
runs no install and keeps no credentials in its checkout, tags that commit `X.Y.Z` (only if that very commit's
install was checked) and publishes a GitHub Release with the section as its notes, marked *Latest*. Both jobs check out
`main` by name and read the commit CI passed on as history (it must be on `main`), so the code they run is `main`'s. If it fails, fix the cause and re-run it: it skips what is already done. An older version that is
tagged but has no Release (a tag pushed by hand, a run that stopped before its Release) gets its Release in the same
run, after the new one: its notes, not *Latest*, and no install check, since today's check installs today's recipes,
which an older version lacks. That step is best effort: if it fails, it warns, and the job and the gallery go on. An
older version with neither tag nor Release is never tagged by the workflow: it warns with the command to tag it by
hand, and a re-run publishes its Release.

[`tools/release-plan.sh`](tools/release-plan.sh) makes that decision for each version: the commit is the first one of
`main`'s first-parent history that adds the version's heading (the release pull request's merge commit), the notes
are the version's section of `CHANGELOG.md` at that commit (a later edit to an old section changes no published
notes), and an existing tag, lightweight or annotated, must point at that commit. A tag that points elsewhere is
refused: the run fails at *Plan the tags*, before any install check, tag or release. Compare the tag, the planned
commit and the version on Packagist with the maintainer. Packagist [locks a stable release's source and dist
references](https://packagist.org/about/version-immutability). A correction to a published package needs a new
release number. See the plan before a release, or after a refusal, with
`git fetch origin main --tags && tools/release-plan.sh --dry-run --ref origin/main`: for every version, the tag, the
commit, whether the tag exists and where it points, the decision and the notes; it creates nothing. CI's *Workflows*
job runs the same dry run, and the script's cases (`tools/tests/release-plan.sh`), whenever `release.yml` or the
script changes. If GitHub refuses the workflow's tag push
("refusing to allow a GitHub App to create or update workflow … without `workflows` permission", as for `0.1.0`,
whose commit's workflows differed from `main`'s), push the tag by hand
(`git tag -a X.Y.Z <merge commit> -m "UXor X.Y.Z" && git push origin X.Y.Z`) and re-run the workflow: it
checks the tag and publishes the Release. After a release, it publishes the gallery on GitHub Pages (`pages.yml`,
given the version it released). The gallery always shows the latest published release
([`docs/PLAN-docs-automation.md`](docs/PLAN-docs-automation.md)): `pages.yml` reads GitHub's latest Release (never a
draft or a prerelease) and the commit its tag points at from the API alone, and stops if release.yml's version is not
that one; no input chooses what is checked out, since the build runs in the default branch's context (CodeQL's cache
poisoning). It builds that commit, checks the pages install that version, writes `release.json` (the version and the
commit) beside them, and before deploying checks the release is still the latest at that commit, so an older or
re-run build never replaces a newer release's site. After deploying it checks the site where readers get it, at the
URL Pages gives: `release.json` holds that version and commit; the index, `r/button/` and the guides name their
canonical URL at that address; the sitemap, `llms.txt` and `r/button.md` answer. It asks again for about two minutes
while Pages serves the new deployment, then fails the run, with the problem in its log. If the gallery fails after its
Release exists, run `pages.yml` by hand on `main`: it rebuilds the latest release. *Re-run failed jobs* works too (a
full re-run finds the release done and skips the gallery). Only tagged releases reach the public website. From that tag the workflow runs
`tools/build-static.sh <dir> --base-path=/<repository> --release-from-tags --branch=main`.
The website build publishes the guides, catalog and discovery metadata. The demo export supplies
the static application and example frames. Both use the release's version, commit and public base path.
Documentation corrections reach Pages through an ordinary release. Locally, delete
`demo/public/assets/` after building the runtime export to resume serving development assets.
