# Tooltip

A short text shown while a control is hovered or focused, also announced as its description.

```twig {"preview":true}
<div class="flex gap-4 pt-12">
    <twig:Tooltip content="Saved 2 minutes ago" id="tooltip-saved">
        <twig:Button variant="outline">Saved</twig:Button>
    </twig:Tooltip>
    <twig:Tooltip content="Delete the draft" placement="bottom" id="tooltip-delete">
        <twig:Button variant="outline" size="icon" aria-label="Delete">
            <twig:ux:icon name="flowbite:close-outline" class="size-5" aria-hidden="true" />
        </twig:Button>
    </twig:Tooltip>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:Tooltip content="Text" placement="top | bottom | left | right">
    <twig:Button>Hover or focus me</twig:Button>
</twig:Tooltip>
```

Wrap a focusable element: the tooltip opens on hover and on keyboard focus, closes on Escape, and the element gets `aria-describedby`. Tooltips only describe; never put the only label of an icon button in one (give the button an `aria-label`).

The tooltip opens on its `placement` side, 8 pixels from the element, flips to the other side when it does not fit there, and stays inside the viewport; it is placed once each time it shows (`data-placement` holds the side used). The placement and the flip are the `floating` recipe's module (`assets/lib/uxor-floating.js`), shared with `dropdown` and `popover`, which `ux:install tooltip` installs with it.

Without `id`, the tooltip gets a random one, which changes on every render. Inside a Live Component or a Turbo Frame, pass a stable `id` (e.g. `id="stock-{{ row.id }}"`) so a re-render keeps the same tooltip id.
