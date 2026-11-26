# Set up the toolkit directly

Use this guide to set up Symfony UX Toolkit, assets and the theme in your application. If you're getting
started with UXor, follow the recommended [Composer package guide](packages/uxor/README.md). It includes
this kit setup and takes you through rendering your first component. Experienced teams can also use
these steps directly for a kit-only installation.

## Requirements

The kit needs PHP 8.4 or later with the `zip` extension, Tailwind CSS v4 and Flowbite v4's stylesheet.
The standard setup uses AssetMapper and TailwindBundle's standalone binary. UXor tests the kit on Symfony 7.4
LTS and 8.1. For `calendar` and `date-picker` in locales other than `en`, enable PHP's `intl` extension.

For a new Symfony application, create a project (for example `composer create-project symfony/skeleton`),
then run the *Symfony* steps below from its root. With Symfony Docker, run Composer and Symfony commands in
the PHP container, for example `docker compose exec php composer …` and `docker compose exec php bin/console …`.
For an existing application, check which dependencies, asset configuration and components are already in place.

### Symfony

- Allow Symfony Flex contrib recipes: `composer config extra.symfony.allow-contrib true`. Every component uses the `tailwind_classes` Twig filter of `tales-from-a-dev/twig-tailwind-extra`, and a contrib recipe enables its bundle. Do it before running the `composer require` command that `ux:install` prints, or components fail with `Unknown "tailwind_classes" filter`.
- Require Twig and Twig components as regular dependencies, before the toolkit: `composer require symfony/twig-bundle symfony/ux-twig-component`. TwigComponentBundle needs TwigBundle, but does not require it. And if Twig components only come in with the toolkit, a dev dependency, `symfony/property-access` is dev-only too, and `cache:clear` fails with "non-existent service property_accessor".
- UXor's Composer development package includes Symfony UX Toolkit and the HTTP client it uses to fetch kits from GitHub. For a kit-only installation, run `composer require --dev symfony/ux-toolkit:^3.8 symfony/http-client`.
- Require AssetMapper and StimulusBundle: `composer require symfony/asset-mapper symfony/stimulus-bundle`. The layouts load the `app` importmap entrypoint, and StimulusBundle loads the recipes' Stimulus controllers from `assets/controllers/`.

### Tailwind CSS

Install [TailwindBundle](https://symfony.com/bundles/TailwindBundle/current/index.html), which downloads the
standalone Tailwind CSS binary. Keep major version `4` when `tailwind:init` prompts you.

```bash
composer require symfonycasts/tailwind-bundle
php bin/console tailwind:init
```

Keep `php bin/console tailwind:build --watch` running while you work.

## Installation

1. Install Flowbite's stylesheet (base styles of the form controls) with AssetMapper. The recipes' Stimulus
   controllers provide the browser behavior.

```bash
php bin/console importmap:require "flowbite/dist/flowbite.min.css@^4.0.2"
```

The kit is tested with Flowbite 4. `importmap:update` ignores the version constraint and would install Flowbite's latest version, even a new major: to update the stylesheet, run the `importmap:require` command above again.

2. Install the `theme` recipe. It copies `assets/styles/uxor.css`: UXor's light and dark color roles, using Flowbite's role names and adding UXor's contrast and chart colors. Use roles through utilities such as `bg-brand`, `text-heading` and `border-default`. Then make `assets/styles/app.css` start with these imports, in this order (Flowbite's stylesheet after Tailwind, the theme last):

```
php bin/console ux:install theme --kit=https://github.com/xormania/uxor:<version>
```

`<version>` is the application's chosen tagged release (`X.Y.Z`) by default, the same for its recipes.
See [Choosing a revision](#choosing-a-revision) for a new installation, an update or an explicitly requested unreleased test.

```css
@import 'tailwindcss';

/* Downloaded by importmap:require */
@import '../vendor/flowbite/dist/flowbite.min.css';

/* UXor's color roles, light and dark, from the `theme` recipe */
@import './uxor.css';
```

3. Choose a recipe from [the toolkit catalog](docs/RECIPES.md). After installing it, run
   the `composer require` and `importmap:require` commands that Toolkit prints for its dependencies.

```
php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor:<version>
```

Before deploying a page that uses UX Icons, run `php bin/console ux:icons:lock` and commit the icons it saves.
Repeat this when your templates use new icons. That lets the application serve the selected icons locally.

## Choosing a revision

For a new installation, choose a tagged release from [Releases](https://github.com/xormania/uxor/releases).
For an existing application, keep its chosen release unless the task includes an update. Use the explicit revision
in every `--kit` argument; omitting it selects the repository's moving default branch.

Establish an existing recipe's origin from the application's installation or update records. Copied files may
have been customized, and the optional helper package's version does not prove their origin. If the revision is
unknown, report it as unknown; choosing a revision for new work does not establish the history of existing files.

For explicitly authorized testing of unreleased UXor work, replace `<version>` with the full 40-character commit
SHA and record that revision with the test results and relevant local adaptations. Use the same pinned revision
throughout that test so another person can reproduce it.

## Application-owned files and guidance

The application owns and may customize installed recipe files. Read the recipe's README for its props, extension
points and security contracts. Before reinstalling with `--force`, preserve local changes using the application's
normal workflow; review the resulting diff and reconcile customizations.

The optional [Composer development package](packages/uxor/README.md) supplies tools, documentation and
package-managed consumer guidance. Integrate it while preserving the application's own instructions. For kit-only use,
adapt the [optional project snippet](docs/PROJECT-AGENTS-SNIPPET.md)
if you want to keep UXor guidance alongside your application's existing instructions.

Verify the installed components in their application context using
[application testing](docs/APPLICATION-TESTING.md).
