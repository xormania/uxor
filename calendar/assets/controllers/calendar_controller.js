import { Controller } from '@hotwired/stimulus';

const DAY = 86400000;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Month navigation and date selection for the `Calendar` component.
 *
 * The server renders a fixed six-by-seven grid per month whose day states are `data-*` attributes, so
 * navigating never rewrites markup or classes: it walks the cells and flips their attributes. Dates are
 * `Y-m-d` strings, turned into UTC timestamps only for arithmetic, so a daylight saving change never
 * shifts a day.
 *
 * Each pick writes the hidden inputs (`name`, `name[]`, `name[from]`/`name[to]`) and dispatches `input`
 * and `change` on them, so forms, Live Components (`data-model`) and other controllers see it; a change
 * coming from the server (a Live re-render) that the inputs already hold dispatches nothing. It also
 * dispatches `calendar:select` (detail: `selected`, `mode`, `source`: `click`, `key`, `api` or `reset`) and, on
 * navigation, `calendar:month-change`. Changing the bounds, the disabled dates, the modifiers, today or
 * the locale re-renders the grid.
 *
 * The selection and the displayed month live in the controller, not in its `selected` and `month`
 * attributes: those carry what the server rendered, so a Live re-render that changes them wins over the
 * browser (Live keeps attributes changed by JavaScript). On connect, the selection is read back from the
 * hidden inputs, or the day cells, which a Turbo snapshot keeps. Other controllers check and set the selection with `canSelect(date)`
 * and `select(dates, source)`, which refuse disabled dates and, in range mode, ranges over one.
 *
 * A reset of the form holding the hidden inputs (a reset button, or the `form-reset` controller of the `layouts` recipe
 * after Back to a GET form) brings back the month and the selection the server rendered, as a native field takes back
 * its `value` attribute: with no `input` or `change` event, and `calendar:select` with the source `reset`. The browser
 * cannot reset a hidden input itself, its value being its attribute. The `reset` event comes before the fields are
 * reset, and any listener can cancel it: the calendar acts once the event is over (a task later), only when nothing
 * cancelled it.
 *
 * Adapted from the `calendar` recipe of the Symfony UX Toolkit shadcn kit (3.5.1, MIT).
 *
 * @value  mode            The selection mode, one of `single`, `multiple` or `range`.
 * @value  locale          The locale of the caption and day labels, falling back to the document language.
 * @value  name            The name of the hidden inputs mirroring the selection.
 * @value  month           The first displayed month, as a `Y-m-d` string.
 * @value  selected        The selected dates, as `Y-m-d` strings.
 * @value  disabled        The dates that cannot be selected, as `Y-m-d` strings.
 * @value  modifiers       Extra flags keyed by name, each holding a list of `Y-m-d` strings.
 * @value  today           The date shown as today, as a `Y-m-d` string.
 * @value  minDate         The earliest selectable date, as a `Y-m-d` string.
 * @value  maxDate         The latest selectable date, as a `Y-m-d` string.
 * @value  startMonth      The earliest month reachable through navigation, as a `Y-m-d` string.
 * @value  endMonth        The latest month reachable through navigation, as a `Y-m-d` string.
 * @value  weekStartsOn    The first day of the week, from `0` for Sunday to `6` for Saturday.
 * @value  numberOfMonths  The number of months displayed side by side.
 * @value  showOutsideDays Whether the days of the surrounding months are displayed.
 * @value  showWeekNumber  Whether the leading week number column is displayed.
 * @value  fixedWeeks      Whether every month displays six weeks.
 * @target month           A displayed month, holding its caption and its grid.
 * @target previous        The button moving the calendar to the previous month.
 * @target next            The button moving the calendar to the next month.
 * @target input           A hidden input mirroring the selection.
 * @target inputPrototype  The template of a hidden input, cloned for each date in multiple mode.
 * @action previousMonth   Moves the calendar one month backwards.
 * @action nextMonth       Moves the calendar one month forwards.
 * @action goToMonth       Moves the calendar to the month and year picked in the dropdowns.
 * @action selectDate      Selects the date carried by the `date` param, or by the clicked day.
 * @action handleKeydown   Moves the focus between days with the arrow, Home, End and Page keys.
 * @action trackFocus      Reflects the focused day on its cell.
 * @action previewRange    Previews the range being drawn up to the hovered day.
 * @action clearPreview    Drops the range preview.
 */
export default class extends Controller {
    static targets = ['month', 'previous', 'next', 'input', 'inputPrototype'];

    static values = {
        mode: { type: String, default: 'single' },
        locale: String,
        name: String,
        month: String,
        selected: Array,
        disabled: Array,
        modifiers: Object,
        today: String,
        minDate: String,
        maxDate: String,
        startMonth: String,
        endMonth: String,
        weekStartsOn: Number,
        numberOfMonths: { type: Number, default: 1 },
        showOutsideDays: { type: Boolean, default: true },
        showWeekNumber: Boolean,
        fixedWeeks: Boolean,
    };

    #connected = false;
    #focusDate = null;
    #preview = null;
    #rendered = null;
    #formatters = {};
    #selected = [];
    #month = '';
    // every modifier name rendered so far: a name gone from `modifiers` loses its attribute
    #modifierNames = new Set();
    #form = null;
    // the resets waiting for their event to be over
    #resetTimeouts = new Set();

    connect() {
        this.#month = this.monthTargets[0]?.dataset.month || this.monthValue;
        this.#selected = this.#readSelection();
        this.#focusDate =
            this.element.querySelector('[data-slot="calendar-day"] button[tabindex="0"]')?.dataset.day ?? this.#selected[0] ?? this.#month;
        this.#connected = true;
        // the labels in the browser's own locale data, which can differ from the server's ICU (digits, names)
        this.#relabel();
        this.#render();
        this.#form = this.#owningForm();
        // on the window, as the event bubbles: after the form's and the document's own listeners
        window.addEventListener('reset', this.#formReset);
    }

    // the form the hidden inputs belong to: an input's own, or, before a multiple calendar has any, the one its
    // prototype names (`inputAttr: {form: …}`), else the form around the calendar
    #owningForm() {
        if (this.inputTargets[0]) {
            return this.inputTargets[0].form;
        }
        const id = this.hasInputPrototypeTarget ? this.inputPrototypeTarget.content.firstElementChild?.getAttribute('form') : null;
        const named = id ? document.getElementById(id) : null;

        return named instanceof HTMLFormElement ? named : this.element.closest('form');
    }

    disconnect() {
        window.removeEventListener('reset', this.#formReset);
        this.#form = null;
        for (const timeout of this.#resetTimeouts) {
            clearTimeout(timeout);
        }
        this.#resetTimeouts.clear();
    }

    /** The selected dates, as `Y-m-d` strings. */
    get selected() {
        return [...this.#selected];
    }

    /** Whether `date` (a `Y-m-d` string) can be selected. */
    canSelect(date) {
        return this.#isRealDate(date) && !this.#isDisabled(date);
    }

    /**
     * Sets the selection, as a pick would, and returns `true`; returns `false` and changes nothing when a date
     * cannot be selected, or when a range would contain a disabled day.
     */
    select(dates, source = 'api') {
        const list = [...new Set(dates.filter(Boolean))].sort();
        const limit = { single: 1, range: 2 }[this.modeValue] ?? list.length;
        if (list.length > limit || !list.every((date) => this.canSelect(date))) {
            return false;
        }
        if ('range' === this.modeValue && 2 === list.length && this.#crossesDisabled(list[0], list[1])) {
            return false;
        }
        if (list[0] && !this.#isDisplayed(list[0])) {
            this.#setMonth(`${list[0].slice(0, 7)}-01`);
        }
        this.#preview = null;
        this.#setSelected(list, source);

        return true;
    }

    previousMonth() {
        if (this.#canGoPrevious) {
            this.#setMonth(this.#addMonths(this.#month, -1));
        }
    }

    nextMonth() {
        if (this.#canGoNext) {
            this.#setMonth(this.#addMonths(this.#month, 1));
        }
    }

    goToMonth(event) {
        const selects = event.target.closest('[data-slot="calendar-month"]')?.querySelectorAll('select');
        if (2 !== selects?.length) {
            return;
        }
        const month = String(selects[0].value).padStart(2, '0');
        let first = this.#addMonths(`${selects[1].value}-${month}-01`, -(event.params.index ?? 0));
        // within the bounds, the last displayed month included
        if ('' !== this.endMonthValue) {
            const lastFirst = this.#addMonths(this.endMonthValue, 1 - this.numberOfMonthsValue);
            first = first > lastFirst ? lastFirst : first;
        }
        if ('' !== this.startMonthValue && first < this.startMonthValue) {
            first = this.startMonthValue;
        }
        this.#setMonth(first);
    }

    selectDate(event) {
        const date = event.params?.date ?? event.currentTarget.dataset.day;
        if (!this.canSelect(date)) {
            return;
        }
        this.#focusDate = date;
        // a click from the keyboard (Enter, Space) has no pointer position
        this.select(this.#nextSelection(date), 0 === event.detail ? 'key' : 'click');
    }

    handleKeydown(event) {
        const button = event.target.closest('[data-slot="calendar-day"] button');
        if (!button) {
            return;
        }

        const current = button.dataset.day;
        const weekday = (new Date(this.#parse(current)).getUTCDay() - this.weekStartsOnValue + 7) % 7;
        const rtl = 'rtl' === getComputedStyle(this.element).direction;
        let target;

        switch (event.key) {
            case 'ArrowLeft':
                target = this.#shift(current, rtl ? 1 : -1);
                break;
            case 'ArrowRight':
                target = this.#shift(current, rtl ? -1 : 1);
                break;
            case 'ArrowUp':
                target = this.#shift(current, -7);
                break;
            case 'ArrowDown':
                target = this.#shift(current, 7);
                break;
            case 'Home':
                target = this.#shift(current, -weekday);
                break;
            case 'End':
                target = this.#shift(current, 6 - weekday);
                break;
            case 'PageUp':
                target = this.#clampToMonth(current, -1);
                break;
            case 'PageDown':
                target = this.#clampToMonth(current, 1);
                break;
            default:
                return;
        }

        event.preventDefault();
        this.#focusDate = target;
        if (!this.#isDisplayed(target)) {
            this.#setMonth(`${target.slice(0, 7)}-01`);
        }
        this.#render();
        this.#dayButton(target)?.focus();
    }

    trackFocus(event) {
        const focused = 'focusin' === event.type ? event.target.closest('[data-slot="calendar-day"]') : null;
        for (const cell of this.#cells()) {
            cell.dataset.focused = String(cell === focused);
        }
        if (focused) {
            this.#focusDate = focused.dataset.day;
            this.#render();
        }
    }

    previewRange(event) {
        if ('range' !== this.modeValue || 1 !== this.#selected.length) {
            return;
        }
        const date = event.target.closest('[data-slot="calendar-day"]')?.dataset.day;
        if (!date || date === this.#preview || !this.canSelect(date)) {
            return;
        }
        // no preview over a disabled day: a click there starts a new range
        this.#preview = date > this.#selected[0] && this.#crossesDisabled(this.#selected[0], date) ? null : date;
        this.#render();
    }

    clearPreview() {
        if (null !== this.#preview) {
            this.#preview = null;
            this.#render();
        }
    }

    // the server rendered another month or selection (a Live re-render): it wins
    monthValueChanged() {
        if (this.#connected && this.monthValue && this.monthValue !== this.#month) {
            this.#setMonth(this.monthValue);
        }
    }

    selectedValueChanged() {
        const selected = this.selectedValue.filter((date) => this.#isRealDate(date));
        if (this.#connected && selected.join(',') !== this.#selected.join(',')) {
            this.#setSelected(selected, 'api');
        }
    }

    // the form is being reset: the event comes before the fields are reset, and the browser leaves hidden inputs alone,
    // so the calendar puts back the dates it rendered now, in the same task (`form.reset(); new FormData(form)` sends
    // them). It listens on the window, once the form's and the document's listeners have had their say: a reset one of
    // them cancelled changes nothing. A window listener after this one may still cancel it: after a task, the calendar
    // puts back what it showed before.
    #formReset = (event) => {
        if (event.target !== this.#form || event.defaultPrevented) {
            return;
        }
        const month = this.#month;
        const selected = [...this.#selected];
        this.#reset();
        const timeout = setTimeout(() => {
            this.#resetTimeouts.delete(timeout);
            if (event.defaultPrevented) {
                if (month !== this.#month) {
                    this.#setMonth(month);
                }
                this.#setSelected(selected, 'reset', false);
            }
        });
        this.#resetTimeouts.add(timeout);
    };

    #reset() {
        if (this.monthValue && this.monthValue !== this.#month) {
            this.#setMonth(this.monthValue);
        }
        const selected = this.selectedValue.filter((date) => this.#isRealDate(date));
        this.#preview = null;
        this.#focusDate = selected[0] ?? (this.todayValue && this.#isDisplayed(this.todayValue) ? this.todayValue : this.#month);
        this.#setSelected(selected, 'reset', false);
    }

    #setMonth(month) {
        this.#month = month;
        this.#render();
        this.dispatch('month-change', { detail: { month } });
    }

    #setSelected(dates, source, events = true) {
        this.#selected = dates;
        this.#render();
        this.#syncInputs(events);
        this.dispatch('select', { detail: { selected: [...dates], mode: this.modeValue, source } });
    }

    // what the browser shows: the hidden inputs when there are some, else the selected day cells
    #readSelection() {
        const inputs = this.inputTargets;
        let dates;
        if (inputs.length > 0) {
            dates = inputs.map((input) => input.value);
        } else if ('range' === this.modeValue) {
            const day = (state) => this.element.querySelector(`[data-slot="calendar-day"][data-${state}="true"]`)?.dataset.day ?? '';
            dates = [day('range-start'), day('range-end')];
        } else {
            dates = [...new Set(this.#cells().filter((cell) => 'true' === cell.dataset.selected).map((cell) => cell.dataset.day))];
        }
        dates = dates.filter((date) => this.#isRealDate(date));

        return 'range' === this.modeValue ? dates : [...new Set(dates)].sort();
    }

    // a change of what the grid shows (a Live re-render, a script) renders it again
    disabledValueChanged() {
        this.#invalidate();
    }

    minDateValueChanged() {
        this.#invalidate();
    }

    maxDateValueChanged() {
        this.#invalidate();
    }

    modifiersValueChanged() {
        this.#invalidate();
    }

    todayValueChanged() {
        this.#invalidate();
    }

    startMonthValueChanged() {
        this.#invalidate();
    }

    endMonthValueChanged() {
        this.#invalidate();
    }

    localeValueChanged() {
        this.#formatters = {};
        if (this.#connected) {
            this.#relabel();
        }
        this.#invalidate();
    }

    get #canGoPrevious() {
        return '' === this.startMonthValue || this.#month > this.startMonthValue;
    }

    get #canGoNext() {
        const last = this.#addMonths(this.#month, this.numberOfMonthsValue - 1);

        return '' === this.endMonthValue || last < this.endMonthValue;
    }

    get #range() {
        if ('range' !== this.modeValue) {
            return [null, null];
        }
        const [from, to] = this.#selected;
        if (from && !to && this.#preview && this.#preview >= from) {
            return [from, this.#preview];
        }

        return [from ?? null, to ?? null];
    }

    #invalidate() {
        if (!this.#connected) {
            return;
        }
        this.#rendered = null;
        this.#render();
    }

    #render() {
        const signature = [this.#month, this.#selected.join(','), this.#preview ?? '', this.#focusDate ?? ''].join('|');
        if (signature === this.#rendered) {
            return;
        }
        this.#rendered = signature;
        this.monthTargets.forEach((monthElement, index) => this.#renderMonth(monthElement, index));

        for (const button of this.previousTargets) {
            button.setAttribute('aria-disabled', String(!this.#canGoPrevious));
        }
        for (const button of this.nextTargets) {
            button.setAttribute('aria-disabled', String(!this.#canGoNext));
        }
    }

    #renderMonth(monthElement, index) {
        const monthStart = this.#addMonths(this.#month, index);
        const prefix = monthStart.slice(0, 7);
        const caption = this.#format('caption', this.#parse(monthStart));

        monthElement.dataset.month = monthStart;
        monthElement.querySelector('[data-slot="calendar-grid"]')?.setAttribute('aria-label', caption);

        const selects = monthElement.querySelectorAll('select');
        const labels = monthElement.querySelectorAll('[data-slot="calendar-caption-label"]');
        if (2 === selects.length) {
            selects[0].value = String(Number(prefix.slice(5)));
            selects[1].value = prefix.slice(0, 4);
            labels[0].firstChild.textContent = this.#format('monthShort', this.#parse(monthStart));
            labels[1].firstChild.textContent = prefix.slice(0, 4);
        } else if (labels[0]) {
            labels[0].textContent = caption;
        }

        const lead = (new Date(this.#parse(monthStart)).getUTCDay() - this.weekStartsOnValue + 7) % 7;
        const gridStart = this.#parse(monthStart) - lead * DAY;
        const [from, to] = this.#range;
        const modifiers = Object.entries(this.modifiersValue).filter(([name]) => /^[a-z][a-z0-9-]*$/.test(name));
        const stale = [...this.#modifierNames].filter((name) => !modifiers.some(([current]) => current === name));

        this.#cells(monthElement).forEach((cell, offset) => {
            const timestamp = gridStart + offset * DAY;
            const date = this.#toIso(timestamp);
            const outside = !date.startsWith(prefix);
            const rangeStart = null !== from && date === from;
            const rangeEnd = null !== to && date === to;
            const rangeMiddle = null !== from && null !== to && date > from && date < to;
            const selected = 'range' === this.modeValue ? rangeStart || rangeEnd || rangeMiddle : this.#selected.includes(date);
            const disabled = this.#isDisabled(date);

            cell.dataset.day = date;
            cell.dataset.outside = String(outside);
            cell.dataset.today = String(date === this.todayValue);
            cell.dataset.selected = String(selected);
            cell.dataset.disabled = String(disabled);
            cell.dataset.hidden = String(outside && !this.showOutsideDaysValue);
            cell.dataset.rangeStart = String(rangeStart);
            cell.dataset.rangeMiddle = String(rangeMiddle);
            cell.dataset.rangeEnd = String(rangeEnd);
            cell.setAttribute('aria-selected', String(selected));
            for (const name of stale) {
                cell.removeAttribute(`data-${name}`);
            }
            for (const [name, dates] of modifiers) {
                cell.setAttribute(`data-${name}`, String(Array.isArray(dates) && dates.includes(date)));
            }

            const button = cell.querySelector('button');
            // only a new text replaces the old: a render on focus (trackFocus) runs between the mousedown and the
            // mouseup of a click, and WebKit fires no click once the text node under the pointer is replaced
            const text = this.#format('day', timestamp);
            if (button.textContent !== text) {
                button.textContent = text;
            }
            button.dataset.day = date;
            button.dataset.calendarDateParam = date;
            button.dataset.selectedSingle = String('range' !== this.modeValue && selected);
            button.dataset.rangeStart = String(rangeStart);
            button.dataset.rangeMiddle = String(rangeMiddle);
            button.dataset.rangeEnd = String(rangeEnd);
            button.setAttribute('aria-label', this.#format('full', timestamp));
            button.disabled = disabled;
            button.tabIndex = date === this.#focusDate ? 0 : -1;
        });
        modifiers.forEach(([name]) => this.#modifierNames.add(name));

        monthElement.querySelectorAll('[data-slot="calendar-week"]').forEach((row, week) => {
            const start = this.#toIso(gridStart + week * 7 * DAY);
            const end = this.#toIso(gridStart + (week * 7 + 6) * DAY);
            row.dataset.hidden = String(!this.fixedWeeksValue && !start.startsWith(prefix) && !end.startsWith(prefix));
        });

        monthElement.querySelectorAll('[data-slot="calendar-week-number"]').forEach((cell, week) => {
            const monday = gridStart + (week * 7 + ((1 - this.weekStartsOnValue + 7) % 7)) * DAY;
            cell.firstElementChild.textContent = String(this.#isoWeek(monday)).padStart(2, '0');
        });
    }

    // the weekday headers and the month options, rendered by the server in its locale
    #relabel() {
        for (const header of this.element.querySelectorAll('[data-slot="calendar-weekday"]')) {
            // 2024-01-07 is a Sunday
            const timestamp = this.#parse('2024-01-07') + Number(header.dataset.weekday) * DAY;
            header.textContent = this.#format('weekdayShort', timestamp);
            header.setAttribute('aria-label', this.#format('weekday', timestamp));
        }
        for (const select of this.element.querySelectorAll('select[data-calendar-index-param]')) {
            if (12 !== select.options.length) {
                continue;
            }
            [...select.options].forEach((option, index) => {
                option.textContent = this.#format('monthShort', this.#parse(`2024-${String(index + 1).padStart(2, '0')}-01`));
            });
        }
    }

    #nextSelection(date) {
        if ('multiple' === this.modeValue) {
            return this.#selected.includes(date)
                ? this.#selected.filter((selected) => selected !== date)
                : [...this.#selected, date].sort();
        }
        if ('range' === this.modeValue) {
            const [from, to] = this.#selected;
            // a new range starts at the clicked day when it comes first, ends a range, or would span a disabled day
            return !from || to || date < from || this.#crossesDisabled(from, date) ? [date] : [from, date];
        }

        return this.#selected.includes(date) ? [] : [date];
    }

    /**
     * Writes the selection into the hidden inputs and dispatches `input` and `change` when one changed. In
     * multiple mode, the inputs are reused in order and cloned from the prototype when more are needed, so
     * their attributes (`form`, `disabled`, `data-model`…) and their place stay. Without `events`, nothing is dispatched.
     */
    #syncInputs(events = true) {
        const inputs = this.inputTargets;
        let changed = [];
        if ('multiple' === this.modeValue) {
            const container = inputs[0]?.parentElement ?? this.element.querySelector('[data-slot="calendar-inputs"]');
            if (!container) {
                return;
            }
            this.#selected.forEach((date, index) => {
                let input = inputs[index];
                if (!input) {
                    if (!this.hasInputPrototypeTarget) {
                        return;
                    }
                    input = this.inputPrototypeTarget.content.firstElementChild.cloneNode(true);
                    container.insertBefore(input, this.inputPrototypeTarget);
                }
                if (input.value !== date) {
                    input.value = date;
                    changed.push(input);
                }
            });
            const surplus = inputs.slice(this.#selected.length);
            if (events && surplus.length > 0 && 0 === changed.length) {
                // a deselected date with no other input changing: the events come from the removed input, emptied,
                // while it is still in place
                surplus[0].value = '';
                surplus[0].dispatchEvent(new Event('input', { bubbles: true }));
                surplus[0].dispatchEvent(new Event('change', { bubbles: true }));
            }
            surplus.forEach((input) => input.remove());
        } else {
            const [first, second] = this.#selected;
            for (const input of inputs) {
                const value = ('range' === this.modeValue && 'to' === input.dataset.role ? second : first) ?? '';
                if (input.value !== value) {
                    input.value = value;
                    changed.push(input);
                }
            }
        }
        for (const element of events ? changed : []) {
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    #crossesDisabled(from, to) {
        return this.disabledValue.some((date) => date > from && date < to);
    }

    #isDisabled(date) {
        return (
            this.disabledValue.includes(date) ||
            ('' !== this.minDateValue && date < this.minDateValue) ||
            ('' !== this.maxDateValue && date > this.maxDateValue)
        );
    }

    #isDisplayed(date) {
        const month = `${date.slice(0, 7)}-01`;

        return month >= this.#month && month <= this.#addMonths(this.#month, this.numberOfMonthsValue - 1);
    }

    #cells(root = this.element) {
        return Array.from(root.querySelectorAll('[data-slot="calendar-day"]'));
    }

    #dayButton(date) {
        return this.element.querySelector(`[data-slot="calendar-day"][data-day="${date}"] button`);
    }

    #shift(date, days) {
        return this.#toIso(this.#parse(date) + days * DAY);
    }

    /** Moves by whole months, keeping the day of the month when the target month is shorter. */
    #clampToMonth(date, months) {
        const target = this.#addMonths(`${date.slice(0, 7)}-01`, months);
        const lastDay = new Date(this.#parse(this.#addMonths(target, 1)) - DAY).getUTCDate();

        return `${target.slice(0, 8)}${String(Math.min(Number(date.slice(8)), lastDay)).padStart(2, '0')}`;
    }

    #addMonths(month, count) {
        const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;

        return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}-01`;
    }

    #parse(date) {
        return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
    }

    /** Whether `date` is a `Y-m-d` string naming a day that exists (no 2026-02-31). */
    #isRealDate(date) {
        return ISO_DATE.test(date ?? '') && this.#toIso(this.#parse(date)) === date;
    }

    #toIso(timestamp) {
        return new Date(timestamp).toISOString().slice(0, 10);
    }

    #isoWeek(timestamp) {
        const date = new Date(timestamp);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
        const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
        firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);

        return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY));
    }

    #format(style, timestamp) {
        if (!this.#formatters[style]) {
            const options = {
                caption: { month: 'long', year: 'numeric' },
                monthShort: { month: 'short' },
                weekday: { weekday: 'long' },
                weekdayShort: { weekday: 'short' },
                day: { day: 'numeric' },
                full: { dateStyle: 'full' },
            }[style];
            this.#formatters[style] = new Intl.DateTimeFormat(this.localeValue || document.documentElement.lang || undefined, { ...options, timeZone: 'UTC' });
        }

        return this.#formatters[style].format(timestamp);
    }
}
