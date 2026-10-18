# UXor package

Agent guidance and development tools for building Symfony applications with [UXor](https://github.com/xormania/uxor).

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

Until then, add the repository and require a release tag that ships `composer.json` at the repository's root. No
release ships the package yet: the tags so far hold the kit only. Once the first release with `composer.json` is
tagged, use it, or a later one, as `<version>`:

```sh
composer config repositories.uxor vcs https://github.com/xormania/uxor
composer require --dev xormania/uxor:<version>
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
