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

The consumer has no database and no paths into the kit's recipes. It starts on Symfony 7.4 and Symfony UX 3.5.1
with PHP 8.4 or later (its `config.platform.php` is 8.4.1); the Docker environment runs PHP 8.5. A version is
supported once CI runs it, not because an environment defines it.

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

## Docker development (xorder images)

Requires Python 3.9 or later, Git, a working Docker engine with Compose v2, and access to the registry and to
Composer's sources. The images are `linux/amd64` xorder images pinned by digest in `xorder-support.lock.json` (PHP
and FrankenPHP) and `serena-support.lock.json` (Serena).

```sh
python3 packages/uxor/dev/run.py up
python3 packages/uxor/dev/run.py status
python3 packages/uxor/dev/run.py check
python3 packages/uxor/dev/run.py exec bin/console list make --format=json
python3 packages/uxor/dev/run.py exec vendor/bin/mate tools:list --format=json
python3 packages/uxor/dev/run.py down
```

The first use fetches the reviewed xorder revision named in `run.py` (`XORDER_REVISION`) into the ignored
`packages/uxor/dev/.tools/xorder`; `XORDER_DIR` can select an existing clean checkout at that revision instead. The
runner uses xorder's support checker and Serena launcher as they are: no provider code is copied here.

Before a pull, the support checker fetches the current release policy; before project commands, it checks the image
identities Docker reports, and commands against a running stack check the running containers too.
`XORDER_SUPPORT_POLICY_FILE` can select a recently fetched receipt under xorder's
[freshness rules](https://github.com/xormania/xorder/blob/97cb40b083f4ccf16148355c4e785ed0c6e4b00a/docs/downstream-support.md).
Online checks run the provider's policy fetch first and then check the completed receipt: the pinned provider's
direct online loader rejects a receipt it has just fetched. Each check writes its receipt to a private temporary file
and removes it. Update the release group and the image selections together; a cached image does not extend support.

The stack serves FrankenPHP with this directory's `Caddyfile`, on a loopback port, with a Compose project and volumes
per worktree. It mounts the whole repository (`../../..`) at `/workspace`, so the consumer's path repository reaches
the package's root inside the container too. Composer's downloads persist in the stack's home volume; installed
dependencies and the compiled container belong to the checkout, so never share another worktree's `vendor/`. The
runner does not start Docker, provide registry credentials or relay a host-only proxy, and mounts neither a home
directory nor the Docker socket. `down` and `status` keep working when a support group expires.

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
Serena binds the repository root, so the kit, the package and the consumer are one project, and the consumer is at
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
| The Docker stack, its support identity and Serena | `run.py up`, `status`, `check`, then `check-serena.py --package` | not yet |

`check` lints the container and the Twig templates, lists Mate's tools and asks Mate about the compiled controller
service; `status` gets a real health response. Neither one replaces the browser journey or the archive install.

The environment builds on [xorder](https://github.com/xormania/xorder/blob/97cb40b083f4ccf16148355c4e785ed0c6e4b00a/README.md)'s
resource selection, prepared images and support checks, and on its
[Serena notes](https://github.com/xormania/xorder/blob/97cb40b083f4ccf16148355c4e785ed0c6e4b00a/docs/serena.md). It
came from the former companion repository, `xormania/uxorscient` at `614aa28` (history only: that name is no longer
used).
