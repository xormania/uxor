# Set up UXor with Composer

Use `xormania/uxor` in your Symfony application to find recipes, configure development tools and give your
coding agent the matching instructions. This guide takes you from a Composer install to a keyboard shortcut
rendered by your own app. The package runs in development. Symfony UX Toolkit copies each selected recipe's
source into the app, where you can customize it.

## Install in a Symfony application

Run Composer, Symfony Console and the UXor CLI in the application's PHP environment. With Symfony Docker,
run them inside its PHP container. Start from the directory containing the application's `composer.json`.
If you're starting from scratch, create your Symfony project first, for example with `composer create-project symfony/skeleton my-app`, then change into its directory.

[Packagist](https://packagist.org/packages/xormania/uxor) lists the published versions. Use the command below
once the listed versions include this guide's release. If your app already uses UXor 0.3.0–0.3.2 with Mate 0.14,
read the [skill migration steps](#upgrade-from-the-old-skill-names) before updating.

This release uses Symfony AI Mate 1.x. The application must allow beta releases while stable 1.x packages are
unavailable. Composer’s `prefer-stable` setting prefers stable versions wherever the constraints allow them.
These settings apply to the whole application. Allow the UXor and Symfony AI Mate Composer plugins to run
when Composer prompts, or configure their permissions in advance as shown below.

<!-- package-install:start -->

Requires PHP `>=8.4` and Composer `^2.8.2`.

For a fresh application or a noninteractive install, apply these project settings first.

```sh
composer config minimum-stability 'beta'
composer config prefer-stable true
composer config 'allow-plugins.xormania/uxor' true
composer config 'allow-plugins.symfony/ai-mate-composer-plugin' true
```

Install the development package.

```sh
composer require --dev 'xormania/uxor:^0.3.5'
```

<!-- package-install:end -->

Composer installs Mate with its Symfony and Monolog extensions, the full Symfony debug pack, Maker, the Mago
PHP SDK and Symfony wiring, and the Symfony UX Toolkit installer with its HTTP client. During installation,
UXor writes missing project defaults and preserves existing settings. The plugins initialize Mate and discover
UXor’s tools, references and skills.
Try a catalog lookup in the application.

```sh
vendor/bin/mate tools:call uxor_catalog --query=kbd --format=json
```

The result should include the `kbd` recipe. Use the application's configured binary directory in place of
`vendor/bin` if it differs. With a custom Composer `vendor-dir`, use `uxor mate` in that binary directory
for every Mate command below. For example, with `vendor-dir: dependencies/php` and `bin-dir: tools/commands`,
run `tools/commands/uxor mate tools:call uxor_catalog --query=kbd --format=json`.
[Custom Composer directories](OPERATIONS.md#custom-composer-directories) explains the compatibility link and conflict handling. Continue to [use a recipe](#use), or configure additional integrations below.

## Configure the development environment

Use `vendor/bin/uxor setup` to preview project configuration and `vendor/bin/uxor setup --apply` to restore missing files.
To add a Serena binding, include your client in both commands. The example uses Codex. For Claude Code, use `--client=claude`.
Decide [how to authorize Serena launches](#connect-an-agent-client) before creating the binding. Setup preserves existing registrations.

```sh
vendor/bin/uxor setup --client=codex --format=json
vendor/bin/uxor setup --client=codex --apply --format=json
vendor/bin/uxor environment --format=json
```

When application PHP runs in Docker and the client runs on the host, pass the host checkout's absolute path
with `--host-project-root` to both setup commands. Review the plan for existing application settings that need reconciliation.

The application controls profiler collection. If UXor supplied the default policy, start the dev server with
`PROFILER_COLLECT=1` for a diagnostic run and use the response’s `X-Debug-Token` to find its profile.
See [custom application integration](OPERATIONS.md#set-up-and-inspect-the-development-environment) for non-Flex
bundle and route registration, and [diagnose a request](OPERATIONS.md#diagnose-a-request) to inspect a dump or log.

### Connect an agent client

1. Start the client on a Docker host that can access the checkout. The installed `vendor/bin/uxor-mago` launcher
   acquires the Serena provider on first use. For native Mago in the application, run `vendor/bin/mago --version`.
2. **In the application PHP environment**, run `vendor/bin/uxor prepare --trust-project-code --format=json`.
   Look for `data.state` of `ready`. This prepares compiled Symfony service bindings for source queries.
   Re-run it after changes to dependencies, service configuration or other preparation inputs.
3. Review the Serena registration in your selected client. To authorize local PHP for a Serena launch, its
   arguments need `--trust-project-code` **before** `serena`.
   To authorize every future connection at this checkout, including code checked out later, choose
   `--save-project-trust` when planning and applying a **new** binding. Setup preserves existing bindings.
   [Client configuration and execution permissions](OPERATIONS.md#set-up-and-inspect-the-development-environment)
   covers existing registrations, one-off launches and revocation.
4. Connect the client to `uxor-mago` and ask it to find a class or method you know exists in the application.
   Check that the returned file and symbol belong to this checkout. Mate's application CLI exposes the UXor tools:
   `vendor/bin/mate tools:list --format=json` should include `uxor_catalog`. Its three installed skills are
   `mate-uxor-setup`, `mate-uxor-build` and `mate-uxor-verify`.

If client or provider setup is incomplete, the following recipe workflow is also available through the package CLI.
To try the agent on an existing page, [give it a first read-only task](../../docs/AGENT-ONBOARDING.md).

## Use

**Find a recipe.** Look up the keyboard-key component and read its usage from the installed package:

```sh
vendor/bin/uxor catalog --query=kbd --format=json
vendor/bin/uxor component kbd --format=json
vendor/bin/uxor reference kbd/README.md --format=json
```

The result identifies the `kbd` recipe, its dependencies and the Twig to render it. To give an agent the
same job, ask it to add a visible **Ctrl** key to a page you name and verify that page. The agent can use
the bundled catalog, the application's own instructions and the same verification below.

**Render the key.** The development package supplies Toolkit’s `ux:install` command and the HTTP client it
uses to fetch kits. Follow the [kit setup checklist](../../INSTALL.md) for the application’s Twig components,
AssetMapper, TailwindBundle and theme. For an existing app, inspect its setup and local customizations first. Use its chosen kit release for new recipes. [Choosing a revision](../../INSTALL.md#choosing-a-revision) explains how to identify it.
Use the chosen release in the command below. In a checkout, replace `<version>` with that release.
Then run the dependency commands that Toolkit prints:

```sh
php bin/console ux:install kbd --kit=https://github.com/xormania/uxor:<version>
```

Add this to a Twig template used by a route in your application:

```twig
<twig:Kbd>Ctrl</twig:Kbd>
```

Build the application's styles, open that route and confirm the rendered page contains a styled `<kbd>` with
the text **Ctrl**. To check customization, edit the component copied to `templates/components/Kbd.html.twig`
and reload the page. For interactive recipes, exercise the requested behavior with the application's tests.
[Verify a component in your application](../../docs/APPLICATION-TESTING.md).

## Understand, build and diagnose

- To build a feature across recipes, try `vendor/bin/uxor workflow customer-management --format=json` for a
  searchable list, edit dialog, validation and save feedback. [Application guidance](../../FOR-AGENTS.md)
  covers selecting and adapting recipes.
- To inspect an existing project, run `vendor/bin/uxor inspect --format=json`. Use
  `vendor/bin/uxor doctor --component=modal --format=json` to check static wiring for a particular recipe,
  then verify the behavior through a served page.
- To check a served page immediately, run `vendor/bin/uxor-browser http://127.0.0.1:8000/`. It launches
  headless Chromium and saves JavaScript errors, failed requests and available Symfony profiler tokens. Any
  served HTML page works, including an application that has yet to install its first recipe.
  [Browser diagnostics and Playwright integration](OPERATIONS.md#browser-diagnostics).

<a id="optional-php-checks-and-serena-with-mago"></a>
<a id="prepare-the-providers-on-the-docker-host"></a>
<a id="inspect-and-change-source"></a>
<a id="refresh-symfony-knowledge"></a>

## Mago and Serena

For custom runtimes and manual configuration, see [provider preparation](OPERATIONS.md#prepare-the-providers-on-the-docker-host),
[source checks and editing](OPERATIONS.md#inspect-and-change-source), and
[compiled Symfony service bindings](OPERATIONS.md#prepare-compiled-symfony-facts).

## Update an existing installation

Update the package in the application:

```sh
composer update xormania/uxor
```

Composer updates the helper and its bundled references and triggers Mate discovery for its tools and skills. Update the application's copied recipes separately
using its recorded kit revision and [recipe update procedure](../../docs/GUIDE.md#updating).

### Upgrade from the old skill names

UXor's skill slugs are now `uxor-setup`, `uxor-build` and `uxor-verify`. Mate installs them with a `mate-` prefix.
Use the new names in agent instructions and skill commands. Application skills can use the original generic slugs
in their own source directories.

Before updating with Composer, record which skills are disabled or overridden and keep the override sources in
`mate/skills/`. Save edits made directly in `.agents/skills/mate-*` or `.claude/skills/mate-*` outside those
directories. Mate manages those targets and can remove them when Composer triggers discovery during the update.

UXor 0.3.5 renames the skills. An existing `^0.3` constraint already permits that release.
Use the [current install command](#install-in-a-symfony-application) when upgrading so the application
admits the required UXor and Mate versions.

During the update, Mate registers the application skills from their configured
sources, retires the old generated UXor copies and installs the new ones. Old override sources under `mate/skills/`
remain in place. To carry forward a build override, run `vendor/bin/mate skills:override uxor-build`, port your
edits from `mate/skills/build/` into `mate/skills/uxor-build/`, then run `vendor/bin/mate discover` to register your edits. Keep
`name: uxor-build` in the new skill's front matter. Reapply any disable setting with the new slug, for example
`vendor/bin/mate skills:disable uxor-build`.

## Remove the development package

Run `vendor/bin/uxor detach` while UXor is still installed. Review its plan, stop running UXor providers, and
reconcile any listed application integrations. Apply the plan with `vendor/bin/uxor detach --apply`. After a
completed result, run `composer remove --dev xormania/uxor`. The [removal instructions](OPERATIONS.md#detach-before-removing-uxor)
cover customized files, earlier installations, and how to verify remaining Playwright, Mago and Mate integrations.

## Developing this package

When changing the package's source in the UXor repository, follow that repository's
[AGENTS.md](https://github.com/xormania/uxor/blob/0.3.5/AGENTS.md) and
[CONTRIBUTING.md](https://github.com/xormania/uxor/blob/0.3.5/CONTRIBUTING.md) for development and review.
The repository demo and package-development consumer are test environments; installed skills operate in
the consuming application. Report package vulnerabilities as UXor's
[SECURITY.md](https://github.com/xormania/uxor/blob/0.3.5/SECURITY.md) describes.

MIT licensed.
