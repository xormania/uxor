# Progress

A bar showing how far a task has come.

```twig {"preview":true}
<div class="w-full max-w-md space-y-6">
    <twig:Progress value="45" label="Upload" showValue />
    <twig:Progress value="80" label="Storage" variant="warning" size="lg" showValue />
    <twig:Progress value="100" label="Import" variant="success" size="sm" />
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:Progress value="45" label="Upload" showValue variant="brand | success | danger | warning" size="sm | default | lg" />
```

For a measure rather than the progress of a task (a share of sales, a storage quota), add `meter`: `<twig:Progress value="62" label="Storage" meter />`. Assistive technologies then announce it as a meter (`role="meter"`).

Without a visible `label`, name the bar with `aria-label` or `aria-labelledby`, for example `<twig:Progress value="45" aria-label="Upload" />`. The component puts that name on the bar itself (the `progressbar` or `meter` element), not on the wrapper. `showValue` needs a `label`: the percentage is shown next to it.

The bar is an empty `<svg>` sized by its `width` attribute, not by a `style` attribute: a Content Security Policy that restricts styles (`style-src` without `'unsafe-inline'`) blocks style attributes, and the bar would then fill the whole track.
