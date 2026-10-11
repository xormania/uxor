import { Controller } from '@hotwired/stimulus';
import { follow, position } from '../lib/uxor-floating.js';
import { isCachedCopy, isKeptOnCache } from '../lib/uxor-turbo.js';

/**
 * Opens a `Popover`, a non-modal dialog anchored to its trigger: a click on the trigger toggles it,
 * Escape closes it and returns the focus to the trigger, and a click outside or the focus leaving it
 * closes it. Opening moves the focus into the content, places the content next to the trigger (flipping
 * and shifting like `Dropdown`) and keeps it there on scroll and resize. Popovers sharing a `name` close
 * each other. The open state is the `open` value, an attribute, so Live Components keep it across
 * re-renders. Before Turbo caches the page, an open popover closes, so Back never restores it open; one inside a
 * `data-turbo-permanent` element stays open, as Turbo moves it into the next page (a copy of it shown later is
 * closed as it connects). A frame visit promoted to history (`data-turbo-action="advance"`, a data table's pages) dispatches
 * `turbo:before-cache` too, but keeps the page on screen and caches a copy taken when it started: the
 * popover then stays open, with the focus, and the copy is closed as it connects (while it is open on
 * screen, rendered open or opened since, the element carries `data-popover-opened`; a new controller on
 * an element carrying it is a copy, while the same controller reconnecting after a DOM move stays open).
 * The document listeners exist only while it is open, and are removed when it closes or disconnects.
 * Before moving the focus, it dispatches a cancelable `popover:focus` on its element (detail: `content`):
 * cancel it to place the focus yourself; the popover stays open.
 *
 * @target trigger        The button opening the popover.
 * @target content        The dialog, positioned next to the trigger.
 * @value  open           Whether the popover is open.
 * @value  name           A group name: opening a popover closes the open ones of the same group.
 * @value  placement      Where the content opens: `top`, `bottom`, `left`, `right`, optionally with `-start` or `-end`.
 * @value  offsetDistance The gap between the trigger and the content, in pixels.
 * @action toggle         Opens the popover, or closes it.
 * @action show           Opens the popover.
 * @action close          Closes the popover without moving the focus.
 * @action closeIfGrouped Closes the popover when another popover of its group opens.
 * @action escape         Closes the popover and focuses the trigger.
 * @action closeOnFocusOut Closes the popover when the focus moves to an element outside it.
 * @action closeSilently  Closes the popover without moving the focus or dispatching events; on `turbo:before-cache`, only when the page is about to be replaced and the popover is not inside a `data-turbo-permanent` element.
 */
export default class extends Controller {
    static targets = ['trigger', 'content'];
    static values = {
        open: Boolean,
        name: String,
        placement: { type: String, default: 'bottom' },
        offsetDistance: { type: Number, default: 8 },
    };

    #connected = false;
    #listening = false;

    connect() {
        this.#connected = true;
        // open in this browser before, but not by this controller: a copy of the page Turbo cached, shown closed. A
        // reconnect of the same element (moved in the DOM, a morph) keeps its controller, and stays open
        if (isCachedCopy(this, 'data-popover-opened')) {
            this.openValue = false;
        }
        this.#render();
    }

    disconnect() {
        this.#connected = false;
        this.#unlisten();
    }

    openValueChanged(open, previous) {
        if (!this.#connected) {
            return;
        }
        this.#render();
        // the first call (on connect) only renders: a popover open on render takes no focus and closes no other
        if (!open || undefined === previous) {
            return;
        }
        if (this.nameValue) {
            window.dispatchEvent(new CustomEvent('popover:open', { detail: { name: this.nameValue, source: this.element } }));
        }
        const content = this.contentTarget;
        // `popover:focus`, cancelable: a controller placing the focus itself (a date picker on its day) cancels it
        if (this.dispatch('focus', { detail: { content }, cancelable: true }).defaultPrevented) {
            return;
        }
        // the first control actually rendered: a hidden one (or one in a hidden part) cannot take the focus
        const first = (selector) => [...content.querySelectorAll(selector)].find((element) => element.getClientRects().length > 0);
        const focusable =
            first('[autofocus]:not([disabled])') ??
            first('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
        (focusable ?? content).focus();
    }

    toggle(event) {
        event?.preventDefault();
        this.openValue = !this.openValue;
    }

    show() {
        this.openValue = true;
    }

    close() {
        this.openValue = false;
    }

    closeIfGrouped(event) {
        if (this.openValue && this.nameValue && event.detail?.name === this.nameValue && event.detail.source !== this.element) {
            this.openValue = false;
        }
    }

    escape(event) {
        if (!this.openValue) {
            return;
        }
        event.preventDefault();
        // an Escape inside a nested popover closes that one only
        event.stopPropagation();
        this.openValue = false;
        this.hasTriggerTarget && this.triggerTarget.focus();
    }

    closeOnFocusOut(event) {
        // no related target: the window lost the focus, or a click on nothing focusable (the outside click handles it)
        if (this.openValue && event.relatedTarget && !this.element.contains(event.relatedTarget)) {
            this.openValue = false;
        }
    }

    closeSilently(event) {
        // the page stays on screen; or Turbo moves the popover into the next page, open, as the user left it
        if ('turbo:before-cache' === event?.type && isKeptOnCache(this.element)) {
            return;
        }
        this.openValue = false;
    }

    #render() {
        const open = this.openValue;
        const state = open ? 'open' : 'closed';
        this.element.dataset.state = state;
        for (const trigger of this.triggerTargets) {
            trigger.setAttribute('aria-expanded', String(open));
        }
        if (!this.hasContentTarget) {
            return;
        }
        const content = this.contentTarget;
        content.dataset.state = state;
        content.hidden = !open;
        // open on screen, whether rendered open or opened since: a copy of the page taken now connects closed
        this.element.toggleAttribute('data-popover-opened', open);
        if (open) {
            this.#listen();
            this.position();
        } else {
            this.#unlisten();
        }
    }

    #listen() {
        if (this.#listening) {
            return;
        }
        this.#listening = true;
        this.onClickOutside = (event) => {
            if (!this.element.contains(event.target)) {
                this.openValue = false;
            }
        };
        document.addEventListener('click', this.onClickOutside, true);
        this.stopFollowing = follow(() => this.position());
    }

    #unlisten() {
        if (!this.#listening) {
            return;
        }
        this.#listening = false;
        document.removeEventListener('click', this.onClickOutside, true);
        this.stopFollowing();
        this.stopFollowing = null;
    }

    /**
     * Places the content next to the trigger with the kit's shared positioning (`assets/lib/uxor-floating.js`,
     * the `floating` recipe, as `Dropdown`), with `data-placement` for the final side: absolute, `translate(x, y)`,
     * offset, flip, shift along the trigger within the viewport.
     */
    position() {
        if (!this.hasTriggerTarget || !this.hasContentTarget) {
            return;
        }
        this.contentTarget.dataset.placement = position(this.contentTarget, this.triggerTarget, {
            placement: this.placementValue,
            offset: this.offsetDistanceValue,
        });
    }
}
