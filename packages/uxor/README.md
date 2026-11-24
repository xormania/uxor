# UXor package for Symfony applications

`xormania/uxor` is a Composer development dependency that helps developers and agents use [UXor](https://github.com/xormania/uxor)'s
Symfony UX Toolkit kit in their own Symfony applications.
Its skills and tools follow the consuming application's instructions, authorized task scope and configured runtime.
It can configure a development environment with Mago, Serena, Symfony AI Mate, Maker and Symfony's profiler.
Start with the [application guide](resources/uxor/docs/FOR-AGENTS.md) for component selection and setup.

The package brings UXor's references, task guidance and project diagnostics into the application's workflow,
through [Symfony AI Mate](https://github.com/symfony/ai-mate) and a command line:

- three Mate skills: `mate-uxor-setup`, `mate-uxor-build` and `mate-uxor-verify`;
- references for the kit's recipes, with its install guide and docs, as Mate resources (`uxor://catalog`,
  `uxor://reference/…`) and as files in the package;
- operations through `vendor/bin/uxor` and Mate for development setup, environment inspection, compiled Symfony
  preparation, catalog search, component detail, application workflows and browser diagnostics;
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

Composer finds [`xormania/uxor` on Packagist](https://packagist.org/packages/xormania/uxor) by default.
Packagist indexes the kit's release tag as the package version. Use the command below once the listing includes
`0.3.5`.

UXor 0.3.5 uses Mate, its Symfony extension and its Composer plugin at `1.0.0-BETA1`.
Require all three versions in your application's own dev dependencies to admit those prereleases while keeping
Composer's default stable policy. UXor releases 0.3.0 through 0.3.2 require Mate 0.14.

```sh
composer require --dev \
    'xormania/uxor:^0.3.5' \
    'symfony/ai-mate:1.0.0-BETA1' \
    'symfony/ai-mate-composer-plugin:1.0.0-BETA1' \
    'symfony/ai-symfony-mate-extension:1.0.0-BETA1'
```

Composer installs the repository's archive (the kit and this package, without the development files), so the
package's files are under `vendor/xormania/uxor/packages/uxor/` with Composer's default vendor directory.
Use the application's configured vendor directory if it differs.

Continue with setup below to initialize Mate and the development tools together. After a package update in an
already configured project, refresh discovery with the application's actual Mate invocation:

```sh
composer update xormania/uxor
vendor/bin/mate discover
```

## Configure the development environment

Run setup from the application's actual PHP environment. Its default is a plan: it shows dependencies,
owned files and client configuration without installing packages, booting Symfony or changing files.

```sh
vendor/bin/uxor setup --format=json
vendor/bin/uxor setup --apply --install --trust-project-code --format=json
vendor/bin/uxor environment --format=json
```

Use `--project-root=/path/to/application` when the current directory is different. Setup preserves existing
application files and reports configuration that needs integration. `--apply` writes the proposed missing files;
`--install` additionally runs Composer for missing development dependencies. It then initializes Mate if needed,
regenerates autoload metadata and runs Mate discovery. Provider builds and Symfony preparation are separate steps.

The development tools include Symfony's profiler pack and Maker, the Mago 1.60.2 SDK and Symfony wiring 1.3.0,
with Mate extensions described by the setup plan. Setup and environment inspection recognize the profiler pack
by its installed package or by both unpacked requirements, WebProfilerBundle and Stopwatch. Without Flex, register
WebProfilerBundle and its routes in development if the application uses the profiler UI. Setup preserves the
application’s profiler policy. With no existing policy, run the development server with `PROFILER_COLLECT=1` to
collect a profile; verify its token on a real response.

Composer resolves these tools against the application's requirements. Wiring 1.3.0 requires
`symfony/yaml ^7.4.23 || ^8.1.11`; a project that pins all Symfony packages to 8.0 may need a compatible dependency
choice. An installation failure remains visible in setup's result.

### Connect an agent client

Choose `--client=claude` or `--client=codex` to plan the corresponding Serena MCP registration;
`--client=none` leaves client configuration to the application. Existing client files are preserved.
`--trust-project-code` authorizes the current setup operation, including native Composer and Mate execution when
`--install` is selected. It never saves permission for later Serena connections.

Saving that permission is a separate choice: add `--save-project-trust` only when future connections are explicitly
authorized. It inserts the launch flag into newly generated MCP bindings and authorizes code at that path on every
connection, including after branch changes; it has no commit binding or expiry. It does not authorize installation
or add `--write`. New bindings without this choice refuse to start until the MCP launch is explicitly authorized.
Existing bindings are preserved: adding the saving option later does not update them, and omitting it does not
revoke earlier permission. Reconcile existing bindings explicitly. To revoke recurring permission, stop the provider
and remove `--trust-project-code` from each saved binding before another connection.

When setup runs inside the application's PHP container, its application path and the host client's path can differ.
Select the container path with `--project-root` and supply the absolute host checkout path separately:

```sh
vendor/bin/uxor setup --project-root=/app \
    --host-project-root=/home/me/projects/application \
    --client=codex --apply --install --trust-project-code --format=json
```

The host path is used only for generated client commands, root arguments and working-directory settings. It is not
checked from inside the PHP container. This example installs tools without saving future execution permission;
include `--save-project-trust` separately if that persistence is wanted. Prepare the providers on the Docker host,
explicitly authorize the client launch and resolve a known application symbol. A generated registration or successful setup does not establish a
working MCP connection. Mate 1.0.0-BETA1 exposes its tools through its application CLI; Serena is the MCP server.

### Upgrade from the old skill names

UXor's skill slugs are now `uxor-setup`, `uxor-build` and `uxor-verify`. Mate installs them with a `mate-` prefix.
Use the new names in agent instructions and skill commands. Application skills can use the original generic slugs
in their own source directories.

Before updating with Composer, record which skills are disabled or overridden and keep the override sources in
`mate/skills/`. Save edits made directly in `.agents/skills/mate-*` or `.claude/skills/mate-*` outside those
directories. Mate manages those targets and can remove them when Composer triggers discovery during the update.

The skill rename ships in UXor 0.3.5. An existing `xormania/uxor` constraint of `^0.3` already permits 0.3.5;
it does not need widening. The `^0.3.5` constraint in the [install command](#install-in-a-symfony-application)
requires at least this release and stays below 0.4.0. Follow that command when upgrading so the application's
own dev dependencies also admit the required Mate prereleases.

Run `vendor/bin/mate discover` after the update. Mate registers the application skills from their configured
sources, retires the old generated UXor copies and installs the new ones. Old override sources under `mate/skills/`
remain in place. To carry forward a build override, run `vendor/bin/mate skills:override uxor-build`, port your
edits from `mate/skills/build/` into `mate/skills/uxor-build/`, then run `vendor/bin/mate discover` again. Keep
`name: uxor-build` in the new skill's front matter. Reapply any disable setting with the new slug, for example
`vendor/bin/mate skills:disable uxor-build`.

<a id="optional-php-checks-and-serena-with-mago"></a>

## Remove the development package

Run `vendor/bin/uxor detach` while UXor is still installed. Review its plan, stop running UXor providers, and
reconcile any listed application integrations. Apply the plan with `vendor/bin/uxor detach --apply`. After a
completed result, run `composer remove --dev xormania/uxor`. The [removal instructions](OPERATIONS.md#detach-before-removing-uxor)
cover customized files, earlier installations, and how to verify remaining Playwright, Mago and Mate integrations.

## Mago and Serena

The Composer package installs `vendor/bin/uxor-mago`. Its CLI uses the official Mago 1.60.2 release for
PHP and Twig checks. Serena uses a separate language-server build based on that release for semantic source work,
diagnostics and the compiled Symfony dependency graph. Run the application's own runtime tests separately.

Every application command requires `--trust-project-code` before the command. Review the selected checkout,
its effective `mago.toml`, inherited configuration, extension-host programs and Composer autoloader before
supplying it. Mago can execute configured extensions, including the prepared Symfony wiring worker.
This applies to read-only queries as well as edits. Serena's preparation verifier is bundled in the provider
image and loads no application PHP. Provider preparation, image/version queries and top-level help do not
require application trust.
[Mago extension hosts](https://mago.carthage.software/1.60.2/en/extensions/configuration/)

### Prepare the providers on the Docker host

The shipped provider recipes target Linux amd64 with local Docker. Run these commands on the host that starts the
MCP client and can access the checkout; application PHP commands still belong in the application's PHP environment.

```sh
vendor/bin/uxor-mago pull cli
vendor/bin/uxor-mago version
vendor/bin/uxor-mago pull serena
vendor/bin/uxor-mago version serena
```

The CLI provider uses the official digest-pinned binary in PHP 8.4.28. The Serena provider builds language-server
and extension support from Mago 1.60.2 and pins upstream Serena at `7f7d6245`. Both recipes and Serena's dependency
lock ship in the package. `UXOR_MAGO_IMAGE` selects a compatible custom image.
[Release binary](https://github.com/carthage-software/mago/releases/tag/1.60.2) ·
[Language-server recipe](resources/mago/serena/Dockerfile)

Setup supplies a root Mago configuration when one is absent. Preserve an existing configuration and integrate the
owned config explicitly. For an application using PHP 8.4 and the default vendor directory:

```toml
version = "1.60.2"
php-version = "8.4"
extends = ".uxor/mago/config.toml"

[source]
paths = ["src", "tests", "templates"]
includes = ["vendor"]
```

Use the application's actual PHP target, source paths and Composer vendor directory. The owned config starts
without a Symfony worker; successful `uxor prepare` enables it.

### Inspect and change source

The default application mount is read-only. Formatting commands check without writing, and native findings retain
Mago's exit status. `check` verifies nonempty source scopes, then runs formatting, lint and analysis in order.

```sh
vendor/bin/uxor-mago --trust-project-code check
vendor/bin/uxor-mago --trust-project-code analyze --reporting-format json
vendor/bin/uxor-mago --trust-project-code lint --reporting-format json src/
vendor/bin/uxor-mago --trust-project-code twig:lint templates/
vendor/bin/uxor-mago --trust-project-code cst --help
vendor/bin/uxor-mago --trust-project-code guard --help
```

`--trust-project-code` authorizes execution; add `--write` before the command when checkout changes are also
authorized. Writable access includes repository metadata; the offline provider is not a safe execution environment
for untrusted application code. The native `fix` command uses its safe
default; inspect the resulting diff and run the relevant application tests.

```sh
vendor/bin/uxor-mago --trust-project-code --write format src/
vendor/bin/uxor-mago --trust-project-code --write fix src/
vendor/bin/uxor-mago --trust-project-code --write twig:fmt templates/
```

The launcher also forwards `guard`, `cst`, `twig:fmt` and `twig:lint` options to Mago. Mutation options
such as `--fix` require `--write`; native dry-run previews remain available. Explicit check, diff and stdin
options keep their native meaning. Use each command's installed `--help` before selecting unfamiliar options.

For manual MCP configuration, substitute the absolute host application and executable paths. This definition
carries no saved execution permission:

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

To authorize a launch, supply `"--trust-project-code"` before `"serena"` after reviewing the selected application
and launcher. Save that flag in client settings only when recurring permission is intended; it also applies to
later code checked out at the same path. Keep this permission in local settings rather than shared configuration.
Add `"--write"` before `"serena"` only when that session is authorized to edit the application. This enables
Serena's source editing with a writable mount. Use project-relative paths for source queries.

The provider keeps its index and settings in private Docker storage selected for the checkout, user and image.
It preserves the application's own `.serena/` files. Close the existing MCP process before reconnecting to the
same provider state; reconnecting starts a new REPL session. Install dependencies inside the mounted checkout:
external Composer path-repository targets are inaccessible.

### Refresh Symfony knowledge

After setup and provider preparation:

```sh
vendor/bin/uxor prepare --trust-project-code --format=json
vendor/bin/uxor environment --probe --trust-project-code --format=json
```

Run these in the application's PHP environment. Provider probes additionally need access to the Docker host;
when that host is separate, use the host-side version commands above and verify the actual MCP connection there.

`uxor prepare --trust-project-code` uses the application's PHP runtime to export current dev container facts.
It retains service IDs, classes, alias targets and service references through the wiring package's sanitizer.
Raw debug views are private temporary files; the published reference and freshness manifest live under
`.uxor/mago/`. Preparation does not clear the application's caches, profiles or logs.

Serena's graph interface verifies the actual preparation manifest, reference hash and tracked input hashes before
and after each query. The verifier runs from the provider image without loading the application's worker or
Composer autoloader. Its generation includes the verified content, so reusing a preparation ID cannot keep older
compiled facts in the language server. Changed generations restart the server. Active wiring with missing,
incomplete or stale preparation refuses the graph query. Native source operations remain available independently. Refresh after changes to
application source, service configuration or dependencies. Environment-variable values, `.env` files, Symfony's
secrets directory and configuration imported from outside the tracked paths are not fingerprinted; explicitly
prepare again after those changes. [Preparation scope](OPERATIONS.md#prepare-compiled-symfony-facts) lists the inputs.
These checks establish consistency with the recorded snapshot, not authenticity of application-authored artifacts.
Dependency edges describe compiled bindings and analysis relationships, not observed runtime calls.

The worker runs under the provider's PHP 8.4.28 and loads the application's dependencies. An application requiring
a newer PHP runtime or additional extensions may need a matching compatible provider. Successful preparation
alone does not establish provider compatibility or current application health. A stale source span after an
external edit can also require a language-server restart; do not apply a stale range.
[Recorded provider limitation](https://github.com/xormania/mago-serena_v2-poc/blob/4e811e48ee9c934791695ebfc9622daa251534b4/docs/CAPABILITIES.md)

## Understand, build and diagnose

Use the tools together in the consuming application:

| Workflow | Source and framework work | Evidence to retain |
| --- | --- | --- |
| Understand | Inspect application metadata; query symbols, definitions and references with Serena; inspect compiled Symfony services and fresh graph bindings | The selected application, source and preparation state, with unresolved relationships kept explicit |
| Build | Discover installed Maker options; generate or edit application code; run Mago formatting, lint and analysis; update focused application tests | The actual diff, native findings and tests covering the requested behavior |
| Diagnose | Reproduce the request; match its response token to a Symfony profile; inspect the relevant exception, query and log evidence; trace and repair the source | The failing request, a regression that fails on the defect, and a fresh successful request after repair |

A historical profile remains useful when current source cannot boot. Preserve it before any explicit cache-clearing
or environment-reset operation. Re-run the failed behavior after repair; the newest available profile may belong to
another request. The [operation reference](OPERATIONS.md#diagnose-a-request) gives the request-diagnosis sequence.

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

Use the application's own tests and runtime to check its integration; the
[application testing guide](resources/uxor/docs/docs/APPLICATION-TESTING.md) describes relevant checks.

For a local browser failure, use the application's existing diagnostics. If the optional package Playwright
recorder is configured, read its capture with `vendor/bin/uxor browser-diagnostics` or
`uxor_browser_diagnostics` in Mate. Open a Symfony profile when its URI is returned. The
[browser diagnostics setup](OPERATIONS.md#browser-diagnostics) explains configuration and evidence limits.
Review diagnostic output and traces for sensitive content before sharing.

The customer-management workflow connects a searchable list, modal form, validation, successful-save feedback and
Turbo history. It is written for this package, beside the component references generated from the kit's READMEs,
and each reference result names the digest of the UXor files its documentation is generated from.

Composer updates the package's code and references; Mate discovery refreshes the installed agent guidance and skills.
Installed application components remain owned by the consuming project.

## Developing this package

When changing the package's source in the UXor repository, follow that repository's
[AGENTS.md](https://github.com/xormania/uxor/blob/main/AGENTS.md) and
[CONTRIBUTING.md](https://github.com/xormania/uxor/blob/main/CONTRIBUTING.md) for development and review.
The repository demo and package-development consumer are test environments; installed skills operate in
the consuming application. Report package vulnerabilities as UXor's
[SECURITY.md](https://github.com/xormania/uxor/blob/main/SECURITY.md) describes.

MIT licensed.
