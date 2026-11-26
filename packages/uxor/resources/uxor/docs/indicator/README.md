# Indicator

Use the indicator component to show a number count, account status, or as a loading label positioned relative to the parent component coded with Tailwind CSS

```twig {"preview":true}
<div class="flex justify-center gap-4">
    <twig:Indicator variant="brand" />
    <twig:Indicator variant="gray" />
    <twig:Indicator variant="danger" />
    <twig:Indicator variant="success" />
    <twig:Indicator variant="warning" />
</div>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=indicator#recipes). To install `indicator` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component indicator --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

```twig
<twig:Indicator
    variant="brand | gray | danger | success | warning"
>
    Value
</twig:Indicator>
```

## Examples

### Count indicator

This example can be used to show a number count inside the indicator and position it relative to a button component.

For this example, install the [button](../button/README.md) recipe and run `composer require symfony/ux-icons`.

```twig {"preview":true}
<twig:Button class="relative">
    <twig:ux:icon name="flowbite:inbox-full-outline" class="size-4 me-1.5 -ms-0.5" aria-hidden="true" />
    <span class="sr-only">Notifications</span>
    Messages
    <twig:Indicator variant="danger" size="lg" class="absolute -top-2 -end-2 border-2 border-buffer">8</twig:Indicator>
</twig:Button>
```

## API Reference

::: api-reference
