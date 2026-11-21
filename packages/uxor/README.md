# UXor package

Agent guidance and development tools for building Symfony applications with [UXor](https://github.com/xormania/uxor).

UXor is independently maintained; the official Symfony UX `flowbite-4` kit was an initial reference only. This
package documents UXor's behavior and current integrations, which evolve under UXor's requirements and compatibility
commitments rather than a requirement to match the reference kit.

`xormania/uxor` is UXor's Composer package, a development dependency of a Symfony application. It brings UXor's
references, task guidance and project diagnostics into an agent's workflow, through
[Symfony AI Mate](https://github.com/symfony/ai-mate) and a command line:

- three Mate skills: `mate-uxor-setup`, `mate-uxor-build` and `mate-uxor-verify`;
- references for the kit's 64 recipes, with its install guide and docs, as Mate resources (`uxor://catalog`,
  `uxor://reference/…`) and as files in the package;
- operations through `vendor/bin/uxor` and Mate for catalog search, component detail, bounded document reads,
  application workflows, project inspection, first-setup checks, installed Maker/Mate discovery and browser diagnostics.
- a shared Playwright fixture that pairs the app's Symfony Profiler tokens with failed requests and page errors.

The package does not install recipes. They still install with Symfony UX Toolkit's `ux:install`, as the
[UXor README](https://github.com/xormania/uxor#install) says, and the files it copies belong to the application, like
its business logic.

## Install in a Symfony application

Requires PHP 8.4 or later. Run every command in the application's actual PHP environment (with Docker, inside its PHP
container).

The package depends on Mate's Composer plugin, which Composer runs only when the application allows it:

```sh
composer config allow-plugins.symfony/ai-mate-composer-plugin true
```

The development package uses Mate, its Symfony extension and its Composer plugin at `1.0.0-BETA1`.
Require all three versions in your application's own dev dependencies to admit those prereleases while keeping
Composer's default stable policy. UXor releases 0.3.0 through 0.3.2 require Mate 0.14.

To install Beta1 before UXor tags a release that includes it, select the development branch explicitly.

```sh
composer require --dev \
    'xormania/uxor:dev-claude/wo-symfony-trials--mate' \
    'symfony/ai-mate:1.0.0-BETA1' \
    'symfony/ai-mate-composer-plugin:1.0.0-BETA1' \
    'symfony/ai-symfony-mate-extension:1.0.0-BETA1'
```

After UXor publishes a release that includes Beta1, replace the development branch constraint with that release. If Packagist has yet to index the branch head you need, add the VCS
repository before running the command.

```sh
composer config repositories.uxor vcs https://github.com/xormania/uxor
```

Composer installs the repository's archive (the kit and this package, without the development files), so the
package's files are under `vendor/xormania/uxor/packages/uxor/`.

Run the Mate commands below with the application's configured invocation. For a new Mate setup:

```sh
vendor/bin/mate init
composer dump-autoload
vendor/bin/mate discover
vendor/bin/mate tools:list --format=json
```

After installing or updating the package in an initialized Mate project, refresh its instructions and skills
explicitly:

```sh
composer update xormania/uxor
vendor/bin/mate discover
```

This sequence also works when Mate's Composer plugin does not refresh discovery. With Mate 0.14 and Composer 2.10.3
running from a PHAR, the plugin resolved Composer's own root instead of the consuming application. Explicit discovery
uses the actual application and preserves project-authored instructions and configuration.

If the application uses Claude Code, check `CLAUDE.md` after discovery. Mate 0.14 can mistake a mention of
`AGENTS.md` in prose for an import. If the import is missing, add this line on its own outside Mate's managed block.

```text
@./AGENTS.md
```

### Upgrade from the old skill names

UXor's skill slugs are now `uxor-setup`, `uxor-build` and `uxor-verify`. Mate installs them with a `mate-` prefix.
Use the new names in agent instructions and skill commands. Application skills can use the original generic slugs
in their own source directories.

Before updating with Composer, record which skills are disabled or overridden and keep the override sources in
`mate/skills/`. Save edits made directly in `.agents/skills/mate-*` or `.claude/skills/mate-*` outside those
directories. Mate manages those targets and can remove them when Composer triggers discovery during the update.

Choose a release that includes the rename once one is available. If your application's root Composer constraint
for `xormania/uxor` is `^0.3`, widen it to allow the chosen release. If the rename ships in 0.4.0, for example,
`composer require --dev 'xormania/uxor:^0.4'` updates the constraint and selects the 0.4 series.

Run `vendor/bin/mate discover` after the update. Mate registers the application skills from their configured
sources, retires the old generated UXor copies and installs the new ones. Old override sources under `mate/skills/`
remain in place. To carry forward a build override, run `vendor/bin/mate skills:override uxor-build`, port your
edits from `mate/skills/build/` into `mate/skills/uxor-build/`, then run `vendor/bin/mate discover` again. Keep
`name: uxor-build` in the new skill's front matter. Reapply any disable setting with the new slug, for example
`vendor/bin/mate skills:disable uxor-build`.

## Optional PHP checks and Serena with Mago

The Composer package also installs `vendor/bin/uxor-mago`. It runs formatting checks, lint and static analysis
on the consuming application's PHP with the official Mago 1.60.2 release. Serena uses a separate
language-server build based on that exact release for symbol lookup and diagnostics. Run PHPUnit separately for the application's runtime tests.

Use the CLI and MCP server only with a trusted application checkout. Review the effective Mago configuration,
including `mago.toml`, any files it inherits through `extends`, and the worker programs configured under
`[extension-hosts]`. Running Mago from the CLI or starting its language server through Serena can launch
those programs inside the offline container. They can read files in the checkout mounted read-only at `/app`.
[Mago extension host configuration](https://mago.carthage.software/1.60.2/en/extensions/configuration/)

On Linux amd64 with local Docker, prepare the providers once. The CLI copies the official digest-pinned Mago
binary into the official PHP 8.4.28 CLI image. The runtime includes Intl and Zip for Symfony extension workers. The Serena build compiles the experimental
language server and its extension support from Mago 1.60.2 and uses upstream Serena revision `7f7d6245`.
The adapter and its patches come from the pinned mago-serena proof of concept. UXor ships both Docker build recipes and the Serena dependency lock in the Composer archive.
[Release binary](https://github.com/carthage-software/mago/releases/tag/1.60.2) · [Language-server build](resources/mago/serena/Dockerfile)

```sh
vendor/bin/uxor-mago pull cli
vendor/bin/uxor-mago version
vendor/bin/uxor-mago pull serena
vendor/bin/uxor-mago version serena
```

Configure PHP source paths in `mago.toml` at the application root. The pinned Mago defaults to an empty source
list. For example, an application targeting PHP 8.4 with `src/`, `tests/` and Composer dependencies can use:

```toml
version = "1.60.2"
php-version = "8.4"

[source]
paths = ["src", "tests"]
includes = ["vendor"]
```

From the application root, run the checks together or request a native report for one of them:

```sh
vendor/bin/uxor-mago check
vendor/bin/uxor-mago lint --reporting-format json src/
vendor/bin/uxor-mago analyze --reporting-format json
vendor/bin/uxor-mago format src/
```

`check` verifies that each step has files to check, then stops at the first failure in the order format, lint,
analyze. Individual commands return Mago's exit status. Pass paths and options for the selected subcommand after
its name. Put workspace-wide settings in `mago.toml`.

To use the language server, register a stdio MCP server with your client. Substitute the absolute application
path in both places so the client can start it from any directory:

```json
{
  "mcpServers": {
    "uxor-mago": {
      "command": "/path/to/app/vendor/bin/uxor-mago",
      "args": ["--project-root", "/path/to/app", "serena"]
    }
  }
}
```

Each invocation mounts the selected application at `/app` read-only and runs offline. Use paths relative to the
application for Mago and Serena queries. To resolve dependency symbols, install those dependencies inside the
mounted tree. Composer path repositories symlinked outside it are inaccessible. Serena keeps its project settings and index in temporary container
storage, so the application's own `.serena/` settings stay available to its other sessions. If a symbol range is
stale after an external edit, restart the language server or reconnect. The
[provider documents this limitation](https://github.com/xormania/mago-serena_v2-poc/blob/4e811e48ee9c934791695ebfc9622daa251534b4/README.md).
Set `UXOR_MAGO_IMAGE` to use a compatible custom image for both commands. `uxor-mago version` reports its CLI version.

## Use

Search first, then load the relevant component detail and documentation:

```sh
vendor/bin/uxor catalog --query=dialog --format=json
vendor/bin/uxor component modal --format=json
vendor/bin/mate resources:read uxor://reference/modal/README.md --format=json
vendor/bin/uxor workflow customer-management --format=json
vendor/bin/mate tools:call uxor_workflow --name=customer-management --format=json
vendor/bin/uxor inspect --format=json
```

Complete setup with `ux:install` and the selected component's integration guide. Metadata inspection does not
establish runtime behavior. [Operations](OPERATIONS.md) covers result limits, unknowns, exit statuses and installed
Maker/Mate discovery.

For a local browser failure, capture the affected test with the package's Playwright fixture, then read its evidence
with `vendor/bin/uxor browser-diagnostics` or `uxor_browser_diagnostics` in Mate. The
[browser diagnostics setup](OPERATIONS.md#browser-diagnostics) shows how to register the fixture and open the exact
Symfony profile.

The customer-management workflow connects a searchable list, modal form, validation, successful-save feedback and
Turbo history. It is written for this package, beside the component references generated from the kit's READMEs,
and each reference result names the digest of the UXor files its documentation is generated from.

Composer updates the package's code and references; Mate discovery refreshes the installed agent guidance and skills.
Installed application components remain owned by the consuming project.

## Development

The package is developed in the UXor repository, under `packages/uxor/`. Read its
[CONTRIBUTING.md](https://github.com/xormania/uxor/blob/main/CONTRIBUTING.md) for setup, checks and pull requests,
and report vulnerabilities as its [SECURITY.md](https://github.com/xormania/uxor/blob/main/SECURITY.md) says.

MIT licensed.
