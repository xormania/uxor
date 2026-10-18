# Breadcrumb

A trail of links showing where the current page sits in the site hierarchy.

```twig {"preview":true}
<twig:Breadcrumb>
    <twig:Breadcrumb:Item href="#">
        <twig:ux:icon name="flowbite:home-solid" class="size-4" aria-hidden="true" />
        Home
    </twig:Breadcrumb:Item>
    <twig:Breadcrumb:Item href="#">Projects</twig:Breadcrumb:Item>
    <twig:Breadcrumb:Item>[Project name]</twig:Breadcrumb:Item>
</twig:Breadcrumb>
```

## Installation

::: installation

## Usage

```twig
<twig:Breadcrumb label="Breadcrumb">
    <twig:Breadcrumb:Item href="{{ path('app_home') }}">Home</twig:Breadcrumb:Item>
    <twig:Breadcrumb:Item>Current page</twig:Breadcrumb:Item>
</twig:Breadcrumb>
```

An item without `href` is the current page (`aria-current="page"`). Separators are drawn by the items, so the trail can wrap.
