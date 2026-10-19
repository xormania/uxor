# Navigation

What the kit's navigation controllers share, in one JavaScript module: marking the current page's link, telling whether a click on a link navigates this tab, and closing a navigation opened over the page once the screen grows.

## Installation

::: installation

## Usage

`nav-menu`, `sidebar`, `side-nav`, `section-nav` and `mobile-nav` install it with them: install it yourself only
for a navigation of your own. The recipe copies `assets/lib/uxor-navigation.js`, a module with no dependency
that a Stimulus controller imports by its relative path:

```js
import { Controller } from '@hotwired/stimulus';
import { followsInThisTab, markCurrentLinks, rememberCurrent, whenMediaMatches } from '../lib/uxor-navigation.js';

export default class extends Controller {
    static targets = ['link'];

    connect() {
        this.restoreCurrent = rememberCurrent(this.linkTargets);
        markCurrentLinks(this.linkTargets);
        this.stopClosingWhenWide = whenMediaMatches('(min-width: 48rem)', () => this.close());
    }

    disconnect() {
        this.restoreCurrent();
        this.stopClosingWhenWide();
    }

    // data-action="click->menu#closeOnLink"
    closeOnLink(event) {
        const link = event.target.closest('a[href]');
        if (link && this.element.contains(link) && !event.defaultPrevented && followsInThisTab(event, link)) {
            this.close();
        }
    }

    close() {
        // …
    }
}
```

It exports:

- `markCurrentLinks(links)` sets `aria-current="page"` on each link whose path is the current URL's path, and removes
  it from the others. A link to a fragment of the page (`#…`, what the kit's link parts render for a rejected URL) is
  never the current page. Call it on every connect: the URL changes under a `data-turbo-permanent` element and under
  the copy of a page Turbo cached.
- `rememberCurrent(links)` remembers each link's `aria-current` as it is now (as rendered) and returns the function
  that gives it back: call that on disconnect, so a controller removed from an element that stays leaves the links as
  they were rendered.
- `followsInThisTab(event, link)` is whether a click on the link navigates this tab: not a click with a modifier key
  or another button, not a `target` naming another tab or window, not a `download`. Whether the link is yours and the
  click was not cancelled is for the caller to check.
- `whenMediaMatches(query, callback)` calls `callback` each time the media query starts to match (not for how it
  matches when called) and returns the function that stops listening, for `disconnect()`: a navigation opened over the
  page on small screens closes once the screen is wide enough to show it beside the page.
