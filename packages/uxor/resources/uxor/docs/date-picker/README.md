# Date Picker

A field that opens a `Calendar` in a `Popover`: pick a date (or a range) with the mouse or the keyboard, or type it. The picked date goes into the calendar's hidden input, which forms and Live Components read.

```twig {"preview":true}
<div class="flex min-h-96 items-start justify-center pt-6">
    <div class="w-60">
        <twig:Label for="date-picker-default-trigger" class="mb-2.5">Due date</twig:Label>
        <twig:DatePicker id="date-picker-default" selected="2026-03-12" open class="block">
            <twig:DatePicker:Trigger>
                <twig:Button variant="outline" class="w-full justify-between gap-2 font-normal" {{ ...date_picker_trigger_attrs }}>
                    <twig:DatePicker:Value placeholder="Pick a date" />
                    <twig:ux:icon name="flowbite:calendar-month-outline" class="size-4 text-body" aria-hidden="true" />
                </twig:Button>
            </twig:DatePicker:Trigger>
            <twig:DatePicker:Content>
                <twig:Calendar name="due" selected="2026-03-12" today="2026-03-15" />
            </twig:DatePicker:Content>
        </twig:DatePicker>
    </div>
</div>
```

## Installation

::: installation

Formatting dates needs PHP's `intl` extension for every locale but `en` (the `calendar` recipe's requirement).

## Usage

```twig
<twig:DatePicker id="due" selected="2026-03-12">
    <twig:DatePicker:Trigger>
        <twig:Button variant="outline" {{ ...date_picker_trigger_attrs }}>
            <twig:DatePicker:Value placeholder="Pick a date" />
        </twig:Button>
    </twig:DatePicker:Trigger>
    <twig:DatePicker:Content>
        <twig:Calendar name="due" selected="2026-03-12" />
    </twig:DatePicker:Content>
</twig:DatePicker>
```

- The `Calendar` inside holds the selection: give it `name` for a form (its hidden inputs: `due`, `due[from]` and
  `due[to]` in range mode), `model` for a Live Component, and its bounds (`minDate`, `maxDate`, `disabled`).
- Give `DatePicker` the same `selected` so the trigger shows the date before JavaScript runs.
- A pick closes the popover once the selection is complete (in range mode, after both ends); `:closeOnSelect="false"`
  keeps it open. Opening it focuses the selected day, or today's.
- `dateStyle` (`full`, `long`, `medium`, `short`), `locale` and `separator` shape the text.
- Pass a stable `id` inside Live Components and Turbo Frames.

### With a Symfony form

The `form-theme` recipe renders a `DateType` as a date picker when you opt in, with no PHP of your own:

```php
$builder->add('startsOn', DateType::class, [
    'widget' => 'single_text',
    'block_prefix' => 'flowbite_date_picker',
    'attr' => ['min' => '2026-01-01'],          // the calendar's bounds; validate with constraints too
    'constraints' => [new GreaterThanOrEqual('2026-01-01')],
]);
```

It renders a text field where the date can be typed, a button opening the calendar, and the hidden input with the
field's name. Its label, help, errors and `aria-describedby` come from the row as for any field. The button's name
is "Choose date", translated with the form's translation domain; set the `picker_label` variable to change it
(`form_row(form.startsOn, {picker_label: 'Pick a start date'})`). A form in a Live Component (`data-model` on the
`<form>`) gets each pick through the hidden input's `change`.

### Typing a date

`DatePicker:Input` (single mode) takes `2026-03-15`, the locale's numeric order (`3/15/2026` in `en-US`,
`15.03.2026` in `de`) or the formatted text (`Mar 15, 2026`). A date the calendar refuses (disabled, out of
bounds) or text that is not a date clears the selection when the field changes, and marks the field
`aria-invalid`.

```twig {"preview":true}
<div class="flex min-h-96 items-start justify-center pt-6">
    <div class="w-64">
        <twig:Label for="date-picker-typed" class="mb-2.5">Start date</twig:Label>
        <twig:DatePicker id="date-picker-typed-picker" selected="2026-03-12">
            <div class="flex gap-2">
                <twig:DatePicker:Input>
                    <twig:Input id="date-picker-typed" {{ ...date_picker_input_attrs }} />
                </twig:DatePicker:Input>
                <twig:DatePicker:Trigger>
                    <twig:Button variant="outline" size="icon" aria-label="Choose date" {{ ...date_picker_trigger_attrs }}>
                        <twig:ux:icon name="flowbite:calendar-month-outline" class="size-5" aria-hidden="true" />
                    </twig:Button>
                </twig:DatePicker:Trigger>
            </div>
            <twig:DatePicker:Content>
                <twig:Calendar name="start" selected="2026-03-12" today="2026-03-15" minDate="2026-03-01" />
            </twig:DatePicker:Content>
        </twig:DatePicker>
    </div>
</div>
```

### Times

Use a native time field next to the picker: `<twig:Input type="time" />`, or `TimeType` with
`'widget' => 'single_text'` in a form. A native `<input type="date">` (`DateType` without the opt-in) keeps working
too.

## Examples

### Range

```twig {"preview":true}
<div class="flex min-h-96 items-start justify-center pt-6">
    <twig:DatePicker id="date-picker-range" :selected="['2026-03-09', '2026-03-13']" dateStyle="medium" open>
        <twig:DatePicker:Trigger>
            <twig:Button variant="outline" class="w-64 justify-start gap-2 font-normal" {{ ...date_picker_trigger_attrs }}>
                <twig:ux:icon name="flowbite:calendar-month-outline" class="size-4 text-body" aria-hidden="true" />
                <twig:DatePicker:Value placeholder="Pick dates" />
            </twig:Button>
        </twig:DatePicker:Trigger>
        <twig:DatePicker:Content label="Choose dates">
            <twig:Calendar mode="range" name="stay" :selected="['2026-03-09', '2026-03-13']" today="2026-03-15" />
        </twig:DatePicker:Content>
    </twig:DatePicker>
</div>
```

### Date of birth

```twig {"preview":true}
<div class="flex min-h-96 items-start justify-center pt-6">
    <twig:DatePicker id="date-picker-birth" dateStyle="long">
        <twig:DatePicker:Trigger>
            <twig:Button variant="outline" class="w-60 justify-between gap-2 font-normal" {{ ...date_picker_trigger_attrs }}>
                <twig:DatePicker:Value placeholder="Date of birth" />
                <twig:ux:icon name="flowbite:chevron-down-outline" class="size-4 text-body" aria-hidden="true" />
            </twig:Button>
        </twig:DatePicker:Trigger>
        <twig:DatePicker:Content>
            <twig:Calendar name="birthday" captionLayout="dropdown" startMonth="1926-01-01" endMonth="2026-12-01" month="1990-06-01" today="2026-03-15" maxDate="2026-03-15" />
        </twig:DatePicker:Content>
    </twig:DatePicker>
</div>
```

## Accessibility

- The trigger is a button with `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`; the calendar opens in a
  dialog named by `DatePicker:Content`'s `label`, and Escape closes it, returning the focus to the trigger.
- An icon-only trigger needs an `aria-label`; a typed field needs a label of its own.

Built from the `date-picker` recipe of the Symfony UX Toolkit shadcn kit (3.5.1, MIT), with this kit's popover and
calendar.
