# Label

A text element that identifies form controls and other content.

For this example, install the [input](../input/README.md) recipe.

```twig {"preview":true}
<div>
    <twig:Label for="text">Company</twig:Label>
    <twig:Input id="text" type="text" />
</div>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=label#recipes). To install `label` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component label --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

```twig
<twig:Label for="email">Your email address</twig:Label>
```

## API Reference

::: api-reference
