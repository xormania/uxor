# Toggle

Use the toggle component to switch between a binary state of true or false using a single click available in multiple sizes, variants, and colors

```twig {"preview":true}
<twig:Toggle id="checked" value="" checked>
    Toggle me
</twig:Toggle>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=toggle#recipes). To install `toggle` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component toggle --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

```twig
<twig:Toggle>
    Label
</twig:Toggle>
```

The knob slides (`translate`); under `prefers-reduced-motion` it moves at once.

## Examples

### Disabled

Apply the disabled attribute to disallow the users from making any further selections.

```twig {"preview":true}
<div class="flex flex-col gap-3">
    <twig:Toggle value="" disabled>
        Toggle me
    </twig:Toggle>

    <twig:Toggle value="" checked disabled>
        Toggle me
    </twig:Toggle>
</div>
```

## API Reference

::: api-reference
