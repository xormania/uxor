import { Controller } from '@hotwired/stimulus';
import { isKeptOnCache } from '../lib/uxor-turbo.js';

/**
 * The mark a controller leaves on the dialog it showed as a modal, removed when it closes it: state of the dialog
 * itself, not of the module. A morph moves an open dialog into a new container: with `moveBefore` it stays modal,
 * without it (WebKit) it leaves the top layer, open but no longer modal. A dialog with the mark is that same element,
 * to show as a modal again; Turbo's copy of a page holds clones, which copy attributes, never properties.
 */
const SHOWN_AS_MODAL = Symbol.for('uxor.modal.shownAsModal');

/** The attribute that fades the backdrop out (`data-closing:backdrop:bg-transparent`) while a close waits for it. */
const CLOSING = 'data-closing';

export default class extends Controller {
    static targets = ['trigger', 'modal'];

    static values = {
        open: Boolean,
    };

    #wasOpen = null;

    /** The close waiting for the backdrop's fade, or null. */
    #closing = null;

    connect() {
        // a dialog whose close was still waiting for its fade when its controller went (moved by a Live re-render, a
        // copy of the page): closed now
        if (this.modalTarget.hasAttribute(CLOSING)) {
            this.#closeNow();
        }
        const demoted = this.modalTarget.open && !this.modalTarget.matches(':modal');
        // moved by a morph without `moveBefore` (WebKit) while open: shown as a modal again
        const moved = demoted && true === this.modalTarget[SHOWN_AS_MODAL];
        // a copy of the page Turbo cached while the dialog was open keeps its `open` attribute but not its
        // modality: a new controller closes it, then opens it as a modal if it should be open
        if (null === this.#wasOpen && demoted) {
            this.close();
        }
        if (this.#wasOpen ?? (this.openValue || moved)) {
            this.open();
        } else if (this.modalTarget.matches(':modal')) {
            // a dialog already open and modal: a Live re-render that replaced the container moved it in, and the
            // trigger rendered with it says it is open
            this.#markOpen();
        }
        document.addEventListener('turbo:before-cache', this.#closeBeforeCache);
    }

    disconnect() {
        document.removeEventListener('turbo:before-cache', this.#closeBeforeCache);
        // A <dialog> taken out of the DOM comes back open but no longer modal, so reopen it on reconnect. A Live
        // re-render that replaces the container may have moved the dialog to a new controller already: nothing to close.
        // A dialog fading out was being closed: it stays closed.
        this.#wasOpen = this.hasModalTarget && this.modalTarget.open && null === this.#closing;
        this.#closing = null;
        if (this.hasModalTarget && this.modalTarget.open) {
            this.#closeNow();
        }
    }

    open() {
        this.#cancelFade();
        this.modalTarget.showModal();
        this.modalTarget[SHOWN_AS_MODAL] = true;
        this.#syncAfterTransition(true);
    }

    closeOnClickOutside({ target }) {
        if (target === this.modalTarget) {
            this.close();
        }
    }

    // Fades the backdrop out, then closes the dialog: it stays open and modal while it fades. Without a fade to wait
    // for (prefers-reduced-motion, a dialog not shown as a modal) it closes at once.
    close() {
        if (null !== this.#closing) {
            return;
        }
        const fades = this.modalTarget.open ? this.#fadeOutBackdrop() : [];
        if (0 === fades.length) {
            this.#hide();
            return;
        }
        // a fade cancelled (its attribute removed by a morph) closes the dialog all the same; a newer open or close
        // replaced this one
        const closing = Promise.allSettled(fades.map((fade) => fade.finished)).then(() => {
            if (this.#closing === closing) {
                this.#hide();
            }
        });
        this.#closing = closing;
    }

    // Starts the backdrop's fade out and returns its color transition: none under prefers-reduced-motion. Another
    // animation on the backdrop (an app's own, which may never end) is not waited for.
    #fadeOutBackdrop() {
        this.modalTarget.setAttribute(CLOSING, '');
        return this.modalTarget
            .getAnimations({ subtree: true })
            .filter((animation) => '::backdrop' === animation.effect?.pseudoElement && 'background-color' === animation.transitionProperty);
    }

    #cancelFade() {
        this.#closing = null;
        this.modalTarget.removeAttribute(CLOSING);
    }

    #hide() {
        this.modalTarget.close();
        this.#cancelFade();
        delete this.modalTarget[SHOWN_AS_MODAL];
        this.#syncAfterTransition(false);
    }

    // Closes the modal before Turbo caches the page, so the copy shown on Back and Forward has it closed and its
    // trigger collapsed. A data-turbo-permanent modal is not in that copy: Turbo moves the live one in. A frame visit
    // promoted to history keeps the page on screen and took its copy when it started (closed as it connects): the
    // modal stays open.
    #closeBeforeCache = () => {
        if (this.modalTarget.open && !isKeptOnCache(this.element)) {
            this.#closeNow();
        }
    };

    // Updates the trigger and the dialog's attributes once the dialog's transition ends, or at once without one.
    #syncAfterTransition(open) {
        if (!this.hasTriggerTarget) {
            return;
        }
        const sync = () => {
            this.triggerTarget.setAttribute('aria-expanded', String(open));
            this.modalTarget.setAttribute('aria-hidden', String(!open));
        };
        if (this.modalTarget.getAnimations().length > 0) {
            this.modalTarget.addEventListener('transitionend', sync, { once: true });
        } else {
            sync();
        }
    }

    #markOpen() {
        if (this.hasTriggerTarget) {
            this.triggerTarget.setAttribute('aria-expanded', 'true');
        }
        this.modalTarget.setAttribute('aria-hidden', 'false');
    }

    // Closes the modal and updates the attributes at once, without waiting for a transition: Turbo copies the page
    // before it ends.
    #closeNow() {
        this.modalTarget.close();
        this.#cancelFade();
        delete this.modalTarget[SHOWN_AS_MODAL];
        if (this.hasTriggerTarget) {
            this.triggerTarget.setAttribute('aria-expanded', 'false');
        }
        this.modalTarget.setAttribute('aria-hidden', 'true');
    }
}
