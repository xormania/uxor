# Empty State

What a list or page shows when it has nothing yet, with a way forward.

For this example, install the [button](../button/README.md) recipe.

```twig {"preview":true}
<twig:EmptyState title="No orders yet" description="Orders appear here as soon as a customer checks out." class="w-full max-w-md rounded-base border border-dashed border-default-medium">
    <twig:block name="actions">
        <twig:Button>Create an order</twig:Button>
    </twig:block>
</twig:EmptyState>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=empty-state#recipes). To install `empty-state` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component empty-state --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

```twig
<twig:EmptyState title="Nothing here" description="Optional hint">
    <twig:block name="icon"><twig:ux:icon name="flowbite:inbox-outline" class="size-6" aria-hidden="true" /></twig:block>
    <twig:block name="actions">…</twig:block>
</twig:EmptyState>
```
