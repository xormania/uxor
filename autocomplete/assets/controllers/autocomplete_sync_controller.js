import { Controller } from '@hotwired/stimulus';

/**
 * Keeps what Tom Select shows (UX Autocomplete's controller, on the same `<select>`) in step with the choice of the
 * `<select>` when that choice changes without Tom Select:
 *
 * - A Live Component's re-render copies the server's options, the chosen one marked `selected`, into the select (UX
 *   Autocomplete marks it `data-skip-morph`), and UX Autocomplete sets Tom Select up again only when the options
 *   themselves change. The select then holds the value the server set, and Tom Select would still show the one before.
 *   When the two differ after such a change, Tom Select reads the select again (`sync()`).
 * - A reset of the select's form (a reset button, `form.reset()`, or the `form-reset` controller of the `layouts`
 *   recipe after Back to a GET form) puts back the options the server selected, which Tom Select does not see. The
 *   form is the select's own (`select.form`), which honours the `form` attribute. The `reset` event comes before the
 *   fields are reset, and any listener can cancel it: Tom Select is synced once the event is over (a task later, a
 *   click on a reset button running microtasks between listeners), only when nothing cancelled it, and silently (no
 *   `input` or `change` event, so no Live Component request), as a native field takes back its default. The Tom Select
 *   synced is the one on the select then (`select.tomselect`): UX Autocomplete builds a new one when the options
 *   change. Either way Tom Select is synced only when it shows other values than the select holds, so the reset the
 *   `form-reset` controller has already synced is not synced again.
 * - A copy of the page Turbo took while Tom Select was on screen (a frame visit promoted to history copies the page as
 *   it starts, before UX Autocomplete removes Tom Select) holds Tom Select's markup, which no Tom Select owns: as the
 *   copy connects, that markup is removed, so the field shows the one Tom Select UX Autocomplete sets up.
 */
export default class extends Controller {
    #observer = null;
    #form = null;
    // the syncs waiting for their reset event to be over
    #resetTimeouts = new Set();

    connect() {
        this.#removeCopiedTomSelect();
        this.#observer = new MutationObserver(() => this.#sync());
        this.#observer.observe(this.element, { childList: true });
        this.#form = this.element.form ?? null;
        this.#form?.addEventListener('reset', this.#formReset);
    }

    disconnect() {
        this.#observer?.disconnect();
        this.#observer = null;
        this.#form?.removeEventListener('reset', this.#formReset);
        this.#form = null;
        for (const timeout of this.#resetTimeouts) {
            clearTimeout(timeout);
        }
        this.#resetTimeouts.clear();
    }

    /**
     * Tom Select puts its wrapper right after the `<select>`, its dropdown inside the wrapper or, with `dropdownParent`,
     * elsewhere, its list named `<id>-ts-dropdown`: those a copy left are the ones that are not the current Tom Select's.
     * The copied `<select>` also carries the classes Tom Select gave it, which a Tom Select set up on it copies to its
     * wrapper (hiding it): removed from the `<select>` when UX Autocomplete's controller comes after this one, from the
     * wrapper it built when it came first.
     */
    #removeCopiedTomSelect() {
        const tomSelect = this.element.tomselect;
        const copied = [];
        for (let next = this.element.nextElementSibling; next?.classList.contains('ts-wrapper'); next = next.nextElementSibling) {
            if (next !== tomSelect?.wrapper) {
                copied.push(next);
            }
        }
        if (this.element.id) {
            // the id is its list's, inside the dropdown
            for (const list of document.querySelectorAll(`[id="${CSS.escape(this.element.id)}-ts-dropdown"]`)) {
                const dropdown = list.closest('.ts-dropdown') ?? list;
                if (list !== tomSelect?.dropdown_content && !copied.some((wrapper) => wrapper.contains(dropdown))) {
                    copied.push(dropdown);
                }
            }
        }
        if (!copied.length) {
            return;
        }
        // the copied `<select>` also carries the tabindex="-1" Tom Select gave it, which a Tom Select set up on it takes
        // as its own: the field's own tab index is the copied combobox's, the one Tom Select gave its focus node
        const focus = copied.map((element) => element.querySelector('[role="combobox"]')).find(Boolean);
        const tabIndex = focus ? focus.tabIndex : 0;
        for (const element of copied) {
            element.remove();
        }
        for (const element of tomSelect ? [tomSelect.wrapper, tomSelect.dropdown] : [this.element]) {
            element.classList.remove('tomselected', 'ts-hidden-accessible');
        }
        if (tomSelect) {
            tomSelect.tabIndex = tabIndex;
            if (!tomSelect.isDisabled) {
                tomSelect.focus_node.tabIndex = tabIndex;
            }
        } else {
            this.element.tabIndex = tabIndex;
        }
    }

    #sync() {
        const tomSelect = this.element.tomselect;
        if (!tomSelect) {
            return;
        }
        const chosen = [...this.element.selectedOptions].map((option) => option.value).filter((value) => '' !== value).sort();
        const shown = [tomSelect.getValue()].flat().filter((value) => '' !== value).sort();
        if (chosen.length !== shown.length || chosen.some((value, index) => value !== shown[index])) {
            // silent: Tom Select sets its items from the selected options and dispatches nothing
            tomSelect.sync();
        }
    }

    #formReset = (event) => {
        const timeout = setTimeout(() => {
            this.#resetTimeouts.delete(timeout);
            if (!event.defaultPrevented) {
                this.#sync();
            }
        });
        this.#resetTimeouts.add(timeout);
    };
}
