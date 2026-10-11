import { Controller } from '@hotwired/stimulus';
import { isKeptOnCache } from '../lib/uxor-turbo.js';

/**
 * The mark a controller leaves on the dialog it showed as a modal, removed when it closes it: state of the dialog
 * itself, not of the module. A morph moves an open dialog into a new container: with `moveBefore` it stays modal,
 * without it (WebKit) it leaves the top layer, open but no longer modal. A dialog with the mark is that same element,
 * to show as a modal again; Turbo's copy of a page holds clones, which copy attributes, never properties.
 */
const SHOWN_AS_MODAL = Symbol.for('uxor.modal.shownAsModal');

export default class extends Controller {
    static targets = ['trigger', 'modal'];

    static values = {
        open: Boolean,
    };

    #wasOpen = null;

    connect() {
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
        this.#wasOpen = this.hasModalTarget && this.modalTarget.open;
        if (this.#wasOpen) {
            this.#closeNow();
        }
    }

    open() {
        this.modalTarget.showModal();
        this.modalTarget[SHOWN_AS_MODAL] = true;
        this.#syncAfterTransition(true);
    }

    closeOnClickOutside({ target }) {
        if (target === this.modalTarget) {
            this.close();
        }
    }

    close() {
        this.modalTarget.close();
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
        delete this.modalTarget[SHOWN_AS_MODAL];
        if (this.hasTriggerTarget) {
            this.triggerTarget.setAttribute('aria-expanded', 'false');
        }
        this.modalTarget.setAttribute('aria-hidden', 'true');
    }
}
