---
status: shipped
recipes: autocomplete
---

# Plan: B. searchable choices

_2026-10-07. Implements the B decision in [`ROADMAP.md`](ROADMAP.md): UX Autocomplete (Tom Select), styled with the
theme and the form theme. Draft: the open questions at the end come first._

## What UX Autocomplete 3.5.1 brings (read in its source at the v3.5.1 tag)

- A form option: `'autocomplete' => true` on a `ChoiceType`/`EntityType` (or `AutocompleteChoiceType`, any data source
  through `AutocompleterInterface`, new in 3.5) adds `data-controller="symfony--ux-autocomplete--autocomplete"` and its
  values to the field's `attr`. Remote search goes through its own route (`autocomplete_url`).
- Our form theme already forwards every `attr` to `<twig:Select>` (`flowbite_control` in
  `form-theme/templates/form/flowbite_layout.html.twig`), so an autocomplete field renders through the kit unchanged.
- The Stimulus controller destroys Tom Select on `disconnect()` (keeping the selected values) and marks the `<select>`
  `data-skip-morph` for Live Components.
- Its package autoimports `tom-select/dist/css/tom-select.default.css` (`assets/package.json`, `symfony.controllers`
  `autoimport`), switchable in the app's `assets/controllers.json`.

## Deliverable: an `autocomplete` recipe

- `assets/styles/uxor-autocomplete.css`: Tom Select styled with the theme's roles (`.ts-wrapper`,
  `.ts-control`, `.ts-dropdown`, options, active, selected items and their remove buttons, loading, no results,
  disabled, invalid), light and dark, imported after `uxor.css`.
- README: install (`composer require symfony/ux-autocomplete`, the CSS import, the `controllers.json` autoimport
  setting), form usage (`'autocomplete' => true`, multiple, `tom_select_options`, remote with
  `AutocompleteChoiceType`/`#[AsEntityAutocompleteField]`), and use outside a form.
- Dependencies: `form-theme`, `select`; Composer `symfony/ux-autocomplete:^3.5`.
- If a Turbo gate test shows Tom Select wrapped twice after a Turbo cache restore: a small `autocomplete-turbo`
  controller (or a documented `turbo:before-cache` handler) that destroys it before the snapshot. Only if the test
  fails; not built ahead.

## Demo and lab

- `symfony/ux-autocomplete` in the demo (Composer and import map; `tom-select` added through `importmap:require`).
- `/forms` gains autocomplete fields: single, multiple, tags, remote (`AutocompleteChoiceType` over in-memory data).
- `/lab/autocomplete`: Turbo visit away and Back (no second wrapper), repeated visits, in a Turbo Frame, in a Live
  form re-render, Turbo Stream replace, CSP, a11y, keyboard (open, type, arrows, Enter, Escape), selected values
  submitted.
- README screenshots in light and dark.

## Checks

The kit lint, PHPStan (the remote example's PHP), the fresh-install tests (install `autocomplete`, render a form with
an autocomplete field), Playwright, contrast pairs for the new surfaces.

## Decisions (2026-10-07)

1. Styling: **replace** Tom Select's default CSS with the recipe's stylesheet (`tom-select.default.css` autoimport off).
2. Testing: Tom Select's browser behavior is tested **in CI only** (this sandbox cannot reach jsDelivr).
3. Use outside forms: a `<twig:Autocomplete>` component (props `url`, `minCharacters`, `options`, `multiple`, the rest
   passed to `Select`); inside Live Components, the form option.
4. Tom Select stays (not ported): the hidden `<select>` keeps its label's name through `aria-labelledby`, set by the
   form theme and the component, rather than a kit Stimulus controller.
