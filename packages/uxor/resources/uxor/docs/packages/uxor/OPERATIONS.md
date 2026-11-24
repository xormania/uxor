# Advanced UXor setup and operations

For the recommended setup, follow [the Composer guide](README.md). Use this reference to run a specific
integration yourself or inspect what the package does in your application.

| Task | Instructions |
| --- | --- |
| Install recipes directly with Symfony UX Toolkit | [Configure the application's kit and assets](../../INSTALL.md). |
| Connect an MCP client or use a separate Docker host | [Client configuration and host paths](#set-up-and-inspect-the-development-environment) and [Docker provider requirements](#prepare-the-providers-on-the-docker-host). |
| Inspect PHP, Twig or compiled Symfony wiring | [Source checks](#inspect-and-change-source) · [Compiled Symfony facts](#prepare-compiled-symfony-facts) |
| Verify a feature or diagnose a failed request | [Request diagnostics](#diagnose-a-request) · [Browser diagnostics](#browser-diagnostics) |
| Remove the development package or reconnect later | [Detach managed integrations](#detach-before-removing-uxor). |
| Check what the package knows about an existing project | [Project evidence and first-setup checks](#project-evidence-and-first-setup-checks) |

Use these tools in the consuming application's checkout, under its instructions and authorized task scope. Run commands with its configured PHP runtime; in a containerized project, use the PHP container so installed extensions, paths and generated Symfony artifacts match the application. Application-owned components and configuration remain the application's responsibility.

```bash
vendor/bin/uxor catalog --query=dialog --format=json
vendor/bin/uxor component modal --format=json
vendor/bin/uxor reference modal/README.md --format=json
vendor/bin/uxor workflow customer-management --format=json
vendor/bin/uxor inspect --project-root=/app --format=json
vendor/bin/uxor doctor --project-root=/app --format=json
vendor/bin/uxor doctor --project-root=/app --component=editor --format=json
vendor/bin/uxor tools --project-root=/app --trust-project-code --kind=maker --format=json
vendor/bin/uxor tools --project-root=/app --trust-project-code --kind=maker --name=make:controller --format=json
vendor/bin/uxor tools --project-root=/app --trust-project-code --kind=mate --format=json
```

The standalone CLI defaults project operations to the current directory. It requires a real `composer.json` and never searches parent directories. Select the intended application explicitly when working across applications or worktrees. Mate binds the same operations to its `%mate.root_dir%`.

## Set up and inspect the development environment

Composer applies UXor’s project defaults when the application first installs the package and initializes Mate.
Use `setup` to inspect those defaults, reconcile configuration or add a Serena binding. It reports missing
development dependencies, proposed files and client configuration
without running Composer or Symfony and without writing files. Apply the plan explicitly:

```sh
vendor/bin/uxor setup --project-root=/app --format=json
vendor/bin/uxor setup --project-root=/app --apply --format=json
vendor/bin/uxor environment --project-root=/app --format=json
vendor/bin/uxor environment --project-root=/app --probe --trust-project-code --format=json
```

`--apply` writes the proposed project configuration and preserves existing application files. Composer installs the
development dependencies and initializes Mate when the application requires UXor. After installation, verify the
registered tools with `vendor/bin/mate tools:call uxor_catalog --query=kbd --format=json`. Setup accepts `--install` and `--trust-project-code` for compatibility with older scripts.
See the [Composer installation guide](README.md#install-in-a-symfony-application) for the package and plugin settings.
Use `prepare` when an operation needs compiled Symfony wiring.

Composer resolves the development dependencies against the application's own constraints. The Symfony wiring
provider for this release requires `symfony/yaml ^7.4.23 || ^8.1.11`. If the project pins Symfony to 8.0,
inspect Composer's resolver output and the constraints it names.

UXor requires Symfony’s full debug pack and the Monolog Mate extension as part of its Composer installation.
Flex can replace the debug pack and its nested profiler pack with direct component requirements. Setup and
environment inspection report the installed components even when neither pack name appears in the lock. If a fork or the application itself provides or replaces a component,
the report identifies which package satisfies Composer’s constraint. For an application-root `self.version` link,
static inspection needs an explicit root version. `environment --probe --trust-project-code` checks which commands
the application can run. [Debug pack manifest](https://github.com/symfony/debug-pack/blob/v1.1.0/composer.json)

When Flex first applies a recipe for a development-only dependency, UXor preserves existing application
files and bundle settings. For newly installed bundles it scopes an all-environment registration to dev and test.
If a new recipe supplies unconditional YAML, UXor keeps its contents intact (for example,
`config/packages/monolog.yaml.dist`). An adjacent `monolog.yaml.uxor.php` imports it when the bundle is active.
If the application later adds `symfony/monolog-bundle` to its runtime requirements, Composer enables the
bundle and its original settings in production. Flex tracks both files in `symfony.lock` and removes them with the upstream recipe.
When Composer installs PropertyAccess only for development, UXor supplies a dev/test default so Toolkit’s
TwigComponent can use it. Explicit application settings take precedence.

Without Flex, enable DebugBundle, MonologBundle and WebProfilerBundle in the environments where the application
uses them, and import the development profiler routes if you use its UI. The generated
`config/packages/dev/uxor.php` supplies a collection policy only when the application has none.

`environment` reports setup and preparation state. `--probe` adds the implemented execution checks and requires
`--trust-project-code`. Probes also run Docker-backed version checks for Mago and Serena, which can acquire
provider images on first use. Read each check and its scope: configuration presence, installed tools, native execution,
a connected MCP client and a successful application request are different observations.

`--client=none|claude|codex` selects an optional Serena MCP registration. For setup executed in a PHP container,
provide both the selected application path and the client's host checkout path:

```sh
vendor/bin/uxor setup --project-root=/app --host-project-root=/home/me/projects/app \
    --client=codex --apply --format=json
```

`--host-project-root` affects only generated MCP paths and client working-directory settings. Setup validates its
path form but does not verify that host path from the container. The result's `mcp_binding.verified` remains false.
Connect the client on its Docker host and query a known application symbol to establish the connection. The
launcher prepares the selected provider on first use. Preserve and integrate existing client configuration. Mate exposes its tools through the application CLI. Serena provides the MCP server.

The separate `--save-project-trust` option inserts the launcher’s `--trust-project-code` flag into newly generated Serena bindings.
Saving it authorizes code at the selected path on every future connection, including after branch changes, with
no commit binding or expiry. Saving this permission requires its own explicit choice. To allow checkout changes
through the provider, authorize `--write` separately.

New bindings without saved permission refuse to start until the client launch is explicitly authorized.
Existing bindings are preserved: adding `--save-project-trust` later does not update them, and omitting it does not
revoke earlier permission. Reconcile them explicitly. To revoke recurring permission, stop the provider and remove
`--trust-project-code` from its saved arguments before another connection.
`mcp_binding.requested_saved_project_trust` reports the requested configuration, not the contents of preserved
files or a verified connection. The example above configures a client binding for the current checkout.

The corresponding Mate tools are `uxor_setup`, `uxor_environment`, `uxor_prepare` and `uxor_detach`. Inspect their installed
named inputs before calling them through the application's Mate CLI.

**Custom Composer directories.** UXor uses the application's configured vendor and binary paths. If Mate's
instructions show `vendor/bin/mate` after you changed `bin-dir`, invoke Mate from the actual binary directory
and set `mate.invocation` in `mate/config.php` to the command you use. Upstream Mate extension discovery
looks under `vendor/` at the application root. With a relocated vendor directory, check `mate tools:list` for
`uxor_catalog`; the standalone `uxor` CLI in the configured binary directory also provides the catalog.

## Prepare the providers on the Docker host

Composer installs `vendor/bin/mago` for native CLI use in the application. It obtains the matching Mago binary
on first use. The `vendor/bin/uxor-mago` launcher uses Docker for isolated CLI checks and the Serena language
server. Run it on a Linux amd64 Docker host that can access the checkout. It prepares each provider image the
first time that provider is used. You can warm both images in advance and inspect their versions.

```sh
vendor/bin/uxor-mago pull
vendor/bin/uxor-mago version
vendor/bin/uxor-mago version serena
```

The CLI provider uses the official digest-pinned binary in PHP 8.4.28. The Serena provider builds language-server
and extension support from Mago 1.60.2 and pins upstream Serena at `7f7d6245`. Both recipes and Serena's dependency
lock ship in the package. `UXOR_MAGO_IMAGE` selects a compatible custom image.
[Release binary](https://github.com/carthage-software/mago/releases/tag/1.60.2) ·
[Language-server recipe](https://github.com/xormania/uxor/blob/0.3.5/packages/uxor/resources/mago/serena/Dockerfile)

UXor supplies a root Mago configuration on first install when the application has none. Preserve an existing configuration and integrate the
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

## Inspect and change source

The commands below use the Docker-backed `vendor/bin/uxor-mago` launcher. Its default application mount is read-only. Formatting commands check without writing, and native findings retain
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

## Prepare compiled Symfony facts

```sh
vendor/bin/uxor prepare --project-root=/app --trust-project-code --format=json
```

Preparation runs the application's current PHP binary against its Symfony Console in dev/debug mode. It captures
the ordinary and `--types` service views, then invokes the installed wiring exporter with the application's actual
Composer autoloader. The worker requires exactly `carthage-software/mago:1.60.2` and
`byte-kitsune/mago-symfony-wiring:1.3.0`. Composer installs both with UXor.

The exporter discards scalar constructor values and retains bounded service/class/alias relationships and supported
hook metadata. Raw views stay in private temporary storage and are deleted. The sanitized reference and manifest
are published under `.uxor/mago/` with readable permissions for the separate provider UID; their containing
application directories must also be traversable by that user. These local state files are ignored by the generated
ignore file. Do not publish diagnostic artifacts without reviewing their contents.

Successful preparation activates the owned `.uxor/mago/config.toml` worker configuration. The application's root
`mago.toml` must extend that file; existing root configuration is preserved. Activation is separate from proving
that the effective Mago configuration uses the worker. Native graph off/on checks establish its actual contribution.

Freshness checks cover `src/`, `config/`, `tests/`, Composer-declared autoload paths, Composer metadata, the SDK and
wiring source, root `mago.toml` and the owned configuration. A change to a tracked input, the reference or an
incomplete preparation prevents stale compiled facts from being served. Environment-variable values, `.env` files,
Symfony's secrets directory and imported configuration outside the tracked paths are excluded; explicitly refresh
after changes to them. Installed package metadata does not attest that every vendor file is unchanged.

Preparation does not clear caches, profiles or logs. Symfony's dev container machinery refreshes its compiled facts.
A failed preparation stays incomplete; existing runtime observations can still help diagnose the failure.

The packaged Serena graph operation checks freshness before and after a query using a verifier bundled in the
provider image. It runs the image's PHP with configuration loading disabled and never includes the application's
worker or Composer autoloader. It validates the manifest and hashes the reference and tracked inputs itself;
application-produced freshness output is not used. Incomplete, changed or unavailable preparation fails the query.
The application’s environment report, wiring worker and provider use the same readiness checks, lock and
publication recheck. Composer paths such as `./vendor` and `./src` resolve relative to the application root. The verified
manifest, reference and input digest determine the language-server generation, so changed content restarts the
server even when a preparation ID is reused. These checks establish snapshot consistency, not authenticated
provenance of application-authored artifacts. Native source operations remain independent.
For another client, reload or restart after exporting a new reference. Graph edges have no source spans and
describe analysis dependencies or compiled bindings; they do not establish that a runtime call occurred.

When your PHP process runs in a container and the client starts on the host, run `prepare` in the PHP container, check both provider versions on the host, and query a known symbol from
the actual client. If source changed during an edit, query the symbol again before applying a range.
[Provider limitations](https://github.com/xormania/mago-serena_v2-poc/blob/4e811e48ee9c934791695ebfc9622daa251534b4/docs/CAPABILITIES.md)

The offline worker uses the provider's PHP 8.4.28 and the mounted application's dependencies. Its platform and
extensions must satisfy those dependencies. A project using a newer PHP platform may need a compatible custom
provider. Prepared facts, provider readiness and application health are reported separately.

## Understand and build

Start with the selected application's own code and request flow. Use Serena for symbols, bodies, definitions,
references and supported semantic changes; inspect compiled services through Mate and the fresh dependency graph.
Resolve uncertainty with the relevant source or runtime observation. An analyzer dependency edge is not a measured
call, and a symbol from an earlier query may contain stale body or range information after an edit.

Discover Maker commands and exact arguments using `tools` or the native Console before generating code. Use the
application's conventions and existing components. Missing UXor components still install through Toolkit's
`ux:install`; setup configures development tools and does not replace recipe installation.

Use the [Mago source checks](#inspect-and-change-source) for PHP/Twig formatting, lint and analysis
in the selected application. Configured extensions can run its PHP, including the Composer autoloader.
Review the checkout and effective configuration before supplying `--trust-project-code`; add `--write`
for an authorized mutating operation. Provider preparation, image/version queries and top-level help are
available without running application code.

Inspect the resulting diff, retain native findings and run tests that exercise the changed behavior. Refresh
compiled facts when required before interpreting framework graph results. The [provider setup](#prepare-the-providers-on-the-docker-host)
explains host execution, persistent index storage and client registration.

## Diagnose a request

1. Reproduce the failure in the selected application's served environment. Record the request URL, time, response
   status and its `X-Debug-Token` when present. Correlate that exact token with the profile; the newest profile may
   belong to another request.
2. Inspect the installed Mate schemas and read the profile. Choose a collector listed for that token to inspect
   a request, exception, log entry or captured dump. Symfony can show the collectors registered in the dev
   container and whether its live dump-server command is available.

   ```sh
   vendor/bin/mate tools:inspect symfony-profiler-get --format=json
   vendor/bin/mate resources:read "symfony-profiler://profile/<response-token>" --format=json
   vendor/bin/mate resources:read "symfony-profiler://profile/<response-token>/<collector>" --format=json
   php bin/console debug:container --tag=data_collector --env=dev
   php bin/console help server:dump --env=dev
   ```

3. Trace the relevant declarations and callers with Serena/Mago and inspect compiled service bindings when current
   preparation is available. Preserve the failed profile and logs before any explicit cache reset. A failure before
   profiling starts may have no token; use its available logs and request evidence.
4. Add or select a focused regression that fails for the observed defect, repair the source and verify it passes.
   Preserve existing tests; inspect the complete diagnostic changes instead of comparing finding counts alone.
5. Repeat the request and inspect its new response/profile. Report the repair, regression and fresh behavior
   separately from historical observations and metadata checks.

Use the application's current Mate invocation and profiler/log directories. Historical records remain useful after
source edits or a boot failure when those records are still available; they do not establish current health.
A profiler token cannot recover a file removed by another cache-clearing process.

## Discovery and detail

`catalog` returns at most 50 entries. Filter using `--query`/`--category`, then use `component` for the raw manifest, dependencies and documentation key. `--offset` and `next_offset` allow continuation. A component manifest is reference material; it does not establish which source is installed in the application.

`reference` accepts only document keys declared by the packaged index. It verifies the file remains inside the bundle and matches its packaged SHA-256. References return at most 24,000 bytes; continue a truncated document using `next_offset`. The initial page defaults to 12,000 bytes. Source links (at the ref the index records) and the digest of the UXor files the references are generated from accompany results.

`workflow customer-management` reads the UXor-authored guide for a searchable customer list, edit dialog, validation, successful save, feedback and Turbo history. It uses the same bounded UTF-8 pagination and directory checks as references. The result identifies the UXor package (`xormania/uxor`) as its source and returns the observed file checksum; that checksum identifies the returned guide and is not an independent signature. This guide lives outside the generated UXor reference bundle. Mate exposes it through `uxor://workflow/customer-management` and `uxor_workflow`; use the tool or CLI `--offset` to continue a truncated page.

Mate exposes `uxor_catalog`, `uxor_component`, `uxor_reference`, `uxor_workflow`, `uxor_project`, `uxor_doctor`,
`uxor_tools`, `uxor_browser_diagnostics`, `uxor_setup`, `uxor_environment`, `uxor_prepare` and `uxor_detach`. The fixed `uxor://catalog` resource supplies the initial catalog page.
Read an indexed document through `uxor://reference/INSTALL.md` or `uxor://reference/modal/README.md`. Use the reference
tool for pagination. See `vendor/bin/mate tools:inspect <name> --format=json` for actual named inputs.

```sh
vendor/bin/mate tools:call uxor_workflow --name=customer-management --limit=12000 --format=json
vendor/bin/mate resources:read uxor://workflow/customer-management --format=json
```

## Project evidence and first-setup checks

`inspect` reads only selected Composer metadata and checks selected configuration paths. It reports root `require` versus `require-dev`, versions from `vendor/composer/installed.json`, and versions separately from `composer.lock`. Missing installed metadata stays unknown. A sample of candidate component files establishes presence only: origin, version, customization and runtime wiring are unknown.

`doctor` checks runtime package placement and expected first-setup paths for the current UXor/AssetMapper profile. An alternative pipeline may have different files; absent conventional paths are unknown findings with follow-up guidance. A declared runtime package under `require-dev` fails its placement check. Existing paths pass only their presence check. Component-specific importmap entries, CSS imports, controller registration, application boot, CSP and the requested browser journey still need verification using the component README and application tools. The operation never calls a project healthy solely because files exist.

Use `doctor --component=<catalog-name>` for selected-component static wiring checks. The pinned manifest supplies importmap package keys. The editor and dropzone READMEs supply required stylesheet imports; dropzone also requires its native controller enabled and upstream stylesheet autoimport disabled. For modal, data-table, editor and dropzone, the check looks for the controller copied into the documented `assets/controllers/` layout. Findings link the pinned reference and identify their static scope. Importmap PHP is tokenized as text and never executed; comments do not count as keys. Literal-key presence does not establish the resolved asset or runtime registration.

`--asset-profile=auto` applies the conventional layout when the project declares or installs AssetMapper and has an importmap file. `--asset-profile=assetmapper` selects that layout explicitly. Use `--asset-profile=custom` for relocated/replaced application-owned assets or another pipeline; those checks remain unknown pending project-specific verification. The Mate doctor's corresponding named inputs are `component` and `assetProfile`. Static successes still leave runtime verification unknown: inspect controller connection, computed styles, PHP wiring and the requested interaction in the running application.

## Browser diagnostics

For a quick check of a URL, start the application's server and run the installed launcher from the application
root. No recipe, test file or application npm dependency is required.

```sh
vendor/bin/uxor-browser http://127.0.0.1:8000/
vendor/bin/uxor browser-diagnostics var/uxor/browser-diagnostics.json --format=json
vendor/bin/mate tools:call uxor_browser_diagnostics --path=var/uxor/browser-diagnostics.json --format=json
```

The launcher uses Node.js 20 or later and npm to prepare a private Playwright runtime and Chromium on first use. It reuses
that runtime on subsequent checks and leaves the application’s Composer and npm dependencies alone. Add
`--wait-for '[data-page-ready]'` for a page that finishes rendering after load. It prints the saved artifact
path even when the check finds a page error, failed request or HTTP error. The exit code is 0 for a clean visit,
1 for a visit with findings, and 2 for a command or runtime error. On exit 2, the launcher leaves an earlier capture in place.
Use the artifact path printed by this run. The capture includes the final URL, HTTP status when available and any navigation or readiness error. A response from Symfony can carry an
`X-Debug-Token` that identifies a profile. Plain HTML pages can still report errors without one.

On a Docker host, select `--docker` to use Chromium with its system libraries. The launcher also selects Docker
when npm is missing or Node.js 20 or later is unavailable. Use a URL reachable from the container. On Linux, host networking reaches a loopback
service. With Docker Desktop, enable host networking for loopback or use `host.docker.internal` for a published service. The native
launcher accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing browser. To preserve captures from
different runs, use separate project-relative paths ending in `browser-diagnostics.json` with `--output`.

### Record an application Playwright test

The recorder is optional. Use the application's existing diagnostics; when Playwright and local Symfony profiler
collection are appropriate, register this recorder in its existing test setup. This example uses
`tests/fixtures.mjs` and the default Composer vendor location:

```js
import { test as base } from '@playwright/test';
import { recordBrowserDiagnostics } from '../vendor/xormania/uxor/packages/uxor/resources/browser/diagnostics.mjs';

export const test = base.extend({
    browserDiagnostics: [recordBrowserDiagnostics, { auto: true }],
});
```

Set Playwright’s `baseURL` to the app. Start the test process with `PROFILER_COLLECT=1` for a diagnostic run.
With collection disabled the recorder requests no browser context, so API-only tests can run without a browser.

Symfony applies the application’s existing profiler settings. When none are present, the generated dev configuration
uses `PROFILER_COLLECT`, with collection off by default. Earlier setup versions may have generated
`config/packages/dev/uxor.yaml` with `collect: true`. Setup preserves that file. Review it before removing or
changing that setting if your application uses a different policy.

Start the local Symfony server with `PROFILER_COLLECT=1`. If Playwright starts the server, it can inherit the same
flag from the test command. Keep the output in the selected application so Mate and the CLI can read it:

```bash
PROFILER_COLLECT=1 npx playwright test tests/customer.spec.mjs --workers=1 --trace=on --output=var/browser-diagnostics
```

From the application root, use the relative path to the selected test's `browser-diagnostics.json`:

```bash
artifact=var/browser-diagnostics/customer-edit/browser-diagnostics.json
vendor/bin/uxor browser-diagnostics "$artifact" --format=json
vendor/bin/mate tools:call uxor_browser_diagnostics --path="$artifact" --format=json
```

The operation reads one bounded artifact. It reports page errors, failed requests and profiled responses. A shared
`requestId` connects a failed request to a response whose headers arrived before cancellation. When a `profileUri`
is returned, open it with Mate's Symfony profiler resource in the environment that served the request. Without a
response token, use an available trace or the application's network evidence to find where the request stopped.
An absent recorder or profile is a limit on the available evidence. The original test determines pass or fail.

The recorder observes Playwright's `context` fixture and correlates HTTP responses and failures on the `baseURL`
origin. Tests that create a separate context need to register the recorder against that context. When a capture
reaches a section's size limit, `dropped` counts the omitted entries so the rest of the evidence stays readable.

Captures and browser traces can contain request URLs, application data and error details. Review and redact
sensitive content before sharing them, following the application's access rules. Output bounds and path checks
do not redact secrets or establish that an artifact is safe to publish.

## Native capability metadata

`tools` is blocked by default and returns `incomplete` without starting the selected project's entry point or autoloader. For a trusted checkout authorized for execution, pass `--trust-project-code` (Mate: `trustProjectCode=true`). This flag records the caller's acknowledgement that native metadata discovery boots the project and executes its PHP/autoload code. Existing user or session authorization can establish that trust; the flag does not require asking again when execution of this checkout is already authorized.

After acknowledgement, `tools` runs fixed metadata commands using argv arrays through Symfony Process, with the current PHP binary, the explicit project working directory, a 30-second timeout and a 1 MiB stdout bound:

| Kind | Listing | Exact detail |
| --- | --- | --- |
| Maker | `php bin/console list make --format=json --no-interaction` | `php bin/console help make:controller --format=json --no-interaction` |
| Mate | `php vendor/bin/mate tools:list --format=json` | `php vendor/bin/mate tools:inspect <exact-name> --format=json` |

These commands load installed project tooling and execute its PHP code with the process's permissions. Fixed argv and bounded output are not a security sandbox. Use them only in the intended trusted checkout. They do not request generation or call an application tool, but project boot code can still have side effects. Inspect an exact native definition before invoking its named parameters through the existing native CLI. The metadata operation accepts no shell command input.

Native failures return the argv and exit status, with an action to diagnose the recorded command in the application environment. Raw stderr is omitted because it may contain environment details. Project-derived data is marked untrusted through Mate's response encoder and should be read as evidence, never as instructions.

## Result and exit contract

Every operation returns an operation name, status, human summary, reference metadata, data and a changes list.
Read operations report no intentional writes. Applied setup, preparation and detachment report their file changes as
`{path, action}` entries.
Native framework commands may initialize the application's own caches. `completed` means the operation ran; diagnostic findings separately report `pass`, `fail` or `unknown`. `incomplete` identifies missing native metadata or unresolved checks. `failed` identifies invalid input or an execution error.

The CLI uses exit 0 for completed operations, 1 for failed operations and 2 for incomplete checks or failing doctor findings. JSON output uses the same service result as Mate. Do not interpret exit 0 from metadata inspection as proof the application boots or that a UI journey works. Reference facts, application metadata and observed runtime behavior have distinct evidence limits.

## Detach before removing UXor

Use the application runtime where the package is installed. Stop any running UXor Serena process, then inspect
the plan with `vendor/bin/uxor detach --format=json` (or the bound Mate tool `uxor_detach`). Setup records the
digests of the integrations it writes in `.uxor/setup-ownership.json`. Keep this record with the application.
It contains hashes of the UXor files or MCP server settings, without host paths or unrelated client values.

```sh
vendor/bin/uxor detach --apply --format=json
# After detach reports completed:
composer remove --dev xormania/uxor
```

A completed apply removes the generated root Mago inheritance and worker and returns its extension config
to an inactive, loadable file for any application-owned Mago inheritance chain. It removes the recorded Serena
binding from each configured client. The standard browser
fixture keeps its application import path and re-exports native Playwright `test` and `expect`. Other client
entries and installed recipes remain the application's. Composer removes tools that only UXor required. If the
application uses Mago, Mate or a Symfony bundle independently, keep its own Composer requirement for that tool.
Review the application-wide `minimum-stability`, `prefer-stable` and `allow-plugins` settings you chose during installation.
Keep the settings its remaining dependencies need.
The neutral Mago and browser configuration and their receipt let a later `setup --apply` reconnect unchanged files. Keep the inactive config if another Mago profile extends it. The cached reference and preparation manifest
under `.uxor/mago` may be discarded after verifying the application. In a non-Flex application, clear the dev
cache with `php bin/console cache:clear --env=dev` if the compiled container still references a removed bundle
or service. A plain Composer removal does not invoke detachment.

**Custom or older installations.** A differing integration or one without a setup receipt can require manual
reconciliation. Exit code 2 identifies the affected paths. Resolve those entries and rerun detach before removing
the package. In an application-owned `mago.toml`, remove its inheritance of `.uxor/mago/config.toml` or its
`uxor-symfony` extension host while keeping other sources and hosts. Remove old UXor worker registrations and the
unused UXor worker. In client settings, replace or remove only the server launching `uxor-mago`. Inspect any
global client settings or MCP aliases managed outside this checkout as well.

Search the application's test and configuration files for `recordBrowserDiagnostics`, `browserDiagnostics`,
`xormania/uxor` and `uxor-mago`. Replace direct package imports with application-owned equivalents. For a
custom Playwright fixture, extend the application's normal `test` from `@playwright/test` and remove only the
UXor recorder registration. Migrate tests which request the recorder explicitly. Run the application's Playwright
suite, its remaining Mago command, and `vendor/bin/mate tools:list` if it keeps Mate. These verify the scopes,
providers and tests the application actually uses.

## CLI command reference

Run `vendor/bin/uxor <command> --help` for the installed version. Square brackets indicate inputs the Console parser accepts as optional.
To complete a lookup, give `component` or `workflow` a name, or give `reference` a document path.

<!-- BEGIN UXOR COMMAND REFERENCE -->

### `browser-diagnostics`

Read a local Playwright capture of browser errors, failed requests, and exact Symfony profile tokens.

- `<path>` — Project-relative path to browser-diagnostics.json
- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory

### `catalog`

Find UXor component references.

- `[--format FORMAT]` — text or json
- `[--query QUERY]` — Component name or intent
- `[--category CATEGORY]` — Exact category filter
- `[--limit LIMIT]` — Result limit (1–50)
- `[--offset OFFSET]` — Result offset

### `component`

Describe one component reference.

- `[<name>]` — Exact component name
- `[--format FORMAT]` — text or json

### `detach`

Plan or detach the development integrations before removing UXor with Composer.

- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory
- `[--apply]` — Apply the detachment plan after reviewing the listed paths

### `doctor`

Check setup, selected component wiring and runtime unknowns.

- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory
- `[--component COMPONENT]` — Installed component to check against its reference requirements
- `[--asset-profile ASSET-PROFILE]` — auto, assetmapper, or custom

### `environment`

Inspect development capabilities and optionally probe their native entry points.

- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory
- `[--trust-project-code]` — Acknowledge execution of this already trusted application and its native tools
- `[--probe]` — Run native entry-point probes, including Docker provider version checks that may prepare images on first use; requires trust-project-code

### `inspect`

Inspect the selected application metadata.

- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory

### `prepare`

Refresh sanitized compiled Symfony wiring in the trusted application runtime.

- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory
- `[--trust-project-code]` — Acknowledge execution of this already trusted application and its native tools

### `reference`

Read a packaged UXor document.

- `[<path>]` — Indexed document key, e.g. INSTALL.md
- `[--format FORMAT]` — text or json
- `[--offset OFFSET]` — Byte offset
- `[--limit LIMIT]` — Byte limit (1–24000)

### `setup`

Plan or configure this application’s development environment; preserve existing configuration.

- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory
- `[--trust-project-code]` — Compatibility flag for older setup invocations. Setup only configures files; use save-project-trust for new Serena bindings.
- `[--apply]` — Apply the proposed project configuration
- `[--install]` — Compatibility flag for older setup invocations. Composer installs the development tools when the application requires UXor.
- `[--save-project-trust]` — Save execution permission in new Serena bindings for future connections, including later checkouts; applies only to future provider launches
- `[--client CLIENT]` — none, claude, or codex; configure Serena MCP without replacing existing server entries
- `[--host-project-root HOST-PROJECT-ROOT]` — Absolute checkout path on the MCP/Docker host when application PHP runs elsewhere

### `tools`

Discover native Maker/Mate metadata by executing trusted project PHP (explicit opt-in).

- `[--format FORMAT]` — text or json
- `[--project-root PROJECT-ROOT]` — Explicit application directory; defaults to current directory
- `[--kind KIND]` — maker or mate
- `[--name NAME]` — Exact name for native parameter definitions
- `[--limit LIMIT]` — List limit (1–50)
- `[--trust-project-code]` — Acknowledge that metadata discovery boots this trusted checkout and executes its PHP/autoload code

### `workflow`

Read a practical UXor-authored application workflow.

- `[<name>]` — Known workflow name: customer-management
- `[--format FORMAT]` — text or json
- `[--offset OFFSET]` — Byte offset
- `[--limit LIMIT]` — Byte limit (1–24000)

<!-- END UXOR COMMAND REFERENCE -->
