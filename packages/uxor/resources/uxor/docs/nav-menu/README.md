# Nav menu

The navbar's menu: links and buttons opening submenus of links, nested at any depth, as a disclosure navigation; the current page and its submenus are marked, and the same menu opens in place in a mobile nav's drawer.

```twig {"preview":true}
<div class="h-72 w-full">
    <twig:Navbar navLabel="Product" class="w-full rounded-base border">
        <twig:block name="brand"><a href="#" class="text-lg font-semibold text-heading">[Product name]</a></twig:block>
        <twig:block name="nav">
            <twig:NavMenu id="nav-menu-preview">
                <twig:NavMenu:Link href="#overview">Overview</twig:NavMenu:Link>
                <twig:NavMenu:Submenu label="Guides">
                    <twig:NavMenu:Link href="#installation">Installation</twig:NavMenu:Link>
                    <twig:NavMenu:Submenu label="Forms">
                        <twig:NavMenu:Link href="#fields" :active="true">Fields</twig:NavMenu:Link>
                        <twig:NavMenu:Link href="#validation">Validation</twig:NavMenu:Link>
                    </twig:NavMenu:Submenu>
                </twig:NavMenu:Submenu>
                <twig:NavMenu:Submenu label="Reference">
                    <twig:NavMenu:Link href="#components">Components</twig:NavMenu:Link>
                    <twig:NavMenu:Link href="#controllers">Controllers</twig:NavMenu:Link>
                </twig:NavMenu:Submenu>
            </twig:NavMenu>
        </twig:block>
    </twig:Navbar>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:Navbar>
    <twig:block name="brand">…</twig:block>
    <twig:block name="nav">
        <twig:NavMenu id="site-nav">
            <twig:NavMenu:Link href="{{ path('app_pricing') }}" route="app_pricing">Pricing</twig:NavMenu:Link>
            <twig:NavMenu:Submenu label="Products">
                <twig:NavMenu:Link href="{{ path('app_products') }}" route="app_products">All products</twig:NavMenu:Link>
                <twig:NavMenu:Submenu label="Integrations">
                    <twig:NavMenu:Link href="{{ path('app_integration', {name: 'slack'}) }}">Slack</twig:NavMenu:Link>
                </twig:NavMenu:Submenu>
            </twig:NavMenu:Submenu>
        </twig:NavMenu>
    </twig:block>
</twig:Navbar>
```

- **Structure:** `NavMenu` is the list, `NavMenu:Link` a link and `NavMenu:Submenu` a button (`label`) opening a list of
  links and submenus, nested as deep as needed. It follows the WAI-ARIA disclosure navigation pattern, not the menu
  pattern: plain buttons with `aria-expanded` and `aria-controls`, and lists of links that Tab walks through. The
  menu is not a landmark: the `Navbar`'s `nav` block wraps it in a `<nav>` named by `navLabel`; elsewhere, put it in a
  `<nav>` with a name.
- **Ids:** each submenu's id is the `NavMenu`'s `id`, then the `name` of each submenu down to it (by default its
  label, lower-cased, spaces as `-`): `site-nav-products-integrations`. Give each `NavMenu` of a page its own `id`,
  and a submenu whose label is the same as a sibling's (or changes, as a count) a `name`.
- **Current page:** on every connect, Turbo visits included, the controller marks the link whose URL has the current
  path (`aria-current="page"`); a link to a fragment of the page (`#…`) is never marked. `route` also marks it on the
  server. `:active` forces the state and turns the URL matching off for the whole menu, so do not use it in a
  `data-turbo-permanent` navbar. The buttons of the submenus around the current page are highlighted.
- **Opening and closing:** a click, Enter or Space on a button opens or closes its submenu, and opening one closes
  the others (its own parents excepted). Escape closes the innermost open submenu holding the focus and gives the
  focus back to its button. A click outside, the focus leaving the menu, and a link inside followed in the same tab
  close them all. There are no arrow keys: Tab and Shift+Tab move through the buttons and the links shown.
- **Placement:** horizontal, a submenu opens under its button, and a nested one beside its parent, placed by the
  CSS next to their item, so they follow the bar on scroll and resize. One that would leave the viewport opens
  towards the other side (`data-flip`; a nested one near the bottom of the screen opens upwards, `data-flip-y`).
- **Turbo:** the submenus close before Turbo caches the page, so Back and Forward never show one open, and every
  visit renders them closed. The menu works on every page or inside a `data-turbo-permanent` navbar, which needs an
  `id`; it marks the current page again after each visit.
- **Small screens:** the `Navbar` shows its `nav` block from Tailwind's `md` breakpoint up. Below, render the same
  items in a [`MobileNav`](../mobile-nav/README.md), in a vertical `NavMenu` with another `id` (below); the `layouts`
  app layout does both from its `navbar_nav` block.
- **Motion:** a submenu's chevron turns with a transform transition, which stops under `prefers-reduced-motion`.

### In a mobile nav

```twig {"preview":true}
<div class="h-96 w-full max-w-xs rounded-base border border-default p-2">
    <twig:NavMenu id="nav-menu-vertical-preview" orientation="vertical">
        <twig:NavMenu:Link href="#overview">Overview</twig:NavMenu:Link>
        <twig:NavMenu:Submenu label="Guides">
            <twig:NavMenu:Link href="#installation">Installation</twig:NavMenu:Link>
            <twig:NavMenu:Submenu label="Forms">
                <twig:NavMenu:Link href="#fields" :active="true">Fields</twig:NavMenu:Link>
            </twig:NavMenu:Submenu>
        </twig:NavMenu:Submenu>
        <twig:NavMenu:Submenu label="Reference">
            <twig:NavMenu:Link href="#components">Components</twig:NavMenu:Link>
        </twig:NavMenu:Submenu>
    </twig:NavMenu>
</div>
```

Vertical, the submenus open in place, indented under their button, and the same keys and closing rules apply; in a
drawer, Escape first closes the submenu holding the focus, then the drawer. Render the items once in a template of
their own and include them in both menus, each `NavMenu` with its own `id`, so no id is used twice:

```twig
<twig:Navbar>
    <twig:block name="menu">
        <twig:MobileNav>
            <twig:block name="header">…brand…</twig:block>
            <twig:NavMenu id="site-nav-mobile" orientation="vertical">{{ include('_site_nav.html.twig') }}</twig:NavMenu>
        </twig:MobileNav>
    </twig:block>
    <twig:block name="nav">
        <twig:NavMenu id="site-nav">{{ include('_site_nav.html.twig') }}</twig:NavMenu>
    </twig:block>
</twig:Navbar>
```

Marking the current link, giving the links their rendered `aria-current` back on disconnect and telling a link this
tab follows are the `navigation` recipe's module (`assets/lib/uxor-navigation.js`), which `ux:install
nav-menu` installs with it.
