# Select

A styled native select for choosing from a list of options. Add `multiple` to allow more than one selection.

```twig {"preview":true}
<form class="w-full max-w-sm">
    <label for="countries" class="mb-2.5 block text-sm font-medium text-heading">Select an option</label>
    <twig:Select id="countries">
        <option selected>Choose a country</option>
        <option value="US">United States</option>
        <option value="CA">Canada</option>
        <option value="FR">France</option>
        <option value="DE">Germany</option>
    </twig:Select>
</form>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=select#recipes). To install `select` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component select --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

```twig
<twig:Select>
    <option value="1">1</option>
    <option value="2">2</option>
    <option value="3">3</option>
</twig:Select>
```

## Examples

### Multiple

Apply the `multiple` attribute to the select component to allow users to select one or more options. It shows as a
list box, without the chevron; give it no placeholder option, which would be a choice like any other.

For this example, install the [label](../label/README.md) recipe.

```twig {"preview":true}
<form class="w-full max-w-sm">
    <twig:Label for="countries" class="mb-2.5">Select an option</twig:Label>
    <twig:Select id="countries" multiple>
        <option value="US">United States</option>
        <option value="CA">Canada</option>
        <option value="FR">France</option>
        <option value="DE">Germany</option>
    </twig:Select>
</form>
```

### Disabled state

Apply the `disabled` attribute to the select component to prevent users from interacting with it.

For this example, install the [label](../label/README.md) recipe.

```twig {"preview":true}
<form class="w-full max-w-sm">
    <twig:Label for="countries" class="mb-2.5">Select an option</twig:Label>
    <twig:Select id="countries" disabled>
        <option selected>Choose a country</option>
        <option value="US">United States</option>
        <option value="CA">Canada</option>
        <option value="FR">France</option>
        <option value="DE">Germany</option>
    </twig:Select>
</form>
```

## API Reference

::: api-reference
