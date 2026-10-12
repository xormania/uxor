---
status: shipped
recipes: dropzone
---

# Plan: E2. Files

_2026-10-08. This plan implements the E2 decision in [`ROADMAP.md`](ROADMAP.md): UX Dropzone, styled with the theme and wired into the form theme. The default path is a Turbo-submitted multipart form. A Live Component uses a `files` action. Queues, resumable uploads and image processing are out of scope. Decided with the user on 2026-10-08: the recommended answers to the open questions at the end, including automatic wiring for every `DropzoneType` (4) and, in Live Components, only `<twig:Dropzone>` with a `files` upload action (7). Delivery is two pull requests: (1) the `dropzone` recipe and its Turbo gate, then (2) the form-theme wiring, the server side and the Live lab._

## Sources read (symfony/ux-dropzone **v3.5.1**, 2026-09-19, `symfony/ux` tag `v3.5.1`, `src/Dropzone/`)

`demo/vendor/` does not contain the package. The demo's other UX packages are at 3.5.1 (`demo/composer.lock`). Read from packagist and `raw.githubusercontent.com` at the tag: `composer.json`, `assets/package.json`, `src/Form/DropzoneType.php`, `templates/form_theme.html.twig`, `src/DependencyInjection/DropzoneExtension.php`, `assets/src/controller.ts`, `assets/dist/controller.js`, `assets/src/style.css`, `doc/index.rst` and `CHANGELOG.md`. Multiple files and `remove_label` are new in 3.5.0, so the constraint is `^3.5`.

| Part | What it does |
|---|---|
| `DropzoneType` | Its parent is `FileType` and its block prefix is `dropzone`. It sets the default `attr: {placeholder: 'Drag and drop or browse'}`; passing any `attr` option replaces that default, so the placeholder disappears. It adds the `remove_label` option (default `'Remove'`) and copies `multiple` and `remove_label` into the view. `FileType` already sets `type=file` and `value=''`, adds `[]` to `full_name` and `attr.multiple` when multiple, and sets `multipart=true`, so `form_start` prints `enctype="multipart/form-data"`. `vars.data` still holds the submitted `UploadedFile` (or an array of them). |
| Bundle | `prepend()` puts `@Dropzone/form_theme.html.twig` in front of `twig.form_themes` and maps `assets/dist` as `@symfony/ux-dropzone`. The app's own themes come after it, so a `dropzone_widget` block in `form/flowbite_layout.html.twig` wins. So does `{% form_theme form … %}`. **There is no Flex recipe.** Flex should still register the bundle (it is a `symfony-bundle`) and sync `controllers.json` and the import map (the package has the `symfony-ux` keyword). The fresh install verifies this. |
| Package `dropzone_widget` | `div.dropzone-container[data-controller="symfony--ux-dropzone--dropzone"]`, holding: `input[type=file]` (all `widget_attributes`, **including `placeholder`**, plus an empty `data-controller=""`); `div.dropzone-placeholder`; `div.dropzone-preview` **`style="display: none"`** with an empty `button.dropzone-preview-button` (no text, no `aria-label`), `div.dropzone-preview-image` **`style="display: none"`** and `div.dropzone-preview-filename`; and, when multiple, `ul.dropzone-preview-list`. |
| Controller (`symfony--ux-dropzone--dropzone`) | Targets `input`, `placeholder`, `preview`, `previewClearButton`, `previewFilename`, `previewImage`, `previewList`. Values `multiple`, `removeLabel`. **Single mode:** `connect()` calls `clear()`, which empties `input.value` and dispatches `dropzone:clear` **on every connect**. It adds listeners to the input, the clear button and the root (dragenter, dragleave, drop), and removes them on disconnect. A pick hides the input (`style.display='none'`), shows the preview (`flex`) and dispatches `dropzone:change` with the `File`. `dragenter` shows the input again (`block`), and `dragleave` sets the preview to **`block`**. **Multiple mode:** it keeps a `DataTransfer` seeded from `input.files` on connect and appends new picks (deduplicated by name, size and mtime). It rebuilds the `<li>` items with `replaceChildren`, using fixed classes `dropzone-preview-list-item`, `dropzone-preview-image`, `dropzone-preview-filename` and `dropzone-preview-list-remove`. The remove button is empty, with `aria-label="<removeLabel> <file name>"`. Removing a file dispatches `change` (with the `FileList`), then `dropzone:remove` (with the `File`). Multiple mode has no `clear` and no drag listeners. File names go through `textContent`. All events bubble, with the `dropzone:` prefix. |
| Image preview | `FileReader.readAsDataURL`, then `style.backgroundImage = url("data:…")` through the CSSOM. That load falls under **`img-src data:`**. **No `blob:` URL is used.** |
| Default CSS | Autoimported `@symfony/ux-dropzone/dist/style.min.css` (hard-coded `#bbb`/`#999`, `×` drawn by `::before`). It can be turned off in `controllers.json`. |

### What this means for the kit

| # | Finding | Consequence |
|---|---|---|
| 1 | The package's theme prints `style="display: none"` twice | Under the demo's policy (no `style-src-attr`), this is a **CSP violation**, and the preview would show empty at rest. We **must** render our own `dropzone_widget`. |
| 2 | The controller writes `element.style.display` and `backgroundImage` through the CSSOM | The CSP allows this, as it already does for `dropdown` positioning. Our markup must accept these inline values: a target's own `display` is overwritten (`block`/`flex`/`none`), so layout belongs in **inner wrappers**. Targets are found anywhere under the controller element. |
| 3 | The empty single clear button (no accessible name) | axe raises `button-name` (critical) once a file is picked. Our markup puts an sr-only label and an icon inside it. The controller never touches the button's content. |
| 4 | A pick hides the focused input; Remove hides the focused button | Keyboard and screen-reader users lose focus. Multiple mode re-renders the list, so removing an item loses focus too. |
| 5 | No drag-over state, and in multiple mode dropping on the list (outside the input) | There is no visual cue while dragging. A drop outside the input lets the browser **open the file in the tab** and lose the form. |
| 6 | `connect()` clears (single) and rebuilds from `input.files` (multiple) | A Turbo snapshot restore, a Stream replace or a re-insert starts empty, which is correct because browsers never restore file inputs. A `data-turbo-permanent` node keeps its files. |
| 7 | Live: `syncInputValue` skips file inputs. JS-added nodes and style changes survive a morph (external mutation tracker). After a `files|action` request, Live sets `input.value = ''` without an event | After an upload the dropzone would still show the old preview, so the zone must be **re-created** after an upload (see *Live rule*). A `ComponentWithFormTrait` form submits `formValues` only (`$form->submit($this->formValues)`), so **a file never reaches a Live form's `FileType`**. |
| 8 | Kit lint `stimulus.controller.missing` greps literal `data-controller` values | Put the package controller's name in a variable, as `Autocomplete.html.twig` does. |

## Deliverable: a `dropzone` recipe (PR 1)

**`dropzone/manifest.json`**
- This kit's `$schema` line, `type: component`, `name: Dropzone`.
- `copy-files`: `{"assets/": "assets/", "templates/": "templates/"}`.
- `recipe: ["form-theme"]`, as `autocomplete` does: form use works out of the box, and `form-theme` brings `form-field` and `label` for the examples.
- Composer: `symfony/ux-dropzone:^3.5`, `symfony/ux-icons`, `symfony/ux-twig-component:^3.5`, `twig/html-extra:^3.24.0`, `tales-from-a-dev/twig-tailwind-extra:^1.3.0`. Single ranges only.

**`dropzone/templates/components/Dropzone.html.twig`**

Props, each with its `##` line:
- `multiple` (bool): several files that accumulate across picks.
- `placeholder` (string|null, default `'Drag and drop or browse'`): the main line.
- `hint` (string|null): a second, smaller line, such as "PNG or JPG, up to 2 MB".
- `removeLabel` (string, default `'Remove'`).
- `reselect` (string|null): a note shown inside the box. The form theme sets it after a 422, and its id joins the input's `aria-describedby`.

Block `content` (`{##- -#}` doc): replaces the inside of the placeholder (icon and lines) for a custom look.

Attributes:
- `class` goes to the root, merged with `tailwind_merge`.
- **Every other attribute goes to the `<input type=file>`**: `id`, `name`, `accept`, `required`, `disabled`, `form`, `capture`, `aria-*`, `data-*`. This mirrors `Autocomplete` → `Select`.
- A `data-controller` given by the caller is moved to the root and merged, as the package's theme does, so the package docs' "extend with your own controller" still works.
- An `id` is required for the label. The README says to pass a stable one, as for `Tooltip`.

Markup (no `style`, no inline handler):
- **Root** `div`:
  - `data-controller` = `{{ controller }} dropzone-assist`, where `controller` is a variable holding `symfony--ux-dropzone--dropzone`;
  - literal `data-symfony--ux-dropzone--dropzone-multiple-value` and `…-remove-label-value`;
  - the assist actions (below).
- **Box** `div` (the drop area):
  - Flowbite look: `relative flex min-h-36 w-full items-center justify-center rounded-base border-2 border-dashed border-default-strong bg-neutral-secondary-medium p-4 text-center`, plus `hover:bg-neutral-tertiary-medium` (subject to the contrast row below);
  - focus: `has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-brand-medium has-[input:focus-visible]:border-brand`;
  - error: `has-[input[aria-invalid=true]]:bg-danger-soft has-[input[aria-invalid=true]]:border-danger-subtle`;
  - drag: `group-data-dragging:bg-brand-softer group-data-dragging:border-brand`, through `group` on the root;
  - disabled: `has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60`.
- **Input** (package target `input`, assist target `input`):
  - classes `absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed`;
  - the forwarded attributes. `placeholder` is never printed on the input (it is invalid on `type=file`).
- **Placeholder** (package target `placeholder`; the controller sets `block`/`none`) holds an inner `flex flex-col items-center gap-2`:
  - `<twig:ux:icon name="flowbite:cloud-arrow-up-outline" class="size-8 text-body" aria-hidden="true">`;
  - `<p class="text-sm text-body">` with the placeholder in `font-semibold text-heading`;
  - the optional hint `<p class="text-xs text-body">`;
  - the optional `<p id="<id>_reselect" class="text-sm text-fg-danger-strong">`.
- **Preview** (package target `preview`, rendered with the `hidden` class; the controller sets `flex`, `block` or `none`) holds an inner `flex w-full items-center gap-3 text-start`:
  - `previewImage` target: `hidden size-12 shrink-0 rounded-sm bg-contain bg-center bg-no-repeat`, with `aria-hidden="true"`;
  - `previewFilename` target: `id="<id>_filename"`, `min-w-0 flex-1 break-anywhere text-sm font-medium text-heading`;
  - `previewClearButton` target: `type="button"`, `relative z-20`, a kit `Button` ghost/icon look, `aria-labelledby="<id>_remove <id>_filename"` (so it reads "Remove photo.png", as multiple mode does), containing `<span id="<id>_remove" class="sr-only">{{ removeLabel }}</span>` and the `flowbite:close-outline` icon. Assist target `clearButton`.
- **List**, when multiple (package target `previewList`, assist target `list`): a `<ul>` **after the box** (not inside it, so drops there hit the guard), with `mt-3 space-y-2` and `aria-live="polite"`.

**`dropzone/assets/styles/uxor-dropzone.css`** styles only the elements the controller builds in JavaScript (fixed class names), with the theme's CSS variables, as the autocomplete stylesheet does:
- `.dropzone-preview-list-item`: flex row, gap, `--color-neutral-secondary-medium` background, `--color-default-medium` border, `--radius-base`, padding.
- `.dropzone-preview-image`: 2.5rem, `contain`, centered. It is empty until the controller sets `display:block` and the background.
- `.dropzone-preview-filename`: `--color-heading`, `overflow-wrap: anywhere`, flex 1.
- `.dropzone-preview-list-remove`:
  - 2rem square, `--radius-sm`, `--color-body`;
  - hover `--color-neutral-tertiary-medium`;
  - `:focus-visible` outline in `--color-brand-medium`;
  - the icon through `::before { mask: url("data:image/svg+xml,…close…") }` filled with `currentColor`. The kit's `Select` chevron already needs `data:` images.
- The README makes the import (after `uxor.css`) and the `controllers.json` change (`"@symfony/ux-dropzone/dist/style.min.css": false`) mandatory, as for autocomplete.

**`dropzone/assets/controllers/dropzone_assist_controller.js`** (identifier `dropzone-assist`). It is kit behavior next to the package controller, which it never patches. It has `@target`, `@value` and `@action` docs, takes no global state, and its `connect()` can run again.
- Targets: `input`, `clearButton`, `list`.
- Actions, declared in the template and removed on disconnect:
  - `dragenter` and `dragover` set `data-dragging` on the root. On `dragover`/`drop` outside the input, they call `preventDefault()`, so the browser never opens the file.
  - `dragleave` (with `relatedTarget` outside the root) and `drop` remove `data-dragging`.
  - `change->dropzone-assist#remember:capture` on the root records whether the input had focus, before the package listener on the input hides it.
  - `dropzone:change->dropzone-assist#changed`: in single mode, if the input had focus, focus `clearButton`. Its name, "Remove photo.png", tells a screen reader what was picked.
  - `click->dropzone-assist#clearing:capture` on `clearButton` sets a flag. At the target, capture runs before the package's bubbling listener. Then `dropzone:clear->dropzone-assist#cleared` focuses the input only when the flag is set. The `clear` dispatched by `connect()` never moves focus.
  - `click->dropzone-assist#removing:capture` on `list` records the index of the clicked item. Then `dropzone:remove->dropzone-assist#removed` focuses the remove button now at that index, else the last one, else the input.
- `disconnect()` removes `data-dragging` and resets the flags.

**`dropzone/README.md`**, in the house order.

Examples (`{"preview":true}`, each with an `id`):
- default (single, in a `FormField` with a label);
- with a hint and `accept="image/png,image/jpeg"`;
- multiple;
- invalid (`aria-invalid="true"` and a `FormField` error);
- disabled;
- custom content (block).

Sections:
- `## Installation` (`::: installation`), then the `composer require` step, the CSS import and `controllers.json`.
- `## Usage`:
  - "In a Symfony form" (below);
  - "Saving the files": the Symfony pattern with `guessExtension()`, a slugged name and `move()` outside `public/`, and never trusting the client name or type;
  - "Limits": the constraints decide; PHP's `upload_max_filesize` and `post_max_size` come first, and over `post_max_size` PHP drops the whole request and the form shows `upload_max_size_message` at the top;
  - "Outside a form": a hand-written `<form method="post" enctype="multipart/form-data">`. **Without `enctype`, Turbo sends no file.** `name="files[]" multiple`.
  - "With Turbo": 303/422, files cannot be refilled after a 422, permanent elements keep their files.
  - "With Live Components" (the rule below);
  - "Events": `dropzone:connect`, `change`, `clear`, `remove`;
  - "Content Security Policy": image previews need `img-src data:`, and the package's own form theme is never used;
  - "Accessibility".

**Screenshots.** For README examples: `--update-snapshots=missing` only. For picked states: `dropzone/tests/dropzone.spec.ts` (excluded from `ux:install`, ported by `playwright.config.ts`) uses `testState()`:
- `default` / `picked-image`: `setInputFiles` with a 1×1 PNG buffer, waiting for the background;
- `multiple` / `picked-three`;
- `default` / `dragging`: a synthetic `dragenter`.

That gives `<example>-<state>-light|dark.png`, which `baselines.spec.ts` already accounts for.

**Contrast** (`tools/contrast/pairs.json`), new rows:

| fg | bg | min | usage |
|---|---|---|---|
| `body` | `neutral-tertiary-medium` | 4.5 | dropzone text while hovered |
| `body` | `danger-soft` | 4.5 | dropzone text in an invalid field |
| `brand-medium` | `neutral-secondary-medium` | 3 | dropzone focus ring |

Rows already present: `body`/`neutral-secondary-medium`, `heading`/`neutral-secondary-medium`, `fg-brand-strong`/`brand-softer` (drag-over) and `fg-danger-strong`/`neutral-primary` (the reselect note).

Risk: in dark mode, gray-400 on gray-700 may miss 4.5. If it does, hover uses `neutral-tertiary`, and that row replaces the first.

**Icons.** Run `ux:icons:import flowbite:cloud-arrow-up-outline` and commit it under `demo/assets/icons/flowbite/`. `close-outline` is already there.

**Hostile props.** None: there is no tag, URL or attribute-name prop, and attribute names come from the caller as with `Autocomplete`. The README's *Security* paragraph says so.

## Form-theme wiring (PR 2)

- **Automatic for `DropzoneType`; plain `FileType` stays the native `Input type=file`.** Add a block to `form-theme/templates/form/flowbite_layout.html.twig`:
  ```twig
  {##- A `DropzoneType` (symfony/ux-dropzone): the dropzone recipe's widget, rendered from its own template; without that recipe, the kit's file Input. -#}
  {%- block dropzone_widget -%}
      {%- set _dropzone = include('form/flowbite_dropzone_widget.html.twig', ignore_missing = true) -%}
      {%- if _dropzone|trim is empty -%}{{- block('form_widget_simple') -}}{%- else -%}{{ _dropzone }}{%- endif -%}
  {%- endblock dropzone_widget -%}
  ```
  The template comes from the recipe (the `date-picker/templates/form/` precedent), and `form-theme/manifest.json` gains no dependency. The block only renders for a `DropzoneType`, so apps without the package never reach it. Because this block wins over `@Dropzone/form_theme.html.twig`, **the package's markup and its `style` attributes never render**.
- **`dropzone/templates/form/flowbite_dropzone_widget.html.twig`** (header comment as in the date-picker one):
  - Input attributes as `flowbite_control` builds them:
    - `id`, `name: full_name`, `disabled`, `required`;
    - every `attr` except `placeholder`, `data-controller` and `class`, with `title` translated;
    - `aria-describedby`/`aria-invalid`, already merged into `attr` by `flowbite_row`.
  - `attr.class` goes to the root, and `attr['data-controller']` is merged into the root's.
  - `placeholder`: `attr.placeholder` translated, else the component default (this covers an `attr` option that replaced the type's default).
  - `removeLabel`: `remove_label|trans` unless `translation_domain` is false.
  - **422 note:** when the form was submitted, this field has no error and `data` is not empty (the user picked valid files that other errors threw away), set `reselect`:
    - single: `'%name% was not kept: choose it again.'` with `data.clientOriginalName`;
    - multiple: `'%count% files were not kept: choose them again.'`.

    It is translated with the field's domain and overridable through a `reselect_message` var. Its id `<id>_reselect` is appended to `aria-describedby`.
  - A field with errors shows only its errors (the box turns to the error state through `aria-invalid`).
  - Renders `<twig:Dropzone :multiple="multiple" …>`.
- **Label, help, errors:** `form_row` → `FormField for=id`, so the label's `for` points at the file input (a click opens the picker), help is `<id>_help` and errors are `<id>_error`. The input gets `aria-describedby` = help, error and reselect, and `aria-invalid`. Form-level errors (the `post_max_size` case) print through `form_errors(form)` at the top of the root.
- **Multiple:** `'multiple' => true` gives `name="form[field][]"`, the accumulated `FileList` and per-file Remove. Validate with `new Assert\Count(max: 3)` plus `new Assert\All([new Assert\File(maxSize: '1M', extensions: ['pdf', 'txt'])])`.
- **What an agent writes** (the README and the snippet):
  ```php
  ->add('photo', DropzoneType::class, [
      'required' => false,
      'help' => 'PNG or JPG, up to 1 MB.',
      'attr' => ['accept' => 'image/png,image/jpeg', 'placeholder' => 'Drop a photo or browse'],
      'constraints' => [new Assert\Image(maxSize: '1M', mimeTypes: ['image/png', 'image/jpeg'])],
  ])
  ```
  The controller is the usual one: `handleRequest`, `getData()` returns `?UploadedFile`, then a 303 on success and `render()` (422) on errors. There is no template code, because `form(form)`/`form_start` adds the enctype.
- `form-theme/README.md`: a "File uploads" bullet (automatic for `DropzoneType` once the `dropzone` recipe is installed; `FileType` stays a native input; the reselect note).

## Live rule (proved in the lab)

1. **Keep the dropzone out of re-rendered regions.** A Turbo form with a `DropzoneType` next to a Live Component keeps its files whatever the component does.
2. **Inside a Live Component, upload through a `files` action first.**
   - Use `<twig:Dropzone id="photos" name="photos[]" multiple />`, never a `DropzoneType` in a `ComponentWithFormTrait` form (its files never reach the form).
   - Add a button with `data-action="live#action" data-live-action-param="files(photos[])|upload"`.
   - The `#[LiveAction] upload(Request $request, ValidatorInterface $validator)` reads `$request->files->all('photos')`, validates (`All([Image(maxSize: '1M')])`, `Count(max: 3)`), stores the files, and keeps their ids or names in a LiveProp. The rest of the form then submits those ids.
   - Wrap the dropzone in `<div id="photos-{{ uploadCount }}" data-live-ignore>`. Unrelated re-renders leave it alone (`data-live-ignore`). After an upload the new id makes Live replace its content (the `fromEl.id !== toEl.id` branch runs before the ignore check), so the package controller reconnects empty instead of showing a stale preview over an input Live has emptied.

   The lab must prove both halves. If the id branch does not re-create the controller element, fall back to dispatching a reset from the action's re-render (decided in PR 2, test first).

## Demo

- `demo/composer.json` and `composer.lock`: add `symfony/ux-dropzone: ^3.5`. Also update `config/bundles.php` (`Symfony\UX\Dropzone\DropzoneBundle`), `importmap.php` (`@symfony/ux-dropzone` path) and `assets/controllers.json` (`dropzone` enabled, style autoimport `false`).
- `demo/assets/styles/app.css`: `@import "../../../dropzone/assets/styles/uxor-dropzone.css";`.
- **Deterministic PHP limits:**
  - Playwright's `php -S` command gets `-d upload_max_filesize=2M -d post_max_size=8M`;
  - `demo/frankenphp/conf.d/10-app.ini` gets the same two lines.
- `/forms`:
  - `DemoType` gains `photo` (single, `Image(maxSize: '1M', mimeTypes: png/jpeg)`, help) and `attachments` (multiple, `Count(max: 3)` + `All([File(maxSize: '1M', extensions: ['pdf', 'txt', 'png'])])`), both optional.
  - `/forms/parity` gets a `photo` pair: the theme row next to a hand-written `FormField` + `<twig:Dropzone>`. Add `photo` to `pairs` in `forms.spec.ts`.
- `src/Form/UploadDemoType.php`: `photo` + `attachments`, for the lab.
- **Lab scenarios** (`LabController::SCENARIOS`, routes, `templates/lab/`):
  - `dropzone-turbo/{page}` (one|two, GET/POST):
    - a Turbo POST form (`UploadDemoType`) whose success is a 303 to `?submitted=photo=tiny.png; attachments=a.txt,b.txt` and whose errors are a 422;
    - a `Lab:PermanentCounter` Live Component beside it (rule 1);
    - `<div id="lab-permanent-dropzone" data-turbo-permanent>` with a hand-written `<twig:Dropzone id="kept" name="kept">`;
    - a `<turbo-frame id="dropzone-frame">` holding a **hand-written multipart form** (`<twig:Dropzone id="framed" name="framed">`) that posts to `?frame=1` (303 back into the frame, 422 inside it), and a "Reload the frame" link.
  - `dropzone-stream` (GET/POST `action=replace|update`): `_dropzone_streamed.html.twig` and `dropzone_stream.stream.html.twig`.
  - `live-dropzone` (generic `live()` route): `App\Twig\Lab\LiveDropzone` with LiveProps:
    - `uploads` (list of `{name, size}`);
    - `errors`;
    - `note` (writable, `data-model`, for an unrelated re-render);
    - `attempts` (keys the wrapper).

    Action `upload`. Nothing is stored: names and sizes only, and PHP deletes the temporary files.

## Specs

**`tests/e2e/dropzone.spec.ts`** (`/preview/dropzone/…`):
- **Keyboard:**
  - Tab reaches the input, and the box shows the focus ring (computed `box-shadow`);
  - Space or Enter opens the chooser (`page.waitForEvent('filechooser')`);
  - choosing moves focus to the button named "Remove tiny.png";
  - Enter clears it, shows the placeholder and puts focus back on the input;
  - `connect()` never moves focus.
- **Picks:**
  - `setInputFiles` with a PNG buffer: the preview is visible, the filename shows, and the image `background-image` starts with `url("data:image/png`;
  - a text file shows no image.
- **Multiple:**
  - three files across two picks give three items and `input.files.length === 3`; a duplicate is not added;
  - removing the second focuses the new second Remove; removing all focuses the input;
  - each item's name is "Remove <file>".
- **Drag:**
  - a synthetic `dragenter` sets `data-dragging`, and `dragleave`/`drop` clear it;
  - a `drop` dispatched on the list is `defaultPrevented`.
- **Events:** exactly one `dropzone:change` per pick (a document listener counts them).
- **axe** after a pick (single and multiple) and in the invalid example: no serious or critical issue.

**`tests/e2e/forms.spec.ts`** additions:
- an invalid image (`text/plain` named `x.png`) gives a 422, `aria-invalid` on the file input, and an accessible description of help plus the mime error;
- a 1.5 MB PNG gives a 422 with the size error;
- a valid PNG with other fields empty gives a 422, and the description includes "tiny.png was not kept: choose it again.";
- a valid full submit with a photo and two attachments gives a 303 and the flash;
- a 9 MB file (over `post_max_size`) gives a 422 with the form-level "The uploaded file was too large…" at the top and no CSRF error.

  Each 422 case uses `allowHttpError(/\/forms$/, 422)`.

**`tests/e2e/lab.dropzone.spec.ts`** (the Turbo gate):
1. **Cache snapshot and Back:**
   - pick (single and multiple), visit page two, Back (`turboVisitDone`);
   - the zones are empty: placeholder visible, preview hidden, 0 list items, `input.files.length === 0`;
   - one controller per zone;
   - a new pick works with exactly one `dropzone:change`.
2. **Repeated visits:** three round trips leave `[data-controller~="dropzone-assist"]` at the expected count and one `change` per pick.
3. **Permanent:** pick in `#lab-permanent-dropzone`, visit page two: the file is still selected and the preview shown. Remove still works with one event.
4. **Frame:**
   - reload the frame three times, then pick and submit inside the frame: the 303 shows the name in the frame and the page URL is unchanged;
   - an invalid pick gives a 422 inside the frame;
   - this also proves the hand-written `enctype`.
5. **Stream:** pick, then a Stream `replace` and an `update`. The new zone is empty and works, there is one controller, and no `data-dragging` is left.
6. **Turbo multipart submit:** the main form posts files through Turbo (the URL changes by 303 and the summary lists the names). Clicking the Live counter between the pick and the submit keeps the files (rule 1).
7. **Live (rule 2):**
   - pick two PNGs and type in `note` (a re-render): the two items stay and `input.files.length === 2`;
   - Upload: the server lists both names and sizes; the zone is fresh (0 items, empty input, one controller);
   - an invalid or too-large file gives the error listed and a fresh zone.

**`tests/e2e/csp.spec.ts`:**
- add `/lab/dropzone-turbo`, `/forms` and `/preview/dropzone/default?theme=light` to `pages`;
- a test: the server HTML of `/forms` and `/lab/dropzone-turbo` contains no `dropzone-container` (the package's theme) and no `style=` in the dropzone markup (via `page.request`);
- a test: a picked PNG shows its preview under the policy (the fixtures fail on any `img-src` violation).

**`tests/e2e/a11y.spec.ts`:** add `dropzone-turbo`, `dropzone-turbo/two`, `dropzone-stream` and `live-dropzone` to `labPages`. `/forms` is already scanned.

## Fresh install (PR 2)

- `tools/tests/fresh-install.sh`: add `dropzone` to the recipe loop; the printed `composer require symfony/ux-dropzone:^3.5` runs.
- New fixtures:
  - `tools/tests/fixtures/fresh-app/src/Controller/UploadController.php`: `/upload`, a `createFormBuilder()` with `photo` (`DropzoneType`, help) and `files` (`DropzoneType`, `multiple`). A POST redirects (303) to `/upload?uploaded=<client name>`.
  - `templates/upload/index.html.twig`: `{% form_theme form 'form/flowbite_layout.html.twig' %}`.
- `tools/tests/check-fresh-app.sh`, `/upload` checks:
  - the `<form>` has `enctype="multipart/form-data"`;
  - `input#form_photo[type=file]` carries `aria-describedby="form_photo_help"` inside an element with `data-controller="symfony--ux-dropzone--dropzone dropzone-assist"`;
  - `name="form[files][]"` with `multiple`;
  - no `dropzone-container` and no `style="`.

  Then `curl -F 'form[photo]=@tiny.png'` (a PNG written by the script into its temporary directory) must answer 303 with `uploaded=tiny.png`. This proves that Flex registered the bundle without a recipe, and that `UploadedFile` reaches the form. Mention `/upload` in the header comment.
- `tools/tests/docker-install.sh` reuses the same fixtures and checks.

## Checks

- Kit lint (no `stimulus.controller.missing`, `@target`/`@value`/`@action` match), `ux-toolkit-kit-debug`, `node tools/contrast/check.mjs`.
- The `cmp` of `kit.css` (unchanged).
- `tools/tests/fresh-install.sh`, then `npx playwright test` (smoke and examples).
- No PHP ships in the recipe, so no PHPStan change. The demo's PHP is covered by the usual run.
- Screenshots only with `--update-snapshots=missing`, reviewed one by one; no existing baseline changes.

## Docs

- `README.md`:
  - a *Forms* row: `dropzone` ✦, "File uploads with Symfony UX Dropzone: drag and drop or browse, previews, several files; `DropzoneType` renders through the form theme, `Dropzone` outside forms";
  - *Turbo and Live Components*: one line (files are never restored after a 422 or Back; Live uploads through a `files` action).
- `FOR-AGENTS.md` *Which recipe*: "File uploads in a form, drag and drop | `dropzone`". Regenerate `llms.txt` (`node tools/llms-txt.mjs`; CI checks it).
- `CHANGELOG.md`:
  - `### Added`: `dropzone`;
  - `### Changed`: `form-theme` renders a `DropzoneType` through the `dropzone` recipe.
- `docs/PROJECT-AGENTS-SNIPPET.md`: "File uploads: `ux:install dropzone`, then do the README's CSS import and `controllers.json` change. In a form, a `DropzoneType` (`'multiple' => true` for several) with `File`/`Image` constraints (and `All` + `Count` for several). The controller answers 303/422, and files are never kept after a 422 (the field says so). Outside a form, `<twig:Dropzone id name>` in a `method="post" enctype="multipart/form-data"` form. In a Live Component, never a `DropzoneType`: `<twig:Dropzone>` plus a `files(name)|action` button, a stable wrapper `id` that changes after each upload, and `data-live-ignore`. Image previews need `img-src data:`."
- `form-theme/README.md`: the bullet above.
- **Credits:** no file is copied from symfony/ux-dropzone. The template and stylesheet are written anew; only the target names and class names are the package's API. So `NOTICE`/`LICENSE` gain nothing. If code ends up copied after all, credit it in `NOTICE` only.

## PR split

1. **`feat(dropzone)`**: the recipe (component, stylesheet, assist controller, README, `dropzone/tests` states), the demo dependency, the icon, `dropzone.spec.ts`, and the lab parts that do not need the form theme: Turbo gate items 1–5 with hand-written forms, Stream, CSP, a11y and contrast.
2. **`feat(form-theme)`**: the `dropzone_widget` block and recipe template, the reselect note, `/forms` and parity, `UploadDemoType`, the Turbo multipart form and the Live lab (items 6–7), the `forms.spec.ts` cases, the PHP ini pins, the fresh install and the docs.

## Out of scope

Upload queues and per-file progress (Turbo's progress bar is all there is), resumable or chunked uploads, image processing or cropping, client-side size and type validation (the server decides), keeping valid files across a 422 (temporary storage), and Turbo 8 refresh morph.

## Open questions (recommended answer first)

1. **Recipe name.** Recommended: `dropzone`, named after the package as `autocomplete` is. The alternative is `file-upload`.
2. **A kit companion controller (`dropzone-assist`)** for focus after pick, clear and remove, the drag-over state, and the guard against drops outside the input. Recommended: **yes**; without it, keyboard users lose focus and a drop on the list leaves the page. The alternative is the package controller alone, with these gaps documented.
3. **Styling.** Recommended: Tailwind utilities for the server-rendered markup, and a small stylesheet only for the list items the controller builds, with the package's stylesheet turned off. The alternative is one stylesheet for everything, as autocomplete does.
4. **Wiring.** Recommended: **automatic** for every `DropzoneType` (the user already chose the type), with plain `FileType` unchanged. The alternative is an opt-in through `block_prefix`, as the date picker does.
5. **Without the `dropzone` recipe installed.** Recommended: fall back to the kit's file `Input` (`ignore_missing`). The alternative is to fail loudly, as the date-picker opt-in does.
6. **After a 422, a valid file that was thrown away.** Recommended: show "*name* was not kept: choose it again." in the zone, described by the input. The alternative is to say nothing.
7. **Live.** Recommended: support only `<twig:Dropzone>` plus a `files` action inside Live Components, and document that a `DropzoneType` in a `ComponentWithFormTrait` form never receives the file. The alternative, a `files|save` action on the Live form itself, is deferred.
8. **Picked-state screenshots** through `testState()` in `dropzone/tests/dropzone.spec.ts`. Recommended: **yes** (single with an image, three files, dragging, in both themes).
9. **Pin PHP's upload limits** in the demo (`php -S -d …` and `10-app.ini`) so the size and `post_max_size` tests are deterministic. Recommended: **yes**.
