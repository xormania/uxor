# UXor package

Agent guidance and development tools for building Symfony applications with [UXor](https://github.com/xormania/uxor).

UXor is independently maintained; the official Symfony UX `flowbite-4` kit was an initial reference only. This
package documents UXor's behavior and current integrations, which evolve under UXor's requirements and compatibility
commitments rather than a requirement to match the reference kit.

`xormania/uxor` is UXor's Composer package, a development dependency of a Symfony application. It brings UXor's
references, task guidance and project diagnostics into an agent's workflow, through
[Symfony AI Mate](https://github.com/symfony/ai-mate) and a command line:

- three Mate skills: `setup`, `build` and `verify`;
- references for the kit's 64 recipes, with its install guide and docs, as Mate resources (`uxor://catalog`,
  `uxor://reference/…`) and as files in the package;
- seven operations, through `vendor/bin/uxor` and the Mate tools `uxor_catalog`, `uxor_component`,
  `uxor_reference`, `uxor_workflow`, `uxor_project`, `uxor_doctor` and `uxor_tools`: catalog search, component
  detail, bounded document reads, a practical workflow, project inspection, first-setup checks and installed
  Maker/Mate discovery.

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

Once the package is published on Packagist:

```sh
composer require --dev xormania/uxor
```

Until then, add the repository and require a release tag that ships `composer.json` at the repository's root: 0.3.0
is the first (the tags before it hold the kit only):

```sh
composer config repositories.uxor vcs https://github.com/xormania/uxor
composer require --dev xormania/uxor:^0.3
```

Composer installs the repository's archive (the kit and this package, without the development files), so the
package's files are under `vendor/xormania/uxor/packages/uxor/`.

For a new Mate setup:

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

## Optional PHP checks and Serena with Mago

The Composer package also installs `vendor/bin/uxor-mago`. It runs formatting checks, lint and static analysis
on the consuming application's PHP. Serena can use the same Mago binary as its PHP language server for symbol
lookup and diagnostics. Run PHPUnit separately for the application's runtime tests.

Use the CLI and MCP server only with a trusted application checkout. Review the effective Mago configuration,
including `mago.toml`, any files it inherits through `extends`, and the worker programs configured under
`[extension-hosts]`. Running Mago from the CLI or starting its language server through Serena can launch
those programs inside the offline container. They can read files in the checkout mounted read-only at `/app`.
[Mago extension host configuration](https://mago.carthage.software/1.58.2/en/extensions/configuration/)

On a POSIX host with local Docker, build the optional provider image once. The build compiles Rust and includes
the Serena adapter and patched Mago language server from the
[pinned proof of concept](https://github.com/xormania/mago-serena_v2-poc/tree/b6dbec8378338e39fe51489bc28f9ad578e4f3ab).

```sh
docker buildx build --load -t uxor-mago:b6dbec8 \
  'https://github.com/xormania/mago-serena_v2-poc.git#b6dbec8378338e39fe51489bc28f9ad578e4f3ab'
```

Configure PHP source paths in `mago.toml` at the application root. The pinned Mago defaults to an empty source
list. For example, an application targeting PHP 8.4 with `src/`, `tests/` and Composer dependencies can use:

```toml
version = "1"
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
[provider documents this limitation](https://github.com/xormania/mago-serena_v2-poc/blob/b6dbec8378338e39fe51489bc28f9ad578e4f3ab/README.md).
Set `UXOR_MAGO_IMAGE` to select a compatible local build, for example `mago-serena-poc:local` from that revision.

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
