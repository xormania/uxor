# Getting started

UXor is a Symfony UX Toolkit kit: Twig components, Stimulus controllers, a form theme, layouts and blocks (ready-made parts of a page), styled with [Flowbite](https://flowbite.com/) v4 and Tailwind CSS v4. Each one is a recipe you install with `php bin/console ux:install`, once the project is set up as below.

## Requirements

The kit needs PHP 8.4 or later with the `zip` extension, Tailwind CSS v4 and Flowbite v4's stylesheet. On a new Symfony project (`composer create-project symfony/skeleton`), do the *Symfony* steps first, in this order:

### Symfony

- Allow Symfony Flex contrib recipes: `composer config extra.symfony.allow-contrib true`. Every component uses the `tailwind_classes` Twig filter of `tales-from-a-dev/twig-tailwind-extra`, and a contrib recipe enables its bundle. Do it before running the `composer require` command that `ux:install` prints, or components fail with `Unknown "tailwind_classes" filter`.
- Require Twig and Twig components as regular dependencies, before the toolkit: `composer require symfony/twig-bundle symfony/ux-twig-component`. TwigComponentBundle needs TwigBundle, but does not require it. And if Twig components only come in with the toolkit, a dev dependency, `symfony/property-access` is dev-only too, and `cache:clear` fails with "non-existent service property_accessor".
- Require the toolkit with `symfony/http-client`: `composer require --dev symfony/ux-toolkit:^3.5 symfony/http-client`. The toolkit downloads kits from GitHub with the HTTP client, but does not require it.
- Require AssetMapper and StimulusBundle: `composer require symfony/asset-mapper symfony/stimulus-bundle`. The layouts load the `app` importmap entrypoint, and StimulusBundle loads the recipes' Stimulus controllers from `assets/controllers/`.

### Tailwind CSS

- With AssetMapper, install Tailwind CSS with the [TailwindBundle](https://symfony.com/bundles/TailwindBundle/current/index.html). Keep the default major version, `4`, when `php bin/console tailwind:init` asks for it, and keep `php bin/console tailwind:build --watch` running while you work.
- With Webpack Encore, follow the [Tailwind CSS installation guide for Symfony](https://tailwindcss.com/docs/installation/framework-guides/symfony).

## Installation

1. Install Flowbite's stylesheet (base styles of the form controls), either with `importmap:require` for AssetMapper, or `npm` for Webpack Encore. The kit uses no Flowbite JavaScript: every behavior lives in the recipes' Stimulus controllers.

```
# With AssetMapper
php bin/console importmap:require "flowbite/dist/flowbite.min.css@^4.0.2"

# With npm
npm install "flowbite@^4.0.2"
```

The kit is tested with Flowbite 4. `importmap:update` ignores the version constraint and would install Flowbite's latest version, even a new major: to update the stylesheet, run the `importmap:require` command above again.

2. Install the `theme` recipe. It copies `assets/styles/uxor.css`: Flowbite's color roles (named colors with a light and a dark value, used as `bg-brand`, `text-heading`, `border-default`…), with this kit's contrast fixes. Then make `assets/styles/app.css` start with these imports, in this order (Flowbite's stylesheet after Tailwind, the theme last):

```
php bin/console ux:install theme --kit=https://github.com/xormania/uxor
```

```css
@import 'tailwindcss';

/* With AssetMapper (downloaded by importmap:require)... */
@import '../vendor/flowbite/dist/flowbite.min.css';
/* ... or with Webpack Encore */
/* @import 'flowbite/dist/flowbite.min.css'; */

/* Flowbite's color roles, light and dark, from the `theme` recipe */
@import './uxor.css';
```

3. Install the recipes you need; [`docs/RECIPES.md`](docs/RECIPES.md) lists them. Each `ux:install` prints a `composer require` command for the packages the recipe needs: run it.

```
php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor
```
