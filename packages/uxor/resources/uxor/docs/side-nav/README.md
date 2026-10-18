# Side nav

A multi-level navigation tree: links grouped in branches that open and close, at any depth, with the keyboard of a tree view; the open branches hold across Turbo visits, and the branch of the current page opens.

```twig {"preview":true}
<nav aria-label="Documentation" class="w-full max-w-xs p-2">
    <twig:SideNav label="Documentation" storageKey="side-nav-preview">
        <twig:SideNav:Item href="#overview">
            <twig:block name="icon"><twig:ux:icon name="flowbite:chart-pie-outline" class="size-5" /></twig:block>
            Overview
        </twig:SideNav:Item>
        <twig:SideNav:Branch label="Guides">
            <twig:block name="icon"><twig:ux:icon name="flowbite:file-code-outline" class="size-5" /></twig:block>
            <twig:SideNav:Item href="#installation">Installation</twig:SideNav:Item>
            <twig:SideNav:Branch label="Forms">
                <twig:SideNav:Item href="#fields" :active="true">Fields</twig:SideNav:Item>
                <twig:SideNav:Item href="#validation">Validation</twig:SideNav:Item>
            </twig:SideNav:Branch>
        </twig:SideNav:Branch>
        <twig:SideNav:Branch label="Reference">
            <twig:block name="icon"><twig:ux:icon name="flowbite:list-outline" class="size-5" /></twig:block>
            <twig:SideNav:Item href="#components">Components</twig:SideNav:Item>
            <twig:SideNav:Item href="#controllers">Controllers</twig:SideNav:Item>
        </twig:SideNav:Branch>
    </twig:SideNav>
</nav>
```

## Installation

::: installation

## Usage

```twig
<nav aria-label="Main">
    <twig:SideNav label="Main" storageKey="main-nav">
        <twig:SideNav:Item href="{{ path('app_dashboard') }}" route="app_dashboard">
            <twig:block name="icon"><twig:ux:icon name="flowbite:chart-pie-outline" class="size-5" /></twig:block>
            Dashboard
        </twig:SideNav:Item>
        <twig:SideNav:Branch label="Orders">
            <twig:block name="icon"><twig:ux:icon name="flowbite:cart-outline" class="size-5" /></twig:block>
            <twig:SideNav:Item href="{{ path('app_orders') }}" route="app_orders">All orders</twig:SideNav:Item>
            <twig:SideNav:Branch label="Returns">
                <twig:SideNav:Item href="{{ path('app_returns_open') }}" route="app_returns_open">Open</twig:SideNav:Item>
            </twig:SideNav:Branch>
        </twig:SideNav:Branch>
    </twig:SideNav>
</nav>
```

- **Structure:** `SideNav` is the tree (`role="tree"`), `SideNav:Item` a link and `SideNav:Branch` a labelled branch
  holding items and branches, nested as deep as needed. The tree is not a landmark: put it in a `<nav>` with a
  name, or in a `Sidebar`, which is one.
- **Current page:** on every connect, Turbo visits included, the controller marks the item whose link has the current
  URL's path (`aria-current="page"`); a link to a fragment of the page (`#…`) is never marked. `route` also marks it
  on the server, and its branches then render open, so a full page load shows them open from the first paint.
  `:active` forces the state and turns the URL matching off for the whole tree, so do not use it in a
  `data-turbo-permanent` tree: Turbo keeps the first page's tree, and its forced state with it.
- **Open branches:** a branch renders closed, or open with `open` or when it holds the current page. The controller
  saves which branches are open in `sessionStorage`, under `storageKey`, and restores them on every connect: the
  state holds across Turbo visits, Back and Forward, and reloads in the same tab. Then it opens the branches holding
  the current page. Give each tree of the app its own `storageKey`, or `:storageKey="null"` to save nothing. The
  same tree rendered twice, in the `Sidebar` and in a `MobileNav`, takes the same key: a tree hidden then shown again
  restores the state saved meanwhile, so the two agree. A
  branch is saved under its place in the tree, from the labels of its branches: give `name` to a branch whose label
  changes (a count, a translation).
- **Keyboard:** the tree is one Tab stop, on the current page's item when it is shown. Up and Down move between the
  shown items; Right opens a branch, then moves into it; Left closes a branch, then moves to its parent; Home and End
  go to the first and last item; typing letters moves to the next item starting with them. Enter or Space follows a
  link, or opens or closes a branch. A click on a branch's row opens or closes it.
- **Turbo:** the tree works on every page or inside a `data-turbo-permanent` element; such an element needs an `id`.
- **Motion:** a branch's chevron turns with a transform transition, which stops under `prefers-reduced-motion`.

### In a sidebar

```twig
<twig:Sidebar id="sidebar" data-turbo-permanent>
    <twig:block name="header">…brand…</twig:block>
    <twig:SideNav label="Main" storageKey="main-nav">
        …
    </twig:SideNav>
</twig:Sidebar>
```

The sidebar's `<nav>` names the tree's landmark. Collapsed to its icons, the sidebar shows the top level's icons only:
give each top-level item and branch an icon. On small screens, the `Navbar` menu button opens the sidebar over the
page, tree included; or render the same tree, with the same `storageKey`, in a
[`MobileNav`](../mobile-nav/README.md), a modal drawer, as the `layouts` app layout does.

Marking the current item is the `navigation` recipe's module (`assets/lib/uxor-navigation.js`), which
`ux:install side-nav` installs with it.
