import { Controller } from '@hotwired/stimulus';
import { isPermanent, isPromotedFrameCache } from '../lib/uxor-turbo.js';

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
 * changes: it reads its targets and listens to its `dropzone:*` events.
 *
 * - Drag-over state: `data-dragging` on the element while a file is dragged over it.
 * - Drops outside the file input (on the list of files, on the preview) are refused, so the browser never opens the
 *   file in the tab and loses the form.
 * - Focus: a pick hides the focused input, so focus moves to the Remove button, whose name ("Remove photo.png") says
 *   what was picked; Remove puts focus back on the input; removing one of several files focuses the next Remove
 *   button, else the last one, else the input. Connecting never moves focus.
 * - A drag that leaves without a drop shows the empty box again: UX Dropzone shows its empty preview instead.
 * - One file stays picked when the element is moved and its controllers reconnect (a `data-turbo-permanent` element
 *   across Turbo visits): UX Dropzone clears the input on every connect, so the file is put back and the input gets a
 *   `change` event (not bubbling), which shows it again.
 * - In a form that is not a GET form (a POST form holds the user's work), one file picked stays picked after Back and
 *   Forward: before Turbo copies the page, the file is kept under a key the zone carries into the copy, and put back
 *   the same way when the copy connects. A frame visit promoted to history copies the page as it starts, before its
 *   `turbo:before-cache`: the zone carries a key from its connect on, and takes a new one after each copy. A GET form,
 *   which cannot send files, and a zone outside a form start empty.
 *
 * @target input       The file input.
 * @target placeholder The inside of the box shown before a pick.
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
    static targets = ['input', 'placeholder', 'preview', 'clearButton', 'list'];

    #inputFocused = false;
    #clearing = false;
    #removedIndex = null;
    #leaveTimeout = null;
    #kept = null;

    connect() {
        // a copy of the page Turbo cached: the file the zone held then
        const key = this.element.getAttribute('data-dropzone-assist-copy');
        const copied = copies.get(key)?.transfer ?? null;
        copies.delete(key);
        // the key the next copy taken before its `turbo:before-cache` (a frame visit promoted to history) carries
        this.element.setAttribute('data-dropzone-assist-copy', String(++lastKey));
        const kept = this.#kept ?? copied;
        this.#kept = null;
        if (!kept?.files.length || this.hasListTarget || !this.hasPreviewTarget) {
            return;
        }
        // after UX Dropzone's connect, wherever its controller comes in the order, has cleared the input
        queueMicrotask(() => {
            if (this.element.isConnected && !this.inputTarget.files?.length) {
                this.inputTarget.files = kept.files;
                this.inputTarget.dispatchEvent(new Event('change'));
            }
        });
    }

    disconnect() {
        // the key stays: Turbo may copy the page after its controllers disconnected
        // the same element may connect again (moved); a new element (Back, a Turbo Stream) gets a new controller
        if (!this.hasListTarget && this.inputTarget.files?.length) {
            this.#kept = new DataTransfer();
            for (const file of this.inputTarget.files) {
                this.#kept.items.add(file);
            }
        }
        this.element.removeAttribute('data-dragging');
        clearTimeout(this.#leaveTimeout);
        this.#leaveTimeout = null;
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
        if (this.hasListTarget || !this.hasPreviewTarget) {
            return;
        }
        // UX Dropzone then shows its preview, empty when nothing was picked: show the box again after its listener ran
        clearTimeout(this.#leaveTimeout);
        this.#leaveTimeout = setTimeout(() => {
            this.#leaveTimeout = null;
            if (!this.inputTarget.files?.length) {
                this.inputTarget.style.display = 'block';
                this.placeholderTarget.style.display = 'block';
                this.previewTarget.style.display = 'none';
            }
        });
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
