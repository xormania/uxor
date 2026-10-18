# Mobile nav

The app's navigation on small screens: a menu button in the navbar opening a modal drawer that holds the side nav, closed by a link, Escape, the backdrop and every Turbo visit.

```twig {"preview":true}
<div class="h-96">
    <twig:MobileNav id="mobile-nav-preview" open>
        <twig:block name="header"><span class="text-lg font-semibold text-heading">[Product name]</span></twig:block>
        <twig:SideNav label="Pages" storageKey="mobile-nav-preview">
            <twig:SideNav:Item href="#dashboard" :active="true">
                <twig:block name="icon"><twig:ux:icon name="flowbite:chart-pie-outline" class="size-5" /></twig:block>
                Dashboard
            </twig:SideNav:Item>
            <twig:SideNav:Branch label="Orders" open>
                <twig:block name="icon"><twig:ux:icon name="flowbite:cart-outline" class="size-5" /></twig:block>
                <twig:SideNav:Item href="#orders">All orders</twig:SideNav:Item>
                <twig:SideNav:Item href="#returns">Returns</twig:SideNav:Item>
            </twig:SideNav:Branch>
            <twig:SideNav:Item href="#profile">
                <twig:block name="icon"><twig:ux:icon name="flowbite:user-outline" class="size-5" /></twig:block>
                Profile
            </twig:SideNav:Item>
        </twig:SideNav>
    </twig:MobileNav>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:Navbar>
    <twig:block name="menu">
        <twig:MobileNav label="Main" menuLabel="Open menu">
            <twig:block name="header">…brand…</twig:block>
            <twig:SideNav label="Main" storageKey="main-nav">
                …
            </twig:SideNav>
        </twig:MobileNav>
    </twig:block>
    <twig:block name="brand">…</twig:block>
</twig:Navbar>
```

- **What it is:** a `Drawer` (a native modal `<dialog>`, docked left) and its menu button, in the `Navbar`'s `menu`
  block. The button has `aria-controls`, `aria-haspopup="dialog"` and `aria-expanded`, named by `menuLabel`; the
  drawer is named by `label`, and so is the `<nav>` inside it. Put a `SideNav` in it, a vertical [`NavMenu`](../nav-menu/README.md) (the navbar's menu), or the `Sidebar:Group`s of a
  `Sidebar`; `header` shows above it, typically the brand. A `SideNav` marks the current page from the URL wherever
  it is; a `Sidebar:Item` is marked in the drawer only by its `route` (the `Sidebar`'s controller marks the rest).
- **Small screens only:** the button is hidden from Tailwind's `md` breakpoint up, where the app layout shows the
  `Sidebar`; a drawer still open when the screen grows to that width closes. In your copy, change both `md:hidden`
  on the button and the controller's `media` value (`(min-width: 48rem)`) to move it.
- **Focus:** opening moves the focus to the current page's link (`aria-current="page"`), or to the navigation's
  first one; the drawer traps it, and closing gives it back to the menu button.
- **Closing:** Escape, a click on the backdrop, the close button, a link inside followed in the same tab (not one
  opened in another tab or window by a modifier key or a `target`, nor a `download`), and the screen growing past `md`.
- **Turbo:** the drawer closes before Turbo caches the page, so Back and Forward never show it open, and a visit
  renders the next page's own closed drawer. A `SideNav` inside keeps its open branches in `sessionStorage` and marks
  the current page on every visit, as it does in the `Sidebar`.
- **The same navigation in the sidebar:** render the same tree in both, with the same `storageKey`: the two trees
  then show the same open branches, as only one of them is on screen at a time (a tree shown again re-reads the
  saved state). The drawer's ids come from its `id` (`drawer-mobile-nav`, `drawer-mobile-nav-title`), apart from the
  sidebar's: give the content no fixed `id` of its own, since it renders twice.
- `:open="true"` opens the drawer on the first render.

### In the app layout

The `layouts` recipe's `app.html.twig` does this already: its navbar holds a `MobileNav` with the `brand` and
`sidebar` blocks, the same ones the `Sidebar` shows on wide screens.

Telling a link this tab follows and closing the drawer when the screen grows are the `navigation` recipe's module
(`assets/lib/uxor-navigation.js`), which `ux:install mobile-nav` installs with it.
