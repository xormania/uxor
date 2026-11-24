# Composer package configuration

## Composer installation

Installing UXor with `composer require --dev` puts the package in your application's development dependencies.
Composer checks the platform requirements and resolves the required packages against your application's own constraints.
Follow the [installation guide](../packages/uxor/README.md) for the release-specific command.

| Direct requirement | Constraint |
| --- | --- |
| `php` | `>=8.4` |
| `composer/composer` | `^2.11.2` |
| `symfony/ai-mate` | `>=1.0.0-BETA1 <1.0.0-BETA2` |
| `symfony/ai-mate-composer-plugin` | `>=1.0.0-BETA1 <1.0.0-BETA2` |
| `symfony/ai-symfony-mate-extension` | `>=1.0.0-BETA1 <1.0.0-BETA2` |
| `symfony/console` | `^7.4 \|\| ^8.0` |
| `symfony/filesystem` | `^7.4 \|\| ^8.0` |
| `symfony/process` | `^7.4 \|\| ^8.0` |

UXor declares the executables `uxor`, `uxor-mago`. Composer exposes them in your application's binary directory, normally `vendor/bin`.

## Optional development setup

Run `vendor/bin/uxor setup --format=json` to see the proposed configuration and installed dependency evidence for your application.

These are the additional package requests outside UXor’s direct Composer requirements.

| Development dependency | Requested version |
| --- | --- |
| `symfony/debug-pack` | Composer selects a compatible version |
| `symfony/maker-bundle` | Composer selects a compatible version |
| `carthage-software/mago` | `1.60.2` |
| `byte-kitsune/mago-symfony-wiring` | `1.3.0` |
| `symfony/ai-monolog-mate-extension` | `1.0.0-BETA1` |

Symfony Flex can unpack a pack into individual dependencies. Setup checks the installed components when the pack itself is absent and skips requests your application already satisfies.
After reviewing the plan, run `vendor/bin/uxor setup --apply --install --trust-project-code` to authorize installation in the selected application.

## Setup defaults

| Setup option | Default when omitted |
| --- | --- |
| `--format` | `text` |
| `--project-root` | Current working directory |
| `--trust-project-code` | `false` |
| `--apply` | `false` |
| `--install` | `false` |
| `--save-project-trust` | `false` |
| `--client` | `none` |
| `--host-project-root` | Empty string |

Set `--host-project-root` to the absolute checkout path on the MCP host when that path differs from the one used by application PHP.
See [setup options and permissions](../packages/uxor/OPERATIONS.md#setup) before saving permission for future Serena connections.

## Application files

Paths are relative to the selected application. The setup plan shows which files apply to your client and configuration.

| Setting | Application path |
| --- | --- |
| Mago source paths and exclusions | `mago.toml` |
| Mago configuration for Symfony wiring | `.uxor/mago/config.toml` |
| MCP server definitions for manual client setup | `.uxor/mcp.json` |
| Claude MCP configuration | `.mcp.json` |
| Codex MCP configuration | `.codex/config.toml` |
| Development profiler configuration supplied by UXor | `config/packages/dev/uxor.php` |

An application's existing `framework.profiler` settings take precedence. With UXor’s fallback configuration, set `PROFILER_COLLECT=1` on the local Symfony server to collect profiles during a diagnostic run. See [browser diagnostics](../packages/uxor/OPERATIONS.md#browser-diagnostics).

## Provider images

The launcher uses these local image tags by default. Set `UXOR_MAGO_IMAGE` on the Docker host to select a compatible custom image for both providers.

| Provider | Default image |
| --- | --- |
| Mago CLI | `uxor-mago-cli:1.60.2-php8.4.28` |
| Serena | `uxor-mago-serena:1.60.2-7f7d624-5` |

Run `vendor/bin/uxor-mago image cli` or `vendor/bin/uxor-mago image serena` to see the selection on your host.
See [provider preparation](../packages/uxor/OPERATIONS.md#prepare-the-providers-on-the-docker-host) to build or pull it.
