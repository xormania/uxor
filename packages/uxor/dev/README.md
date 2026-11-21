# UXor package: development consumer and environment

`packages/uxor/dev/` is where UXor's Composer package, `xormania/uxor`, is developed and checked from the side of
an application that uses it. It is not part of the archive that Composer and `ux:install` download
(`.gitattributes`). [CONTRIBUTING](../../../CONTRIBUTING.md) describes branches, reviews and checks. The
[package README](../README.md) describes the package.

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

The consumer has no database and no paths into the kit's recipes. Its lock installs Symfony FrameworkBundle 8.1.11
and Symfony UX Toolkit 3.7.1. It requires PHP 8.4 or later (`config.platform.php` is 8.4.1), and the Docker
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
consumer, separate from the kit's browser suite at the repository root. Then, without development dependencies:

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
| This commit's archive in an independent consumer: install, Mate, update, no-dev render | `python3 packages/uxor/tools/check-package.py --consumer` | *Package* |
| The consumer's container, Twig and Mate | `python3 packages/uxor/dev/run.py --native check` | not yet |
| The customer workflow in a browser, then without development dependencies | *The customer workflow* above | not yet |
| The installed Mago launcher and its real language server, including empty scopes, a clean application, a type error and a symbol lookup | Prepare both providers in the [package README](../README.md#optional-php-checks-and-serena-with-mago), then run `uv run --script packages/uxor/dev/check-mago.py` from the repository root | *Mago providers* |
| The Docker stack and the editable Serena session | `run.py up`, `status`, `check`, `run.py serena --prepare`, then `check-serena.py --package` | *Development images* |

`check` lints the container and the Twig templates, lists Mate's tools and asks Mate about the compiled controller
service; `status` gets a real health response. Neither one replaces the browser journey or the archive install.
