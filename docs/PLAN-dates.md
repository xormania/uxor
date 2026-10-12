---
status: shipped
recipes: popover, calendar, date-picker
---

# Plan: C. Dates

_2026-10-07. This plan implements the C decisions in [`ROADMAP.md`](ROADMAP.md). It adds three recipes of our own, `popover`, `calendar` and `date-picker`, built from the Symfony UX Toolkit 3.5.1 shadcn kit and themed with this kit's color roles and `flowbite:` icons. It also adds a form-theme block and a Live bridge. Delivery is three pull requests: `popover`, then `calendar`, then `date-picker` with the form theme._

## Sources read (3.5.1, `demo/vendor/symfony/ux-toolkit/kits/shadcn/`)

| Recipe | Files | Shape |
|---|---|---|
| `popover` | `popover_controller.js` (106 lines), `Popover`, `Popover:Trigger`, `Popover:Content` | Targets `trigger`, `content`. Values `open`, `name`. Actions `toggle`, `close`, `handleGroupOpen` (`popover:open@window`), `handleOutsideClick` (`click@window`), `handleEscape` (`keydown.esc@window`). Positioning is CSS only: `side`/`align` props on Content, `absolute top-full…`, no flip or shift. The content is hidden with `invisible`/`opacity-0` plus `aria-hidden`, so focus waits two frames (`:101-104`). The trigger exposes `popover_trigger_attrs` (`aria-haspopup="dialog"`, `aria-expanded`) and has no `aria-controls` or `type="button"` |
| `calendar` | `calendar_controller.js` (482), `calendar_display_controller.js` (13), `Calendar.html.twig` (278) | Targets `month`, `previous`, `next`, `input`. Values `mode`, `locale`, `name`, `month`, `selected` (array of `Y-m-d`), `disabled`, `modifiers`, `today`, `minDate`, `maxDate`, `startMonth`, `endMonth`, `weekStartsOn`, `numberOfMonths`, `showOutsideDays`, `showWeekNumber`, `fixedWeeks`. Actions `previousMonth`, `nextMonth`, `goToMonth`, `selectDate`, `handleKeydown`, `trackFocus`, `previewRange`, `clearPreview`. The server renders a fixed 6×7 grid per month, and JS only flips `data-*` attributes on the cells. It dispatches `calendar:select` `{selected, mode}` and `calendar:month-change` |
| `date-picker` | `date_picker_controller.js` (159), `DatePicker`, `:Trigger`, `:Input`, `:Value`, `:Content` | The root hosts the `popover date-picker` controllers. Targets `trigger`, `value`, `input`. Values `locale`, `dateStyle`, `separator`, `closeOnSelect`. Actions `select` (`calendar:select->date-picker#select`), `parseInput` (`input->`), `open` (`keydown.down->`). It opens and closes the popover by writing `data-popover-open-value`, and reaches the calendar through `application.getControllerForElementAndIdentifier` |

**How values are stored.** The `Calendar` with `name` renders hidden inputs carrying ISO `Y-m-d` values (`Calendar.html.twig:264-275`):
- single mode: `name`;
- range mode: `name[from]` and `name[to]` (`data-role`);
- multiple mode: one `name[]` per date.

`DatePicker:Input` holds only the formatted text. The selection always lives in the calendar's hidden inputs.

### The five observations

| # | Where (shadcn 3.5.1) | What happens |
|---|---|---|
| 1 | `calendar_controller.js:372-405` (`#syncInputs`), `:223-231` (`selectedValueChanged` dispatches only `calendar:select`); `date_picker_controller.js:111-113` (`#reflect`) | It assigns `.value` without `input` or `change` events, so Live (`data-model`), form listeners and other controllers never see a pick |
| 2 | `date_picker_controller.js:52-56` (`if (null === date) return;`) | Emptied or unparseable text keeps the previous selection in the hidden input, so the form submits a date the user deleted |
| 3 | `calendar_controller.js:214-231`: only `monthValueChanged` and `selectedValueChanged` exist. The `#render` signature `:257-262` leaves out bounds, disabled dates and locale. `#formatters` (`:72`, `:466-478`) is cached forever. The weekday headers and month options are server-only (`Calendar.html.twig:157-159, 194-199`). `date_picker_controller.js:125-128` caches `#formatter` | A Live re-render or a script that changes `minDate`, `maxDate`, `disabled`, `modifiers`, `today`, `startMonth`, `endMonth` or `locale` updates the attribute, but the grid, the navigation state and the labels stay stale |
| 4 | `date_picker_controller.js:63-71` writes `calendar.selectedValue = [date]` directly. `#isDisabled` is checked only in `selectDate` (`calendar_controller.js:111`) and `previewRange` (`:197`). `#nextSelection` (`:363-367`) checks only the clicked endpoint | A typed date can be disabled or out of bounds. A range may span disabled days. Typing also forces `[date]` in range and multiple modes |
| 5 | `calendar_controller.js:394-404` | Multiple mode removes every input and creates bare `<input type=hidden name=… value=… data-calendar-target=input>` at the end of the root. `form=`, `disabled`, `data-model` and other attributes are lost, the markup moves, and Live sees inputs that JS added |

### Other problems found (fixed in the same PRs)

- **Bug: buttons submit forms.** Day buttons, navigation buttons and the triggers carry no `type="button"`, and the kit's `Button` sets no default type. Inside a `<form>`, every click on a day submits the form. Every button we render gets `type="button"`, and so do `popover_trigger_attrs` and `date_picker_trigger_attrs`.
- **Hostile attribute names.** `Calendar.html.twig:234` prints `data-{{ _name }}` from the `modifiers` keys unescaped, and `calendar_controller.js:326` calls `setAttribute` with them. Keep only keys matching `^[a-z][a-z0-9-]*$`, then add a case to `HostilePropsCommand`.
- **Invalid dates throw.** `selected`, `month`, `minDate` and the other date props go through `|date` (`Calendar.html.twig:45-54`), which throws on input such as `2026-13-45`. That input is what DateType re-renders after a failed submit. Accept only strict `Y-m-d` that round-trips, and drop anything else.
- **CSP in examples.** The READMEs use `style="min-height: …"`, which the CSP blocks. Use classes (`min-h-100`).
- **Text parsing.** `#parse` (`date_picker_controller.js:133-158`) uses `Date.parse`, which depends on the engine and reads local time.
- **Focus on open.** Popover focus picks the first focusable element (`popover_controller.js:90-105`), which inside a date picker is the "Previous month" button, not the selected day.
- **Twig cost.** `twig:Button` is rendered 42 times per month. Plain `<button type="button">` elements are cheaper to render and keep the classes in the Calendar template.

## Kit-wide rules for the three recipes

- **Recipe format.**
  - Every `manifest.json` gets this kit's `$schema` line.
  - Each prop gets a `## <type> <description>` line, and each block a `{##- … -#}` comment.
  - `attributes.defaults()` holds only `class`, `data-controller` and `data-action`. Write `data-slot`, `data-*-value`, ARIA and state attributes as literal attributes: the lint errors are `data-slot-in-defaults` and `state-in-defaults`.
  - Each controller documents every target, value and action with `@target`, `@value` and `@action`. Once one tag exists the lint enforces all of them, and each description must start with a capital letter and end with a period.
- **Templates may only reference shipped controllers** (`stimulus.controller.missing`): `date-picker` must declare `popover` and `calendar` as recipe dependencies.
- **Colors** come from roles only. Mapping from shadcn:

  | shadcn | ours |
  |---|---|
  | `bg-primary` / `text-primary-foreground` | `bg-brand` / `text-white` |
  | `bg-muted` (today, range ends) | `bg-neutral-tertiary` |
  | range middle | `bg-brand-softer text-fg-brand-strong` |
  | `text-muted-foreground` | `text-body-subtle` |
  | `ring-ring` | `ring-brand` |
  | `border-input` | `border-default-medium` |
  | `bg-popover` | `bg-neutral-primary-medium` |
  | `text-foreground` | `text-heading` |

- **Icons.** Use `flowbite:chevron-left-outline`, `chevron-right-outline` and `chevron-down-outline` (already in `demo/assets/icons/flowbite/`). Add `flowbite:calendar-month-outline` with `ux:icons:import` and commit it.
- **Credit.** Each README says "Built from the `<x>` recipe of the Symfony UX Toolkit shadcn kit (3.5.1, MIT)". `NOTICE` gets an entry: "Symfony UX, src/Toolkit/kits/shadcn: `popover`, `calendar`, `date-picker` are derived (not copied)".
- **No inline code.** Positioning writes `element.style` through the CSSOM, as `dropdown_controller.js` already does under the demo's CSP. No `style=""` attribute, no `<style>` element.

---

## PR 1: `popover`

**Recipe** `popover/`:
- `manifest.json`: type `component`, name `Popover`. It copies `assets/` and `templates/`. Composer: `twig/html-extra:^3.24.0`, `symfony/ux-twig-component:^3.5`, `tales-from-a-dev/twig-tailwind-extra:^1.3.0`.
- `templates/components/Popover.html.twig` props:
  - `id` (string|null): the base of the content and trigger ids. When missing, an id is generated, and the README says to pass one inside Live Components and Frames, as for Tooltip.
  - `name` (string|null): the group, so only one popover of the group is open at a time.
  - `open` (boolean).
  - `placement` (the same 12 values as `Dropdown`, default `bottom`).
  - `offsetDistance` (int, default 8).
- The root renders `data-controller="popover"` and `data-action` with:
  - `popover:open@window->popover#closeIfGrouped`;
  - `keydown.esc->popover#escape`;
  - `focusout->popover#closeOnFocusOut`;
  - `turbo:before-cache@document->popover#closeSilently`.

  These are Stimulus actions declared in markup and removed on disconnect. They are not global listeners. The root itself is `relative inline-block`.
- `Popover:Trigger` exposes `popover_trigger_attrs`, to spread onto a `Button`:
  - `type: button`, `id: <id>-trigger`;
  - `data-popover-target: trigger`, `data-action: click->popover#toggle`;
  - `aria-haspopup: dialog`, `aria-expanded`, `aria-controls: <id>-content`.
- `Popover:Content`:
  - prop `label` (string|null), which becomes `aria-label`; otherwise `aria-labelledby` points at the trigger;
  - renders `role="dialog"`, `id`, `tabindex="-1"`, `data-popover-target="content"`, `data-state`;
  - classes `hidden z-10 bg-neutral-primary-medium border border-default-medium rounded-base shadow-lg p-4 text-sm text-body w-72`.
- `assets/controllers/popover_controller.js`:
  - Values `open`, `name`, `placement`, `offsetDistance`. Targets `trigger`, `content`. Actions `toggle`, `show`, `close`, `closeIfGrouped`, `escape`, `closeOnFocusOut`, `closeSilently`.
  - **Open state** is `openValue` (an attribute), reflected as `data-state`, `aria-expanded` and the `hidden` class. Live's mutation tracker then keeps it open across re-renders, as it does for `dropdown`.
  - **Opening:** it shows the content and positions it, then adds `click` (capture) on the document, and `scroll` (capture) and `resize` on the window. It dispatches `popover:open` on the window when `name` is set. It dispatches a cancelable `popover:focus` (detail `{content}`) on the root. Unless that event is prevented, it focuses `[autofocus]`, else the first focusable element, else the content itself.
  - **Closing:** it removes those listeners. Escape (focus inside the root) closes and focuses the trigger. An outside click or focus leaving the root closes without moving focus. `closeSilently` (before Turbo caches the page) closes without focus or events. `disconnect()` removes every listener.
  - **Positioning:** copy `position()` from `dropdown/assets/controllers/dropdown_controller.js:118-174` verbatim (offset, flip, shift into the viewport along the trigger, containing-block origin, DPR rounding). The only change is the `data-placement` dataset key, with a comment naming the source so a later shared helper can replace both. `dropdown` and `tooltip` are untouched.
  - `connect()` can run again: no state outside the instance, and `open=true` positions the content on connect without stealing focus.
- `README.md`, in the house order:
  - examples: default, placements, group (`name`), with a form inside, open on render (for screenshots);
  - when to choose it: `dropdown` for menus (`role=menu`, arrow keys), `popover` for free content (non-modal dialog);
  - accessibility notes and the credit line.

**Demo and lab.**
- Lab scenarios:
  - `popover-turbo/{page}` (one|two): a plain popover, two grouped popovers, one inside `data-turbo-permanent`, and one inside a `<turbo-frame>` with a reload link.
  - `popover-stream` (GET/POST `action=replace|update`).
  - `live-popover`: `Lab:LivePopover` with a counter `#[LiveAction]` button inside the open content, served by the existing `live()` route.
- Specs `tests/e2e/popover.spec.ts`, which drives `/preview/popover/...`:
  - toggle, Escape returns focus to the trigger, outside click, focus out;
  - groups close each other;
  - flip near the bottom edge, shift at the right edge, following the trigger on scroll;
  - `type="button"` inside a form does not submit it.
- `lab.popover-turbo.spec.ts`:
  - open, visit page two, Back: the popover is closed, there is one controller, and it opens again;
  - three round trips: one `[data-controller~=popover]` per popover and one document `click` handler (open, then one outside click closes it exactly once);
  - the permanent popover still works after visits;
  - the frame reloaded three times still works.
- `lab.popover-stream.spec.ts`: after a stream replace and an update, the new popover works and the removed one left no listeners.
- `lab.live-popover.spec.ts`: a click on the action inside the open popover re-renders, the popover stays open and focus stays put.
- Add the lab paths to `labPages` in `a11y.spec.ts`. Add `/lab/popover-turbo/one` and `/preview/popover/default?theme=light` to the `pages` in `csp.spec.ts`.
- Screenshots: `--update-snapshots=missing` only. Open examples use `open`.

**Checks and docs.**
- Checks: kit lint, `ux-toolkit-kit-debug`, and contrast: add `body`/`neutral-primary-medium` (4.5) if not covered, and the focus ring.
- README *Components added by this kit*: `popover` ✦.
- CHANGELOG `### Added`.
- Agent snippet: "free content next to a control → `popover`; menus → `dropdown`".

---

## PR 2: `calendar`

**Recipe** `calendar/`:
- `manifest.json`: `recipe: ["button"]` (navigation). Composer: `twig/extra-bundle`, `twig/html-extra:^3.24.0`, `twig/intl-extra`, `symfony/ux-icons`, `symfony/ux-twig-component:^3.5`, `tales-from-a-dev/twig-tailwind-extra:^1.3.0`. Every constraint is a single range.
- `Calendar.html.twig` props: the shadcn set minus `buttonVariant`, plus three bridges.
  - Kept: `mode`, `name`, `selected`, `month`, `numberOfMonths`, `captionLayout`, `showOutsideDays`, `showWeekNumber`, `fixedWeeks`, `weekStartsOn`, `locale`, `today`, `disabled`, `minDate`, `maxDate`, `startMonth`, `endMonth`, `modifiers`, `label`.
  - `previousLabel` / `nextLabel` (default "Previous month" / "Next month") replace the hard-coded strings.
  - `model` (string|null), the **Live bridge**. It renders `data-model="on(change)|<model>"` on the hidden input (single), or `<model>[from]` / `<model>[to]` (range). It is a prop, not `data-model` on `<twig:Calendar>`: inside a Live Component, that attribute on a Twig component is read as parent→child model binding.
  - `inputAttr` (array): extra attributes on every hidden input (`form`, `disabled`, `data-*`). The names are escaped with `|e('html_attr_relaxed')`.
- Template changes:
  - strict `Y-m-d` parsing of every date prop (invalid values dropped, never thrown);
  - `modifiers` keys filtered;
  - plain `<button type="button">` for days;
  - the hidden inputs sit in a `data-slot="calendar-inputs"` container;
  - multiple mode also renders `<template data-calendar-target="inputPrototype">` holding a prototype input carrying `name[]`, `inputAttr` and `model`;
  - the weekday header cells get `data-slot="calendar-weekday"`, with the long name in `aria-label`, so JS can relabel them.
- `calendar_controller.js`: the shadcn logic is kept except for these changes.
  - **Fix 1.** `#syncInputs` runs whenever input targets exist, not only when `name` is set. For each hidden input whose value changes, it dispatches `input` then `change` (`bubbles: true`). It never dispatches on connect, or when an attribute change from the server already matches (no Live loop). `calendar:select` gains `detail.source` (`click`, `key`, `input`, `api`).
  - **Fix 3.** A shared `#invalidate()` resets `#rendered` and re-renders. It is called from `disabledValueChanged`, `minDateValueChanged`, `maxDateValueChanged`, `modifiersValueChanged`, `todayValueChanged`, `startMonthValueChanged`, `endMonthValueChanged` and `localeValueChanged`. Each is guarded by `#connected`. `localeValueChanged` also clears `#formatters` and relabels the weekday headers and month options through `Intl`. The selection is kept when bounds change: the server's validation is authoritative. Structural props (`numberOfMonths`, `showWeekNumber`, `fixedWeeks`, `weekStartsOn`, `captionLayout`) change only through a server re-render, and the README says so.
  - **Fix 4 (calendar side).**
    - New public methods `canSelect(date)` and `select(dates, source)`. `select` checks each date with `#isDisabled` and returns `false` without changing anything when one fails.
    - `selectDate` goes through them.
    - In range mode, a range that would contain a disabled day starts a new range at the clicked day (react-day-picker's `excludeDisabled`). `previewRange` stops at the same rule.
  - **Fix 5.** Multiple mode reuses existing inputs in order and updates their values. It clones `inputPrototype` for extra dates into the inputs container and removes the surplus. The name, `form`, `disabled` and Live attributes are kept, and so is the position.
  - `calendar_display_controller.js` is kept, with `@target`/`@action` docs.
- README:
  - examples ported with fixed `today` and `selected`, and classes instead of `style`: single, range, multiple, month and year dropdowns, presets, booked dates via `modifiers`, week numbers, RTL;
  - "Submitting with a form" (input names per mode);
  - "With Live Components" (the `model` prop, single and range);
  - accessibility and the credit line;
  - the requirement: PHP `intl` for locales other than `en` (`twig/intl-extra` → `symfony/intl`).

**Demo and lab.**
- `twig/intl-extra` is added to `demo/composer.json`.
- Lab scenarios:
  - `calendar-turbo/{page}`: inline calendars in single, range and multiple modes in a GET form that echoes the submitted values, one in `data-turbo-permanent`, one in a frame.
  - `calendar-stream`.
  - `live-calendar`: `Lab:LiveCalendar` with LiveProps `day` (single, `model="day"`) and `stay` (range). A select changes `minDay` and another changes `locale`, to test fix 3. A `clear` action checks that the server wins over the last click.
- Specs `tests/e2e/calendar.spec.ts`:
  - keyboard (arrows, Home/End, PageUp/Down, RTL swap);
  - each mode submits the right names;
  - fix 1: exactly one `input` and one `change` per pick, counted by a listener the test adds;
  - fix 4: no range across a disabled day;
  - fix 5: the `form`, `data-model` and `disabled` attributes stay on the multiple inputs after picks, and the order is kept;
  - day buttons do not submit the form.
- `lab.calendar-turbo.spec.ts` (Turbo gate):
  - pick, change month, visit away, Back: the snapshot shows the same month and selection, and the hidden values match;
  - repeated visits: one controller instance, one `change` per pick;
  - frame reloads, permanent visits.
- `lab.calendar-stream.spec.ts`: replace and update.
- `lab.live-calendar.spec.ts`:
  - a pick updates the LiveProp and survives the re-render;
  - a range sends both ends;
  - changing `minDay` disables the earlier days without a reload;
  - a locale change relabels the grid;
  - `clear` empties it;
  - no duplicate hidden inputs after re-renders.
- `a11y.spec.ts` `labPages`; `csp.spec.ts` pages.
- `HostilePropsCommand`: hostile `modifiers` keys and `inputAttr` names.
- Contrast rows:

  | fg | bg | min | usage |
  |---|---|---|---|
  | `body-subtle` | `neutral-primary` | 4.5 | outside days and weekday headers on the page |
  | `body-subtle` | `neutral-primary-medium` | 4.5 | the same inside a popover |
  | `heading` | `neutral-tertiary` | 4.5 | today |
  | `fg-brand-strong` | `brand-softer` | 4.5 | range middle (already present) |
  | `brand` | `neutral-primary-medium` | 3 | focus ring in a popover |

**Checks and docs.**
- CI: add `extensions: intl` explicitly to the `setup-php` steps that render templates (Playwright, fresh-install).
- README row `calendar` ✦, plus the `intl` line under *Requirements*.
- CHANGELOG `### Added`.

---

## PR 3: `date-picker` plus the form theme and Live wiring

**Recipe** `date-picker/`:
- `manifest.json`: `recipe: ["calendar", "popover"]`. Composer: the same as `calendar`.
- `DatePicker.html.twig`:
  - The root hosts `popover date-picker` and reuses the popover's attributes and actions. It adds `calendar:select->date-picker#select` and `popover:focus->date-picker#focusDay`.
  - Props:
    - `id`;
    - `selected` (still needed for the server-rendered text);
    - `locale`;
    - `dateStyle` (`full`/`long`/`medium`/`short`, default `medium`);
    - `separator`;
    - `closeOnSelect`;
    - `open`;
    - `placement` (default `bottom-start`).
  - Content positioning comes from the popover controller.
- Parts:
  - `DatePicker:Trigger` (`date_picker_trigger_attrs`, with `type: button` and `aria-controls`).
  - `DatePicker:Input` (`date_picker_input_attrs`, with `input->date-picker#parseInput`, `change->date-picker#commitInput` and `keydown.down->date-picker#open`).
  - `DatePicker:Value` (`placeholder`).
  - `DatePicker:Content` (props `label`; it wraps `Popover:Content` with `p-0 w-auto`).
- `date_picker_controller.js`:
  - `connect()` reads `data-calendar-selected-value` from the nested calendar element and reflects it. A Turbo snapshot restores attributes, not typed `.value`.
  - **Fix 1:** `#reflect` writes the visible text without events. The visible input has no `name`, so the hidden ISO inputs are the only form values.
  - **Fix 2:**
    - on `input`, empty text clears the selection right away;
    - valid text selects;
    - partial or invalid text changes nothing while the user types;
    - on `change` (blur, Enter), invalid text clears the selection, keeps the typed text and sets `aria-invalid="true"` until a valid pick;
    - clearing dispatches `change` on the hidden input (fix 1).
  - **Fix 3:** `localeValueChanged`, `dateStyleValueChanged` and `separatorValueChanged` reset `#formatter` and reflect again.
  - **Fix 4:** typed dates go through `calendar.select([date], 'input')`. A date the calendar refuses (disabled or out of bounds) counts as invalid (fix 2). The `#pushed` echo hack is replaced by `detail.source`. Typing applies in single mode only. In range and multiple modes the README tells you to use a trigger, not `DatePicker:Input`.
  - **Parsing:** `#parse` accepts:
    - ISO `Y-m-d`;
    - the locale's numeric day/month/year order, taken from `Intl.DateTimeFormat(locale).formatToParts`, with separators `/ . -` and a four-digit year;
    - the exact formatted text of the current selection.

    Everything is computed in UTC, and `Date.parse` is not used.
  - `focusDay` prevents `popover:focus` and focuses the calendar's roving day.
- README examples (fixed `today`):
  - button trigger;
  - input plus icon trigger (`flowbite:calendar-month-outline`);
  - range;
  - date of birth with dropdown captions;
  - a time field beside the picker with a native `<twig:Input type="time">`;
  - RTL.

  Sections:
  - "Submitting";
  - "With Live Components" (`model` on the `Calendar`);
  - "With Symfony forms" (pointing to the form theme);
  - "Times: use native `type="time"` / `TimeType` `single_text`";
  - "Native `type="date"` still works".

**Form theme** (`form-theme/templates/form/flowbite_layout.html.twig`):
- Opt-in per field through Symfony's `block_prefix` option, with no PHP:
  ```php
  ->add('startsOn', DateType::class, ['widget' => 'single_text', 'block_prefix' => 'flowbite_date_picker'])
  ```
- New block `flowbite_date_picker_widget`, with a `{##- -#}` doc. It falls back to `block('date_widget')` unless `widget == 'single_text'` and `type == 'date'` (html5).
- Otherwise it renders:
  - `<twig:DatePicker id="{{ id }}_picker">`;
  - a `<twig:Input>` with the field's `id` (so the label's `for` works), no `name`, the field's `attr` minus `min` and `max`, and `aria-describedby`/`aria-invalid` from the row, `disabled`, `required`, `autocomplete="off"`;
  - an icon trigger whose label is `'Choose date'`, translated with `translation_domain` and overridable through the `picker_label` var;
  - `<twig:Calendar mode="single" :name="full_name">`:
    - `selected`: the value only when the field has no errors (a raw invalid submission is shown as text and never parsed by Twig);
    - `minDate`/`maxDate` from `attr.min`/`attr.max`;
    - `inputAttr: {disabled}`.
- `form-theme/manifest.json` gains **no** dependency. The block resolves `<twig:DatePicker>` only when rendered, so plain form-theme installs (login, signup, the fresh-install tests) do not pull in intl. The form-theme README says the opt-in needs `ux:install date-picker`, and that min/max are UX only: validate with constraints (`Range`, `GreaterThan`).
- Native `type="date"` fields and `TimeType` `single_text` stay as they are (`form_widget_simple` → `Input`).

**Live wiring (documented and tested).**
- A form in a Live Component (`data-model="on(change)|*"` on `<form>`): the picker's hidden input has the field's `name`, and its `change` event updates `form.<field>`. The visible input has no name, so Live ignores it.
- A plain LiveProp: `<twig:Calendar model="startsOn" …>`. Never `data-model` on `<twig:Calendar>` or `<twig:Input>`.

**Demo and lab.**
- `/forms`: `DemoType` gains `startsOn` (opted in, `min` today) next to `birthday` (native). `/forms/parity` gets its hand-written twin. Update `forms.spec.ts`: a valid pick posts and gets 303; invalid typed text gets 422 with the field error and no Twig exception.
- Lab scenarios:
  - `date-picker-turbo/{page}`: a picker in a form, in `data-turbo-permanent`, and in a frame;
  - `date-picker-stream`;
  - `live-date-picker`: `Lab:LiveDatePicker` (`ComponentWithFormTrait`), with start and end opted-in DateTypes; the end's `min` follows the start on re-render.
- Specs `tests/e2e/date-picker.spec.ts`:
  - open by click and by ArrowDown, with focus on the selected day;
  - a pick closes, the text shows and the hidden ISO value is set;
  - fix 2: clearing the text empties the hidden input; invalid text then blur clears and sets `aria-invalid`;
  - fix 4: a typed disabled or out-of-bounds date is refused;
  - Escape returns focus to the trigger;
  - flip near the viewport edge;
  - day buttons do not submit.
- `lab.date-picker-turbo.spec.ts`:
  - pick, visit away, Back: the text, hidden value and calendar agree, and the popover is closed;
  - repeated visits: one controller per element, one `change` per pick;
  - frame and permanent cases.
- `lab.date-picker-stream.spec.ts`: replace and update.
- `lab.live-date-picker.spec.ts`:
  - a pick reaches Live (validation message appears or clears);
  - changing the start re-renders the end's bounds (fix 3);
  - the popover and the selection survive re-renders, with no duplicate inputs.
- `a11y.spec.ts` `labPages`, `/forms`; `csp.spec.ts` pages.
- `PreviewForms` gets a form for any form-theme README example that previews the picker.
- `tools/tests/fresh-install.sh`: install `date-picker` (its suggested `composer require` runs, including `twig/intl-extra`) and render an opted-in DateType.

**Docs.**
- README row `date-picker` ✦.
- The form-theme README section.
- CHANGELOG `### Added` (date-picker) and `### Changed` (form-theme opt-in).
- `docs/PROJECT-AGENTS-SNIPPET.md`: "Dates: `ux:install date-picker`. Form fields: `DateType` with `'widget' => 'single_text', 'block_prefix' => 'flowbite_date_picker'`, plus server-side constraints for bounds. Live: `model` prop on `Calendar`, never `data-model` on a `<twig:…>` component. Times: native `type="time"`."
- README *Turbo and Live Components*: one line on the date picker's events and Live bridge.

---

## PR split and reasoning

1. **`popover`.** It is self-contained, and both later recipes need it. The positioning copy and the Turbo/Live gate for a floating element get reviewed once.
2. **`calendar`.** It is useful on its own (inline booking or availability) and holds most of the code (~500 lines of JS), plus fixes 1, 3 and 5 and the Live `model` bridge. Reviewed without popover or form noise.
3. **`date-picker` plus the form theme.** It composes the first two and holds fixes 2 and 4 (input side), the form-theme opt-in and the `/forms` changes.

Each PR is green on its own: lint, debug, contrast, PHP checks where PHP changes, fresh installs, and Playwright (CSP, a11y, labs). New screenshots only with `--update-snapshots=missing`, and no existing baseline changes. The Codex reviews are requested once per PR, at the first green CI: two separate comments, `@codex review` and `@codex security review`. Plain-words commits, no AI attribution lines.

## Out of scope

- A time picker.
- Range fields through the form theme (two DateTypes or a compound type).
- `DateTimeType` opt-in.
- Natural-language parsing (chrono-node: README pointer only).
- A positioning helper shared with `dropdown`/`tooltip`.
- Turbo 8 refresh morph.

## Decisions (2026-10-07)

1. **Multiple mode with Live:** documented, not built. For several dates inside a Live Component, submit through a Live
   action; single dates and ranges bind with the `model` prop.
2. **Focus leaving the popover closes it** (Radix-like), as do Escape and an outside click.
3. **Before Turbo caches the page**, an open popover closes through a `turbo:before-cache@document->popover#closeSilently`
   action in the markup (a Stimulus action, removed on disconnect); CONTRIBUTING's conventions name it as allowed.
