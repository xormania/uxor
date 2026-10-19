# Navbar

The bar on top of the app: brand, navigation menu, search, actions, and the menu button opening the sidebar or a mobile nav on small screens.

```twig {"preview":true}
<twig:Navbar sidebarId="sidebar-preview" class="w-full rounded-base border">
    <twig:block name="brand"><a href="#" class="text-lg font-semibold text-heading">[Product name]</a></twig:block>
    <twig:block name="search">
        <twig:Input type="search" placeholder="Search" aria-label="Search" class="max-w-xs" />
    </twig:block>
    <twig:block name="actions">
        <twig:Button variant="outline" size="sm">Sign in</twig:Button>
    </twig:block>
</twig:Navbar>
```

## Installation

::: installation

## Usage

```twig
<twig:Navbar sidebarId="sidebar">
    <twig:block name="brand">…</twig:block>
    <twig:block name="nav"><twig:NavMenu id="site-nav">…</twig:NavMenu></twig:block>
    <twig:block name="search">…</twig:block>
    <twig:block name="actions"><twig:ThemeToggle /></twig:block>
</twig:Navbar>
```

The `nav` block, after the brand, holds the site's navigation, typically a [`NavMenu`](../nav-menu/README.md) with
its submenus. The bar wraps it in a `<nav>` named by `navLabel` (`Site` by default) and shows it from Tailwind's `md`
breakpoint up; on smaller screens, render the same menu in a `MobileNav` (below).

On a phone (below Tailwind's `sm` breakpoint) the `search` block takes a row of its own under the brand and the
actions, so the field stays wide enough to type in; a brand too long for the bar wraps to a second line. The actions
always stay inside the bar, on its right.

With `sidebarId`, a menu button (small screens only) opens that `Sidebar` over the page. For a modal drawer holding the
navigation instead, put a [`MobileNav`](../mobile-nav/README.md) in the `menu` block, at the start of the bar, and
leave `sidebarId` out:

```twig
<twig:Navbar>
    <twig:block name="menu"><twig:MobileNav>…</twig:MobileNav></twig:block>
    <twig:block name="brand">…</twig:block>
</twig:Navbar>
```
