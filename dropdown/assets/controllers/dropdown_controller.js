import { Controller } from '@hotwired/stimulus';
import { follow, position } from '../lib/uxor-floating.js';
import { isKeptOnCache } from '../lib/uxor-turbo.js';

/**
 * Opens a `Dropdown` menu on click or hover, places it next to its trigger and handles the keyboard.
 *
 * It replaces Flowbite's `Dropdown` (and its Popper dependency) with the same behavior: the content
 * toggles `hidden`/`block` and `aria-hidden`, closes on a click outside, follows its trigger on scroll
 * and resize while open, flips to the opposite side when it does not fit, and is shifted back into the
 * viewport along the trigger. Every listener is removed when it closes or disconnects. The menu closes before Turbo
 * caches the page, and a new controller starts closed: a copy of the page Turbo cached while it was open (Back) shows
 * it closed, not open and inert. Inside a `data-turbo-permanent` element it stays open: Turbo moves it into the next
 * page, and the same controller reconnecting (its element moved in the DOM) opens it again as it was. A frame visit promoted to history (`data-turbo-action="advance"`) dispatches
 * `turbo:before-cache` too, but keeps the page on screen and caches a copy taken when it started: the menu then stays
 * open, and the copy is closed as it connects.
 *
 * @target trigger        The button opening the menu.
 * @target content        The menu, positioned next to the trigger.
 * @value  placement      Where the menu opens: `top`, `bottom`, `left`, `right`, optionally with `-start` or `-end`.
 * @value  triggerType    What opens the menu: `click` or `hover`.
 * @value  open           Whether the menu is open when the controller connects.
 * @value  delay          The delay before a hover opens or closes the menu, in milliseconds.
 * @value  offsetDistance The gap between the trigger and the menu, in pixels.
 */
export default class extends Controller {
    #reopen = false;

    static targets = ['trigger', 'content'];
    static values = {
        placement: { type: String, default: 'bottom' },
        triggerType: { type: String, default: 'click' },
        open: Boolean,
        delay: { type: Number, default: 300 },
        offsetDistance: { type: Number, default: 10 },
    };

    connect() {
        // open when this controller last disconnected: its element moved in the DOM (Turbo moving a permanent element)
        const reopen = this.#reopen;
        this.#reopen = false;
        this.visible = false;
        this.#closeMarkup();
        this.timeouts = new Set();
        this.listeners = [];

        const on = (target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            this.listeners.push(() => target.removeEventListener(type, handler, options));
        };

        if ('hover' === this.triggerTypeValue) {
            on(this.triggerTarget, 'click', () => this.toggle());
            on(this.triggerTarget, 'mouseenter', () => this.later(() => this.show()));
            on(this.contentTarget, 'mouseenter', () => this.show());
            const hideUnlessHovered = () => this.later(() => this.contentTarget.matches(':hover') || this.hide());
            on(this.triggerTarget, 'mouseleave', hideUnlessHovered);
            on(this.contentTarget, 'mouseleave', hideUnlessHovered);
        } else if ('none' !== this.triggerTypeValue) {
            on(this.triggerTarget, 'click', () => this.toggle());
        }
        on(this.triggerTarget, 'keydown', (event) => this.handleTriggerKeydown(event));
        on(this.contentTarget, 'keydown', (event) => this.handleContentKeydown(event));
        // closed in the copy of the page Turbo shows on Back and Forward, not only once that copy connects; a frame
        // visit promoted to history took its copy already and keeps the page on screen, so the menu stays open; Turbo
        // moves a permanent element into the next page, the menu as the user left it
        on(document, 'turbo:before-cache', () => isKeptOnCache(this.element) || this.hide());

        if (this.openValue || reopen) {
            this.show();
        }
    }

    disconnect() {
        this.#reopen = this.visible;
        this.hide({ restoreFocus: false, silent: true });
        this.listeners.forEach((remove) => remove());
        this.timeouts.forEach((id) => clearTimeout(id));
    }

    later(callback) {
        const id = setTimeout(() => {
            this.timeouts.delete(id);
            callback();
        }, this.delayValue);
        this.timeouts.add(id);
    }

    toggle() {
        this.visible ? this.hide({ restoreFocus: false }) : this.show();
    }

    show() {
        if (this.visible) {
            return;
        }
        this.visible = true;
        this.contentTarget.classList.remove('hidden');
        this.contentTarget.classList.add('block');
        this.contentTarget.removeAttribute('aria-hidden');
        this.triggerTarget.setAttribute('aria-expanded', 'true');

        this.onClickOutside = (event) => {
            if (!this.contentTarget.contains(event.target) && !this.triggerTarget.contains(event.target)) {
                this.hide({ restoreFocus: false });
            }
        };
        document.addEventListener('click', this.onClickOutside, true);
        this.stopFollowing = follow(() => this.position());

        this.position();
    }

    hide({ restoreFocus = false, silent = false } = {}) {
        if (!this.visible && !silent) {
            return;
        }
        this.visible = false;
        document.removeEventListener('click', this.onClickOutside, true);
        this.stopFollowing?.();
        this.stopFollowing = null;
        if (silent) {
            return;
        }
        this.#closeMarkup();
        if (restoreFocus) {
            this.triggerTarget.focus();
        }
    }

    /**
     * Places the content like Popper does for Flowbite (absolute, `translate(x, y)`, offset, flip,
     * shift along the trigger within the viewport), so menus land on the same pixels: the kit's shared
     * positioning (`assets/lib/uxor-floating.js`, the `floating` recipe).
     */
    position() {
        this.contentTarget.dataset.popperPlacement = position(this.contentTarget, this.triggerTarget, {
            placement: this.placementValue,
            offset: this.offsetDistanceValue,
        });
    }

    getMenuItems() {
        // menu items of this level only, not those of nested submenus
        return [...this.contentTarget.querySelectorAll('[role="menuitem"]')].filter(
            (item) => item.closest('[data-dropdown-target="content"]') === this.contentTarget
        );
    }

    focusItem(index) {
        const items = this.getMenuItems();
        if (0 === items.length) {
            return;
        }
        items[((index % items.length) + items.length) % items.length].focus();
    }

    open(focusIndex) {
        this.show();
        requestAnimationFrame(() => this.focusItem(focusIndex));
    }

    handleTriggerKeydown(event) {
        // a SubTrigger is a menu item of its parent menu, which handles its arrow keys
        const isSubTrigger = 'menuitem' === this.triggerTarget.getAttribute('role');

        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
                if (!isSubTrigger && !this.visible) {
                    event.preventDefault();
                    this.open('ArrowDown' === event.key ? 0 : -1);
                }
                break;
            case 'Enter':
            case ' ':
                if (!this.visible) {
                    event.preventDefault();
                    this.open(0);
                }
                break;
            case 'Escape':
                if (this.visible) {
                    event.preventDefault();
                    this.hide({ restoreFocus: true });
                }
                break;
        }
    }

    handleContentKeydown(event) {
        const items = this.getMenuItems();
        const current = items.indexOf(document.activeElement);
        if (-1 === current) {
            return;
        }
        // keep parent menus from handling the same key
        event.stopPropagation();

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.focusItem(current + 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.focusItem(current - 1);
                break;
            case 'Home':
                event.preventDefault();
                this.focusItem(0);
                break;
            case 'End':
                event.preventDefault();
                this.focusItem(-1);
                break;
            case 'Escape':
                event.preventDefault();
                this.hide({ restoreFocus: true });
                break;
            case 'Tab':
                this.hide({ restoreFocus: true });
                break;
            case 'ArrowRight': {
                if ('menu' === document.activeElement.getAttribute('aria-haspopup')) {
                    event.preventDefault();
                    // the item is the trigger of a submenu's own controller: open it (already open, a click would
                    // close it) and focus its first item
                    const submenu = document.activeElement.closest('[data-controller~="dropdown"]');
                    this.application.getControllerForElementAndIdentifier(submenu, 'dropdown')?.open(0);
                }
                break;
            }
            case 'ArrowLeft': {
                const parentMenu = this.element.closest('li[role="none"]')?.closest('[data-controller="dropdown"]');
                if (parentMenu && parentMenu !== this.element) {
                    event.preventDefault();
                    this.hide({ restoreFocus: true });
                }
                break;
            }
        }
    }

    #closeMarkup() {
        this.contentTarget.classList.remove('block');
        this.contentTarget.classList.add('hidden');
        this.contentTarget.setAttribute('aria-hidden', 'true');
        this.triggerTarget.setAttribute('aria-expanded', 'false');
    }
}
