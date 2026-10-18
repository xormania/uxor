# Turbo

What the kit's controllers ask about Turbo's copies of a page, answered in one JavaScript module: whether a `turbo:before-cache` leaves the page on screen, whether an element is permanent, and whether a controller connects in a cached copy.

## Installation

::: installation

## Usage

The recipes that reset their state before Turbo caches a page, or clean up a cached copy as it connects, install it
with them: `popover` (so `date-picker`), `dropdown`, `modal`, `drawer`, `toast`, `data-table`, `data-table-live`,
`dropzone` and `layouts` (`form-reset`). Install it yourself only for a controller of your own. The recipe copies
`assets/lib/uxor-turbo.js`, a module with no dependency that a Stimulus controller imports by its relative
path:

```js
import { Controller } from '@hotwired/stimulus';
import { isCachedCopy, isKeptOnCache } from '../lib/uxor-turbo.js';

export default class extends Controller {
    connect() {
        // a copy of the page Turbo cached while the panel was open: shown closed
        if (isCachedCopy(this, 'data-panel-opened')) {
            this.close();
        }
    }

    // data-action="turbo:before-cache@document->panel#closeBeforeCache"
    closeBeforeCache() {
        // the page stays on screen, or Turbo moves the panel into the next page: leave it as the user sees it
        if (!isKeptOnCache(this.element)) {
            this.close();
        }
    }

    open() {
        this.element.setAttribute('data-panel-opened', '');
        // …
    }

    close() {
        this.element.removeAttribute('data-panel-opened');
        // …
    }
}
```

It exports:

- `isPromotedFrameCache()`: whether the current `turbo:before-cache` comes from a frame visit promoted to history
  (`data-turbo-action="advance"`, a data table's pages). Turbo then keeps the page on screen and caches the copy it
  took when the frame visit started, so a reset now only changes what the user sees: skip it, and reset what Back
  must not show when the copy connects. False without Turbo.
- `isPermanent(element)`: whether the element is inside a `data-turbo-permanent` element, or is one. Turbo moves it
  into the next page as it is, so the copy shown on Back does not hold it. It reads through
  `Element.prototype.closest`, so a form with a field named `closest` works too.
- `isKeptOnCache(element)`: either of the two, the usual reason for a controller to skip its reset on
  `turbo:before-cache`.
- `isCachedCopy(controller, mark)`: whether the controller's element is part of a copy of the page Turbo cached: on
  this controller's first connect, the element already carries `mark`, an attribute a controller sets while the state
  the copy must not show is on screen. A copy holds clones, which keep attributes and get new controllers; the same
  element connecting again (moved in the DOM, a morph, a permanent element kept by a visit) keeps its controller, so a
  later call answers false. Call it once in each `connect()`.

A controller listens to `turbo:before-cache` with a Stimulus action on the document, or adds and removes its own
listener in `connect()` and `disconnect()`; the module adds no listener.
