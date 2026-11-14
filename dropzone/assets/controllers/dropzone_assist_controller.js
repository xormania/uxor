import { Controller } from '@hotwired/stimulus';
import { isCachedCopy, isPermanent, isPromotedFrameCache } from '../lib/uxor-turbo.js';

// through the prototype: a field named `method` shadows the form's own
const methodOf = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'method').get;

/**
 * The files of the zones Turbo copied, by the key each zone carries into its copy of the page, with the copy they belong
 * to: kept for the latest copies, as many as Turbo keeps (its snapshot cache holds 10), every zone of a copy included.
 */
const copies = new Map();
const COPIES_KEPT = 10;
let lastKey = 0;
// one `turbo:before-cache` event is one copy of the page: every zone's cache action receives the same event
let lastCacheEvent = null;
let lastCopy = 0;

/**
 * Works next to Symfony UX Dropzone's controller (`symfony--ux-dropzone--dropzone`) on a `Dropzone`, which it never
 * patches: it reads its targets, listens to its `dropzone:*` events, and clears a restored zone through its `clear()`.
 *
 * - Drag-over state: `data-dragging` on the element while a file is dragged over it.
 * - Drops outside the file input (on the list of files, on the preview) are refused, so the browser never opens the
 *   file in the tab and loses the form.
 * - Focus: a pick hides the focused input, so focus moves to the Remove button, whose name ("Remove photo.png") says
 *   what was picked; Remove puts focus back on the input; removing one of several files focuses the next Remove
 *   button, else the last one, else the input. Connecting never moves focus.
 * - In a form that is not a GET form (a POST form holds the user's work), one file picked stays picked after Back and
 *   Forward: before Turbo copies the page, the file is kept under a key the zone carries into the copy, and put back
 *   when the copy connects, with a `change` event on the input (not bubbling) that shows it, unless the browser's copy
 *   of the input kept it. A frame visit promoted to history copies the page as it starts, before its
 *   `turbo:before-cache`: the zone carries a key from its connect on, and takes a new one after each copy.
 * - A zone for one file in a GET form, which cannot send files, or outside a form starts empty in Turbo's copy of the
 *   page: some browsers' copy of an input keeps its file, which UX Dropzone keeps on connect, so the zone is cleared
 *   through UX Dropzone (its `dropzone:clear` included). The same element connecting again (moved, a
 *   `data-turbo-permanent` element across visits) is no copy, and keeps its file.
 *
 * @target input       The file input.
 * @target preview     The picked file (one file only).
 * @target clearButton The Remove button of the preview (one file only).
 * @target list        The list of picked files (several files only).
 * @action dragOver    Marks the element `data-dragging`, and refuses a drop outside the input.
 * @action dragLeave   Removes `data-dragging` once the drag leaves the element.
 * @action drop        Removes `data-dragging`, and refuses a drop outside the input.
 * @action remember    Records whether the input has focus, before a pick hides it (on `change`, in the capture phase).
 * @action changed     Focuses the Remove button after a pick made from the focused input (`dropzone:change`).
 * @action clearing    Records that the Remove button was clicked (in the capture phase).
 * @action cleared     Focuses the input after the Remove button cleared the pick (`dropzone:clear`).
 * @action removing    Records which file's Remove button was clicked (in the capture phase).
 * @action removed     Focuses the Remove button now at that place, else the last one, else the input (`dropzone:remove`).
 * @action cache       On `turbo:before-cache`: keeps the file of a zone in a form that is not a GET form for the copy.
 */
export default class extends Controller {
    static targets = ['input', 'preview', 'clearButton', 'list'];

    #inputFocused = false;
    #clearing = false;
    #removedIndex = null;

    connect() {
        // a zone in Turbo's copy of the page carries the key attribute every connect sets (and `cache` renews)
        const copy = isCachedCopy(this, 'data-dropzone-assist-copy');
        const key = this.element.getAttribute('data-dropzone-assist-copy');
        const copied = copies.get(key)?.transfer ?? null;
        copies.delete(key);
        // the key the next copy taken before its `turbo:before-cache` (a frame visit promoted to history) carries
        this.element.setAttribute('data-dropzone-assist-copy', String(++lastKey));
        if (!copy || this.hasListTarget || !this.hasPreviewTarget) {
            return;
        }
        // after UX Dropzone's connect, wherever its controller comes in the order, has taken the input's files
        queueMicrotask(() => {
            if (!this.element.isConnected) {
                return;
            }
            const form = this.inputTarget.form;
            if ((form && 'get' !== methodOf.call(form)) || isPermanent(this.element)) {
                if (copied?.files.length && !this.inputTarget.files?.length) {
                    this.inputTarget.files = copied.files;
                    this.inputTarget.dispatchEvent(new Event('change'));
                }
            } else if (this.inputTarget.files?.length) {
                const dropzone = this.application.getControllerForElementAndIdentifier(this.element, 'symfony--ux-dropzone--dropzone');
                if (dropzone) {
                    dropzone.clear();
                } else {
                    // not connected yet: it takes the empty input when it does
                    this.inputTarget.value = '';
                }
            }
        });
    }

    disconnect() {
        // the key stays: Turbo may copy the page after its controllers disconnected
        this.element.removeAttribute('data-dragging');
        this.#inputFocused = false;
        this.#clearing = false;
        this.#removedIndex = null;
    }

    cache(event) {
        if (event !== lastCacheEvent) {
            lastCacheEvent = event;
            lastCopy++;
        }
        const form = this.inputTarget.form;
        // Turbo moves a permanent element into the next page
        if (
            this.hasListTarget ||
            !this.hasPreviewTarget ||
            !this.inputTarget.files?.length ||
            !form ||
            'get' === methodOf.call(form) ||
            isPermanent(this.element)
        ) {
            return;
        }
        const files = new DataTransfer();
        for (const file of this.inputTarget.files) {
            files.items.add(file);
        }
        // Turbo copies the page once this event's listeners have run, with a new key; a frame visit promoted to history
        // copied it as it started, with the key the zone carried then, and the zone takes a new one for the next copy
        const promoted = isPromotedFrameCache();
        const key = promoted ? this.element.getAttribute('data-dropzone-assist-copy') : String(++lastKey);
        if (!key) {
            return;
        }
        copies.set(key, { transfer: files, copy: lastCopy });
        // the copies Turbo no longer keeps: every zone of each, never one zone of a copy Turbo still holds
        for (const [old, { copy }] of copies) {
            if (copy <= lastCopy - COPIES_KEPT) {
                copies.delete(old);
            }
        }
        this.element.setAttribute('data-dropzone-assist-copy', promoted ? String(++lastKey) : key);
    }

    dragOver(event) {
        this.element.setAttribute('data-dragging', '');
        if (event.target !== this.inputTarget) {
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'none';
            }
        }
    }

    dragLeave(event) {
        if (this.element.contains(event.relatedTarget)) {
            return;
        }
        this.element.removeAttribute('data-dragging');
    }

    drop(event) {
        this.element.removeAttribute('data-dragging');
        if (event.target !== this.inputTarget) {
            event.preventDefault();
        }
    }

    remember(event) {
        if (event.target === this.inputTarget) {
            this.#inputFocused = document.activeElement === this.inputTarget;
        }
    }

    changed() {
        const focused = this.#inputFocused;
        this.#inputFocused = false;
        if (focused && !this.hasListTarget && this.hasClearButtonTarget) {
            this.clearButtonTarget.focus();
        }
    }

    clearing() {
        this.#clearing = true;
    }

    cleared() {
        if (this.#clearing) {
            this.#clearing = false;
            this.inputTarget.focus();
        }
    }

    removing(event) {
        const button = event.target.closest('.dropzone-preview-list-remove');
        const item = button?.closest('li');
        this.#removedIndex = item && item.parentElement === this.listTarget ? [...this.listTarget.children].indexOf(item) : null;
    }

    removed() {
        const index = this.#removedIndex;
        this.#removedIndex = null;
        if (null === index || !this.hasListTarget) {
            return;
        }
        const buttons = this.listTarget.querySelectorAll('.dropzone-preview-list-remove');
        (buttons[index] ?? buttons[buttons.length - 1] ?? this.inputTarget).focus();
    }
}
