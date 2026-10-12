# Calendar

Pick a date, several dates or a range, inline in the page: keyboard navigation, disabled dates and bounds, several months, locales and right-to-left, and hidden inputs a form or a Live Component reads.

```twig {"preview":true}
<twig:Calendar today="2026-03-15" selected="2026-03-12" captionLayout="dropdown" class="mx-auto rounded-base border border-default bg-neutral-primary" />
```

## Installation

::: installation

Formatting the month and day names needs PHP's `intl` extension for every locale but `en`.

## Usage

```twig
<twig:Calendar
    mode="single | multiple | range"
    name="date"
    selected="2026-03-15"
    minDate="2026-01-01"
    :disabled="['2026-03-20']"
/>
```

Dates are `Y-m-d` strings, in and out. A value that is not a real `Y-m-d` date (`2026-13-45`, a raw form
submission) is ignored, never parsed.

### In a form

With `name`, the calendar renders hidden inputs that the form submits:

| `mode` | inputs |
|---|---|
| `single` | `name` |
| `multiple` | `name[]`, one per date |
| `range` | `name[from]` and `name[to]` |

`inputAttr` adds attributes to them, e.g. `:inputAttr="{form: 'booking'}"` for a form elsewhere on the page (inline event handlers, `on…`, are left out: behavior belongs in a Stimulus controller). Each pick
dispatches `input` and `change` on the inputs, as a typed field would. The day and navigation buttons are
`type="button"`: they never submit the form. A reset of the form (a reset button, or Back to a GET form through
the layouts' [`form-reset`](../layouts/README.md#back-and-forms)) brings back the month and dates the server rendered,
with no `input` or `change`, in the same task (a `FormData` taken right after `form.reset()` holds them): a reset
another listener cancels (`preventDefault()` on the `reset` event) changes nothing, as for the native fields; one
cancelled by a window listener added after the calendar's is put back as soon as the event is over. That holds for inputs tied to a form outside the calendar (`inputAttr: {form: …}`), even
before a multiple calendar has any.

`minDate`, `maxDate` and `disabled` only guide the user: check the submitted dates on the server (Symfony's `Range`,
`GreaterThan` constraints).

### With a Live Component

Bind the selection to a property with `model` (not `data-model`, which a Twig component inside a Live Component reads
as its own binding):

```twig
{# a string property, e.g. #[LiveProp(writable: true)] public ?string $day = null; #}
<twig:Calendar model="day" :selected="day" />

{# range: an array property with `from` and `to`, e.g. public array $stay = ['from' => null, 'to' => null]; #}
<twig:Calendar mode="range" model="stay" :selected="[stay.from, stay.to]" />
```

When a re-render changes `minDate`, `maxDate`, `disabled`, `modifiers`, `today` or `locale`, the calendar updates
without losing its month or selection. `numberOfMonths`, `showWeekNumber`, `fixedWeeks`, `weekStartsOn` and
`captionLayout` take effect on the next full render. Several dates (`multiple`) cannot bind to one property: submit
them with a Live action that reads the form.

### Events and other controllers

- `calendar:select` (detail: `selected`, `mode`, `source`: `click`, `key`, `api`, or `reset` when the form holding
  its inputs is reset) after each change, and
  `calendar:month-change` (detail: `month`) on navigation. Both bubble.
- From another Stimulus controller: `calendar.canSelect('2026-03-20')` and `calendar.select(['2026-03-20'])`, which
  refuses disabled dates and, in range mode, a range over a disabled day.
- A button inside the calendar with `data-action="click->calendar#selectDate"` and `data-calendar-date-param` selects
  that date (presets below).

## Examples

### Range over two months

A range cannot span a disabled day: a click past one starts a new range.

```twig {"preview":true}
<twig:Calendar
    mode="range"
    today="2026-03-15"
    month="2026-03-01"
    :selected="['2026-03-09', '2026-03-13']"
    :disabled="['2026-03-21', '2026-03-22']"
    numberOfMonths="2"
    class="mx-auto rounded-base border border-default bg-neutral-primary"
/>
```

### Several dates

```twig {"preview":true}
<twig:Calendar
    mode="multiple"
    today="2026-03-15"
    month="2026-03-01"
    :selected="['2026-03-04', '2026-03-11', '2026-03-18']"
    class="mx-auto rounded-base border border-default bg-neutral-primary"
/>
```

### Presets and booked dates

`modifiers` flags days with `data-<name>="true"`, for your own styles.

```twig {"preview":true}
{% set booked = ['2026-03-17', '2026-03-18', '2026-03-19'] %}
<twig:Calendar
    today="2026-03-15"
    selected="2026-03-16"
    :disabled="booked"
    :modifiers="{booked: booked}"
    minDate="2026-03-15"
    weekStartsOn="1"
    showWeekNumber
    class="mx-auto rounded-base border border-default bg-neutral-primary [&_[data-booked=true]_button]:text-fg-danger"
>
    <div class="mt-3 flex gap-2 border-t border-default pt-3">
        {% for preset in [{label: 'Today', date: '2026-03-15'}, {label: 'Tomorrow', date: '2026-03-16'}, {label: 'In a week', date: '2026-03-22'}] %}
            <twig:Button variant="outline" size="xs" class="flex-1" data-action="click->calendar#selectDate" data-calendar-date-param="{{ preset.date }}">{{ preset.label }}</twig:Button>
        {% endfor %}
    </div>
</twig:Calendar>
```

### Locale and right to left

```twig {"preview":true}
<div dir="rtl" class="flex justify-center">
    <twig:Calendar today="2026-03-15" selected="2026-03-12" locale="ar" class="rounded-base border border-default bg-neutral-primary" />
</div>
```

## Accessibility

- Each month is a `role="grid"` named by its caption; each day is a button named by its full date.
- Arrow keys move by day and week (swapped in right-to-left), Home and End to the week's ends, Page Up and Page Down by
  month; one day takes the Tab focus.
- Disabled days are disabled buttons, struck through.

Built from the `calendar` recipe of the Symfony UX Toolkit shadcn kit (3.5.1, MIT), with this kit's colors and icons.
