# Button Group

Groups buttons and links in one element, horizontally or vertically.

If your list reads the `sort` query parameter, group its sort links with native anchors.

```twig
<twig:ButtonGroup aria-label="Sort order">
    <a href="?sort=oldest" class="px-3 py-2">Oldest first</a>
    <a href="?sort=newest" class="px-3 py-2">Newest first</a>
</twig:ButtonGroup>
```

For this example, install the [button](../button/README.md) recipe.

```twig {"preview":true}
<twig:ButtonGroup>
    <twig:Button variant="tertiary" size="sm">Profile</twig:Button>
    <twig:Button variant="tertiary" size="sm">Settings</twig:Button>
    <twig:Button variant="tertiary" size="sm">Messages</twig:Button>
</twig:ButtonGroup>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=button-group#recipes). To install `button-group` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component button-group --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

For this example, install the [button](../button/README.md) recipe.

```twig
<twig:ButtonGroup>
    <twig:Button variant="tertiary">One</twig:Button>
    <twig:Button variant="tertiary">Two</twig:Button>
</twig:ButtonGroup>
```

## Accessibility

- The `ButtonGroup` component has the `role` attribute set to `group`.
- Use `Tab` to navigate between the buttons in the group.

## Examples

### Orientation

For this example, install the [button](../button/README.md) recipe.

```twig {"preview":true}
<twig:ButtonGroup orientation="vertical" class="w-56">
    <twig:Button variant="tertiary">Profile</twig:Button>
    <twig:Button variant="tertiary">Settings</twig:Button>
    <twig:Button variant="tertiary">Messages</twig:Button>
</twig:ButtonGroup>
```

### Size

For this example, install the [button](../button/README.md) recipe.

```twig {"preview":true}
<div class="flex flex-col items-start gap-8">
    <twig:ButtonGroup>
        <twig:Button variant="tertiary" size="sm">Small</twig:Button>
        <twig:Button variant="tertiary" size="sm">Button</twig:Button>
        <twig:Button variant="tertiary" size="sm">Group</twig:Button>
    </twig:ButtonGroup>
    <twig:ButtonGroup>
        <twig:Button variant="tertiary">Default</twig:Button>
        <twig:Button variant="tertiary">Button</twig:Button>
        <twig:Button variant="tertiary">Group</twig:Button>
    </twig:ButtonGroup>
    <twig:ButtonGroup>
        <twig:Button variant="tertiary" size="lg">Large</twig:Button>
        <twig:Button variant="tertiary" size="lg">Button</twig:Button>
        <twig:Button variant="tertiary" size="lg">Group</twig:Button>
    </twig:ButtonGroup>
</div>
```

## API Reference

::: api-reference
