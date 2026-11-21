# Getting started

UXor is an independently maintained Symfony UI library, currently distributed as a Symfony UX Toolkit kit: Twig
components, Stimulus controllers, a form theme, layouts and blocks (ready-made parts of a page), styled with
[Flowbite](https://flowbite.com/) v4 and Tailwind CSS v4. Each one is a recipe you install with
`php bin/console ux:install`, once the project is set up as below.

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

`<version>` is a release (`X.Y.Z`): the latest one on the [Releases](https://github.com/xormania/uxor/releases) page, the same for every recipe of a project.

```css
@import 'tailwindcss';

/* Downloaded by importmap:require */
@import '../vendor/flowbite/dist/flowbite.min.css';

/* UXor's color roles, light and dark, from the `theme` recipe */
@import './uxor.css';
```

3. Install the recipes you need. [`docs/RECIPES.md`](docs/RECIPES.md) lists them. Run the printed
   `composer require` and `importmap:require` commands for the recipe's dependencies.

```
php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor:<version>
```
