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

Run these commands in the application after reviewing the plugin permission. The listed prereleases can be
installed under the application's normal stable policy.

<!-- package-install:start -->

Requires PHP `>=8.4`.

```sh
composer config 'allow-plugins.symfony/ai-mate-composer-plugin' true
composer require --dev 'xormania/uxor:^0.3.5' \
    'symfony/ai-mate:>=1.0.0-BETA1 <1.0.0-BETA2@beta' \
    'symfony/ai-mate-composer-plugin:>=1.0.0-BETA1 <1.0.0-BETA2@beta' \
    'symfony/ai-symfony-mate-extension:>=1.0.0-BETA1 <1.0.0-BETA2@beta'
```

<!-- package-install:end -->

Commands below assume Composer's default `vendor/bin`. Use your project's configured binary directory if it differs.

## Configure the development environment

In the application's PHP environment, plan setup for the client you use. The commands below use Codex;
replace `--client=codex` with `--client=claude` for Claude Code. If your PHP process sees `/app` but your
client runs on the host, add `--host-project-root=/absolute/host/path/to/the/app` to **both** setup commands
before applying. If you want to save execution permission for later connections, make that choice
[before creating the binding](#connect-an-agent-client). For CLI-only use, omit the client option.

```sh
vendor/bin/uxor setup --client=codex --format=json
```

Review the proposed dependencies, files and next steps. In an existing app, keep its own configuration and
reconcile any differences reported by the plan. Once you authorize Composer scripts and application PHP
to run for this setup, apply it:

```sh
vendor/bin/uxor setup --client=codex --apply --install --trust-project-code --format=json
vendor/bin/uxor environment --format=json
```

This installs missing development tools, including Maker and Symfony's profiler, initializes Mate when needed
and refreshes its tools and skills. Resolve any remaining integration steps reported for your application.
For example, an application without Flex must register its profiler bundles and routes.
[Custom application integration](OPERATIONS.md#set-up-and-inspect-the-development-environment).

### Connect an agent client

1. From the same checkout **on the Docker host**, run `vendor/bin/uxor-mago pull`. It prepares both Mago
   providers from the shipped Linux amd64 build recipes. Check `vendor/bin/uxor-mago version` and `vendor/bin/uxor-mago version serena` there.
2. **In the application PHP environment**, run `vendor/bin/uxor prepare --trust-project-code --format=json`.
   Look for `data.state` of `ready`. This prepares compiled Symfony service bindings for source queries.
   Re-run it after changes to dependencies, service configuration or other preparation inputs.
3. Review the Serena registration in your selected client. To authorize local PHP for a Serena launch, its
   arguments need `--trust-project-code` **before** `serena`. The setup command authorized only the install.
   To authorize every future connection at this checkout, including code checked out later, choose
   `--save-project-trust` when planning and applying a **new** binding. Setup preserves existing bindings.
   [Client configuration and execution permissions](OPERATIONS.md#set-up-and-inspect-the-development-environment)
   covers existing registrations, one-off launches and revocation.
4. Connect the client to `uxor-mago` and ask it to find a class or method you know exists in the application.
   Check that the returned file and symbol belong to this checkout. Mate's application CLI exposes the UXor tools:
   `vendor/bin/mate tools:list --format=json` should include `uxor_catalog`. Its three installed skills are
   `mate-uxor-setup`, `mate-uxor-build` and `mate-uxor-verify`.

If client or provider setup is incomplete, the following recipe workflow is also available through the package CLI.

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

**Render the key.** In a new application, use the [kit setup checklist](../../INSTALL.md) to install
Symfony UX Toolkit, configure AssetMapper and TailwindBundle, and install the theme once. For an existing
app, inspect its setup and local customizations first. Use its chosen kit release for new recipes. [Choosing a revision](../../INSTALL.md#choosing-a-revision) explains how to identify it.
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
- For a failed browser interaction, [correlate a request with its Symfony profile](OPERATIONS.md#browser-diagnostics).

<a id="optional-php-checks-and-serena-with-mago"></a>
<a id="prepare-the-providers-on-the-docker-host"></a>
<a id="inspect-and-change-source"></a>
<a id="refresh-symfony-knowledge"></a>

## Mago and Serena

For custom runtimes and manual configuration, see [provider preparation](OPERATIONS.md#prepare-the-providers-on-the-docker-host),
[source checks and editing](OPERATIONS.md#inspect-and-change-source), and
[compiled Symfony service bindings](OPERATIONS.md#prepare-compiled-symfony-facts).

## Update an existing installation

Keep the package and its managed skills current using the application's own Composer and Mate commands:

```sh
composer update xormania/uxor
vendor/bin/mate discover
```

Composer updates the helper and its bundled references. Update the application's copied recipes separately
using its recorded kit revision and [recipe update procedure](../../docs/GUIDE.md#updating).

### Upgrade from the old skill names

UXor's skill slugs are now `uxor-setup`, `uxor-build` and `uxor-verify`. Mate installs them with a `mate-` prefix.
Use the new names in agent instructions and skill commands. Application skills can use the original generic slugs
in their own source directories.

Before updating with Composer, record which skills are disabled or overridden and keep the override sources in
`mate/skills/`. Save edits made directly in `.agents/skills/mate-*` or `.claude/skills/mate-*` outside those
directories. Mate manages those targets and can remove them when Composer triggers discovery during the update.

The skill rename shipped in UXor 0.3.5. An existing `^0.3` constraint already permits that release.
Use the [current install command](#install-in-a-symfony-application) when upgrading so the application
admits the required UXor and Mate versions.

Run `vendor/bin/mate discover` after the update. Mate registers the application skills from their configured
sources, retires the old generated UXor copies and installs the new ones. Old override sources under `mate/skills/`
remain in place. To carry forward a build override, run `vendor/bin/mate skills:override uxor-build`, port your
edits from `mate/skills/build/` into `mate/skills/uxor-build/`, then run `vendor/bin/mate discover` again. Keep
`name: uxor-build` in the new skill's front matter. Reapply any disable setting with the new slug, for example
`vendor/bin/mate skills:disable uxor-build`.

## Developing this package

When changing the package's source in the UXor repository, follow that repository's
[AGENTS.md](https://github.com/xormania/uxor/blob/0.3.5/AGENTS.md) and
[CONTRIBUTING.md](https://github.com/xormania/uxor/blob/0.3.5/CONTRIBUTING.md) for development and review.
The repository demo and package-development consumer are test environments; installed skills operate in
the consuming application. Report package vulnerabilities as UXor's
[SECURITY.md](https://github.com/xormania/uxor/blob/0.3.5/SECURITY.md) describes.

MIT licensed.
