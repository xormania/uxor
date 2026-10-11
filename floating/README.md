# Floating

The positioning that `dropdown`, `popover` (and so `date-picker`) and `tooltip` share: one JavaScript module placing a floating element next to the element it belongs to, flipping it and keeping it in the viewport.

## Installation

::: installation

## Usage

Those recipes install it with them: install it yourself only to place an element of your own the same way. The
recipe copies `assets/lib/uxor-floating.js`, a module with no dependency that a Stimulus controller imports
by its relative path:

```js
import { Controller } from '@hotwired/stimulus';
import { follow, position } from '../lib/uxor-floating.js';

export default class extends Controller {
    static targets = ['trigger', 'panel'];

    open() {
        this.panelTarget.hidden = false;
        this.place();
        // repositions on every scroll and resize until stopFollowing() is called
        this.stopFollowing = follow(() => this.place());
    }

    close() {
        this.panelTarget.hidden = true;
        this.stopFollowing?.();
        this.stopFollowing = null;
    }

    disconnect() {
        this.stopFollowing?.();
    }

    place() {
        this.panelTarget.dataset.placement = position(this.panelTarget, this.triggerTarget, { placement: 'bottom-start', offset: 8 });
    }
}
```

It exports:

- `position(floating, reference, { placement, offset })` places `floating` next to `reference` the way Popper does
  for Flowbite, so the element lands on the same pixels as Flowbite's own: `position: absolute`, then
  `transform: translate(x, y)` in the coordinates of its containing block, rounded to device pixels. `placement` is
  `top`, `bottom`, `left` or `right`, optionally with `-start` or `-end` (`bottom` when empty); `offset` is the gap in
  pixels. The element flips to the opposite side when it overflows the viewport on its side and fits on the other,
  then shifts along the reference to stay in the viewport, never leaving the reference. It returns the placement
  used, the side after the flip: write it where your CSS reads it (`Dropdown` writes `data-popper-placement`,
  `Popover` `data-placement`).
- `follow(reposition)` calls `reposition` on every scroll, of the page or of any scrolling element (a capture
  listener on `window`), and on every resize; it returns the function that removes both listeners. Follow only while
  the element is open, and stop when it closes and in `disconnect()`.
- `place(reference, size, { side, align, offset, viewport })` is the placement and flip alone, in viewport
  coordinates (`{ side, x, y }`), for an element placed another way: `Tooltip` places its tooltip with it, relative
  to its wrapper with `top` and `left`, and keeps it inside the viewport on both axes.
- `viewportSize()` is the viewport without its scrollbars, as the others measure it.

The module writes only `element.style` (the CSSOM), never a `style` attribute in markup: a Content Security Policy
without `'unsafe-inline'` in `style-src` allows it.
