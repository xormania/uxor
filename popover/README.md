# Popover

Free content anchored to a button: text, links or a small form, in a non-modal dialog that opens on click and closes on Escape, a click outside or when the focus leaves it.

```twig {"preview":true}
<div class="flex min-h-72 items-start justify-center pt-6">
    <twig:Popover id="popover-dimensions" open placement="bottom-start">
        <twig:Popover:Trigger>
            <twig:Button variant="outline" {{ ...popover_trigger_attrs }}>Dimensions</twig:Button>
        </twig:Popover:Trigger>
        <twig:Popover:Content class="w-80">
            <div class="grid gap-4">
                <div class="space-y-1">
                    <h4 class="font-medium text-heading">Dimensions</h4>
                    <p class="text-body">Set the dimensions for the layer.</p>
                </div>
                <div class="grid grid-cols-3 items-center gap-3">
                    <twig:Label for="popover-width">Width</twig:Label>
                    <twig:Input type="text" id="popover-width" value="100%" class="col-span-2" />
                    <twig:Label for="popover-height">Height</twig:Label>
                    <twig:Input type="text" id="popover-height" value="25px" class="col-span-2" />
                </div>
            </div>
        </twig:Popover:Content>
    </twig:Popover>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:Popover id="filters" placement="bottom-start">
    <twig:Popover:Trigger>
        <twig:Button variant="outline" {{ ...popover_trigger_attrs }}>Filters</twig:Button>
    </twig:Popover:Trigger>
    <twig:Popover:Content>
        Any content: text, links, a form.
    </twig:Popover:Content>
</twig:Popover>
```

- Spread `popover_trigger_attrs` on the trigger: it makes it a `type="button"` (it does not submit a surrounding
  form), wires the click, and sets `aria-expanded` and `aria-controls`.
- Opening moves the focus to the content's `[autofocus]` element, else its first focusable element, else the content
  itself. Escape closes it and focuses the trigger; a click outside or the focus leaving it closes it.
- `placement` sets the side (`top`, `bottom`, `left`, `right`, optionally `-start` or `-end`). The content flips to the
  other side when it does not fit, shifts along the trigger to stay in the viewport, and follows the trigger on
  scroll and resize; `offsetDistance` is the gap in pixels (8). The final placement is in the content's
  `data-placement`. The placing is the `floating` recipe's module (`assets/lib/uxor-floating.js`), shared with
  `dropdown` and `tooltip`, which `ux:install popover` installs with it.
- Popovers with the same `name` close each other.
- `open` renders it open, without taking the focus.
- `Popover:Content` takes `label` for the dialog's name; without it, the trigger's text names it.
- Before moving the focus, the popover dispatches a cancelable `popover:focus` event: a controller of yours that
  places the focus itself (`data-action="popover:focus->picker#focusDay"`) cancels it, and the popover stays open.

Popover or dropdown: use `dropdown` for a menu of actions (`role="menu"`, arrow keys between items), `popover` for
anything else next to a control.

### With Turbo and Live Components

- The open state is an attribute: a Live Component re-render keeps an open popover open, and an action inside it
  (a button with `data-action="live#action"`) does not close it.
- Before Turbo caches a page, open popovers close: Back shows them closed. One inside a `data-turbo-permanent` element stays open: Turbo moves it into the next page as the user left it. Beside a frame whose visits are promoted to history (a data table's pages), an open popover stays open, with the focus, when the frame changes, and Back still shows it closed.
- Without `id`, the popover gets a random one on every render. Inside a Live Component or a Turbo Frame, pass a stable
  `id` (e.g. `id="row-{{ row.id }}-details"`).

Whether a `turbo:before-cache` leaves the popover as it is (a frame visit promoted to history, a
`data-turbo-permanent` element) and whether it connects in a cached copy are answered by the `turbo` recipe's module
(`assets/lib/uxor-turbo.js`), which `ux:install popover` installs with it.

## Examples

### Placements

```twig {"preview":true}
<div class="flex min-h-72 items-center justify-center gap-4">
    <twig:Popover id="popover-top" name="placements" placement="top">
        <twig:Popover:Trigger>
            <twig:Button variant="outline" size="sm" {{ ...popover_trigger_attrs }}>Top</twig:Button>
        </twig:Popover:Trigger>
        <twig:Popover:Content class="w-48">Above the trigger.</twig:Popover:Content>
    </twig:Popover>
    <twig:Popover id="popover-right" name="placements" placement="right" open>
        <twig:Popover:Trigger>
            <twig:Button variant="outline" size="sm" {{ ...popover_trigger_attrs }}>Right</twig:Button>
        </twig:Popover:Trigger>
        <twig:Popover:Content class="w-48">On the right of the trigger.</twig:Popover:Content>
    </twig:Popover>
</div>
```

### A group

Opening one popover of the group closes the other.

```twig {"preview":true}
<div class="flex min-h-48 items-start justify-center gap-4 pt-6">
    <twig:Popover id="popover-owner" name="details">
        <twig:Popover:Trigger>
            <twig:Button variant="outline" size="sm" {{ ...popover_trigger_attrs }}>Owner</twig:Button>
        </twig:Popover:Trigger>
        <twig:Popover:Content class="w-56">Bonnie Green, since March.</twig:Popover:Content>
    </twig:Popover>
    <twig:Popover id="popover-status" name="details">
        <twig:Popover:Trigger>
            <twig:Button variant="outline" size="sm" {{ ...popover_trigger_attrs }}>Status</twig:Button>
        </twig:Popover:Trigger>
        <twig:Popover:Content class="w-56">Paid on 12 March.</twig:Popover:Content>
    </twig:Popover>
</div>
```

## Accessibility

- The content is a `role="dialog"` named by `label` or by the trigger, and is `hidden` while closed.
- The trigger has `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`.
- The popover is not modal: the page stays reachable, and the focus is not trapped. Use `modal` when the user must
  deal with the content first.

Built from the `popover` recipe of the Symfony UX Toolkit shadcn kit (3.5.1, MIT), with this kit's colors and its
shared positioning (the `floating` recipe).
