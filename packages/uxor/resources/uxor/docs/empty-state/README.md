# Empty State

What a list or page shows when it has nothing yet, with a way forward.

```twig {"preview":true}
<twig:EmptyState title="No orders yet" description="Orders appear here as soon as a customer checks out." class="w-full max-w-md rounded-base border border-dashed border-default-medium">
    <twig:block name="actions">
        <twig:Button>Create an order</twig:Button>
    </twig:block>
</twig:EmptyState>
```

## Installation

::: installation

## Usage

```twig
<twig:EmptyState title="Nothing here" description="Optional hint">
    <twig:block name="icon"><twig:ux:icon name="flowbite:inbox-outline" class="size-6" aria-hidden="true" /></twig:block>
    <twig:block name="actions">…</twig:block>
</twig:EmptyState>
```
