# Getting started

UXor is an independently maintained Symfony UI library, currently distributed as a Symfony UX Toolkit kit: Twig
components, Stimulus controllers, a form theme, layouts and blocks (ready-made parts of a page), styled with
[Flowbite](https://flowbite.com/) v4 and Tailwind CSS v4. Each one is a recipe you install with
`php bin/console ux:install`, once the project is set up as below.

These steps install the Toolkit kit into a consuming application, which owns the copied recipes. UXor also provides
an optional [Composer development package, `xormania/uxor`](packages/uxor/README.md), for agent guidance, diagnostics
and tools; it does not install recipes. Follow the application's own instructions, workflow and permissions, and
preserve its existing configuration. Developing either deliverable or the repository's demo and test fixtures
starts with [`CONTRIBUTING.md`](https://github.com/xormania/uxor/blob/main/CONTRIBUTING.md).

The official Symfony UX `flowbite-4` kit was an initial reference only. The Toolkit installer, Flowbite stylesheet
and icon set are current integrations, not a requirement to track that kit. These setup instructions describe the
current release; UXor's requirements and compatibility commitments govern how its integrations evolve.

## Requirements

The kit needs PHP 8.4 or later with the `zip` extension, Tailwind CSS v4 and Flowbite v4's stylesheet.
The standard setup uses Symfony AssetMapper and TailwindBundle's standalone binary and runs without Node.js.
On a new Symfony project (`composer create-project symfony/skeleton`), follow the *Symfony* steps first.

### Symfony

- Allow Symfony Flex contrib recipes: `composer config extra.symfony.allow-contrib true`. Every component uses the `tailwind_classes` Twig filter of `tales-from-a-dev/twig-tailwind-extra`, and a contrib recipe enables its bundle. Do it before running the `composer require` command that `ux:install` prints, or components fail with `Unknown "tailwind_classes" filter`.
- Require Twig and Twig components as regular dependencies, before the toolkit: `composer require symfony/twig-bundle symfony/ux-twig-component`. TwigComponentBundle needs TwigBundle, but does not require it. And if Twig components only come in with the toolkit, a dev dependency, `symfony/property-access` is dev-only too, and `cache:clear` fails with "non-existent service property_accessor".
- Require the toolkit with `symfony/http-client`: `composer require --dev symfony/ux-toolkit:^3.5 symfony/http-client`. The toolkit downloads kits from GitHub with the HTTP client, but does not require it.
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

3. Install the recipes you need. [`docs/RECIPES.md`](https://github.com/xormania/uxor/blob/main/docs/RECIPES.md) lists them. Run the printed
   `composer require` and `importmap:require` commands for the recipe's dependencies.

```
php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor:<version>
```

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
the [project snippet](https://github.com/xormania/uxor/blob/main/docs/PROJECT-AGENTS-SNIPPET.md) is optional; adapt and merge it only when persistent UXor
guidance is wanted, and avoid duplicating guidance already supplied by the helper.

Verify the installed components in their application context using [application testing](https://github.com/xormania/uxor/blob/main/docs/APPLICATION-TESTING.md).
