# Page Header

The top of a page: its title, a short description and the page's actions.

For this example, install the [button](../button/README.md) recipe.

```twig {"preview":true}
<twig:PageHeader title="Orders" description="Every order placed in the last 30 days." class="w-full">
    <twig:block name="actions">
        <twig:Button variant="outline">Export</twig:Button>
        <twig:Button>New order</twig:Button>
    </twig:block>
</twig:PageHeader>
```

## Installation

::: installation

[Find this recipe in the latest published catalog](https://xormania.github.io/uxor/?recipe=page-header#recipes). To install `page-header` from this revision, follow the [kit installation guide](../INSTALL.md#choosing-a-revision). With the Composer dev package, `vendor/bin/uxor component page-header --format=json` reads the bundled recipe manifest offline. <!-- recipe-source-note -->

## Usage

For this example, install the [breadcrumb](../breadcrumb/README.md) recipe.

```twig
<twig:PageHeader title="Page title" description="Optional description">
    <twig:block name="before"><twig:Breadcrumb>…</twig:Breadcrumb></twig:block>
    <twig:block name="actions">…</twig:block>
</twig:PageHeader>
```

The `layouts` recipe's `app.html.twig` renders a `PageHeader` from its `page_title`, `page_description`, `page_before` and `page_actions` blocks: pages that extend it fill those blocks instead.
