# Drawer

A panel sliding over one side of the page, for navigation, filters or details, as a native `<dialog>`.

```twig {"preview":true}
<div class="min-h-90">
    <twig:Drawer id="filters" open>
        <twig:Drawer:Trigger>
            <twig:Button variant="outline" {{ ...drawer_trigger_attrs }}>Filters</twig:Button>
        </twig:Drawer:Trigger>
        <twig:Drawer:Content>
            <twig:Drawer:Header>
                <twig:Drawer:Title>Filters</twig:Drawer:Title>
            </twig:Drawer:Header>
            <twig:Drawer:Body>
                <p>Narrow the list down by status and date.</p>
                <twig:Drawer:Close>
                    <twig:Button {{ ...drawer_close_attrs }}>Apply</twig:Button>
                </twig:Drawer:Close>
            </twig:Drawer:Body>
        </twig:Drawer:Content>
    </twig:Drawer>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:Drawer id="menu" placement="left | right | top | bottom" :modal="true" :open="false">
    <twig:Drawer:Trigger>
        <twig:Button {{ ...drawer_trigger_attrs }}>Open</twig:Button>
    </twig:Drawer:Trigger>
    <twig:Drawer:Content>
        <twig:Drawer:Header><twig:Drawer:Title>Title</twig:Drawer:Title></twig:Drawer:Header>
        <twig:Drawer:Body>…</twig:Drawer:Body>
    </twig:Drawer:Content>
</twig:Drawer>
```

Spread `drawer_trigger_attrs` on the element that opens the drawer, inside `Drawer:Trigger`, and `drawer_close_attrs` on any element that closes it, inside `Drawer:Close`. `Drawer:Content` also shows a close button in its corner; `:showCloseButton="false"` removes it. The `<dialog>` element's id is `drawer-<id>`.

A modal drawer traps focus and makes the page inert (native `showModal()`); Escape or a click on the backdrop closes it. With `:modal="false"` the page stays usable and Escape still closes the drawer while focus is inside it.

In a Live Component, an open drawer stays open across a re-render. A re-render that replaces the drawer's container (a wrapper whose id changes) moves the `<dialog>` to a new controller: the old one disconnects without an error, and the new one starts as its `open` value says, closed by default, its triggers collapsed and the page not left inert.

Whether a `turbo:before-cache` leaves the drawer open (a frame visit promoted to history, a `data-turbo-permanent`
element) is answered by the `turbo` recipe's module (`assets/lib/uxor-turbo.js`), which `ux:install drawer`
installs with it.
