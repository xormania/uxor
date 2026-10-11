# Theme

The Flowbite color roles (light and dark) with this kit's contrast fixes and its roles for text on a solid fill, as one stylesheet for `assets/styles/app.css`.

## Installation

::: installation

## Usage

The recipe copies `assets/styles/uxor.css`, Flowbite's theme with every color role checked for contrast. A role is a named color used through utilities such as `bg-brand`, `text-heading` or `border-default`. The file defines the roles (`@theme`), their dark values (`.dark`) and the `dark:` variant (`@custom-variant dark`), and gives Turbo Drive's progress bar the brand color. Import it after Tailwind and Flowbite's stylesheet in `assets/styles/app.css`:

```css
@import "tailwindcss";

/* AssetMapper: `php bin/console importmap:require "flowbite/dist/flowbite.min.css@^4.0.2"` downloads it to assets/vendor */
@import "../vendor/flowbite/dist/flowbite.min.css";
/* Webpack Encore: @import "flowbite/dist/flowbite.min.css"; */

@import "./uxor.css";

/* The templates of your app (Tailwind scans the project root by default; list them if you build from elsewhere) */
@source "../../templates";
```

### Dark mode

Dark mode is class based: the `.dark` overrides and the `dark:` variant apply below an element with the `dark` class, normally `<html class="dark">`. The `theme-toggle` recipe switches it and documents a snippet that sets it before the first paint.

### On-fill roles

Text on a solid fill, such as a brand button, an indicator, a calendar's selected day, the active pill tab, a tooltip
or an avatar group's count, uses the `fg-on-*` role of that fill: `text-fg-on-brand` on `bg-brand`, and
`fg-on-success`, `fg-on-danger`, `fg-on-warning` and `fg-on-dark` on theirs. The toggle's knob is `bg-knob`. Flowbite's
theme has no such roles: they are this kit's addition to `uxor.css`. Every one is white, in both themes.

With a light brand color, white text on it is hard to read: in your copy of `uxor.css` (the project owns it,
like every file a recipe copies), set `--color-fg-on-brand` to a dark color, in `@theme` and in `.dark`:

```css
@theme {
    --color-fg-on-brand: var(--color-gray-900);
}

.dark {
    --color-fg-on-brand: var(--color-gray-900);
}
```

Every component that puts text on the brand fill follows. Check that it reaches 4.5:1 on your brand color, and on its
hover color (`brand-strong`), in both themes.

### Chart series

`chart-1` to `chart-6` color the series of a chart, in that order, and `chart-other` any series after the sixth.
Each one reaches 3:1 on the page and in a card, in both themes, and neighbors stay apart for the common color vision
deficiencies. The `chart` recipe applies them; use them yourself as `bg-chart-1`, `text-chart-2`…

### Contrast

In both themes, text roles reach a contrast of 4.5:1 on the backgrounds they are meant for (the `fg-on-*` roles on their fills), and the focus ring 3:1. The kit's repository checks [these pairs](https://github.com/xormania/uxor/blob/main/tools/contrast/pairs.json) on every change. Keep small `fg-brand` text off `brand-soft` backgrounds: in dark mode that pair is below 4.5:1, so use `fg-brand-strong` there.
