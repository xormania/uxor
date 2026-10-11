---
status: shipped
recipes: editor, markdown-editor
---

# Plan: F. Rich editor

_2026-10-08. This plan implements F in [`ROADMAP.md`](ROADMAP.md) from the research report the user commissioned
(Tiptap 3.31.4, restricted HTML, a kit-owned Stimulus controller, one fixed preset) and the user's answers of
2026-10-08:_

1. _**Both formats, per field, never mixed:** a Tiptap editor that stores restricted HTML (PR 1), and a separate
   Markdown recipe, a plain `<textarea>` with a server-rendered preview (PR 2). No Markdown inside Tiptap
   (`@tiptap/markdown` is beta)._
2. _**Links:** `https`, `http`, `mailto` and relative links (`/page`, `#part`); no author-chosen `target`; the server
   forces `rel`._
3. _**Underline:** no toolbar button; `<u>` in content is kept._
4. _**Turbo Back:** content and selection come back, not the undo history._
5. _**Live:** local typing wins; only an explicit reset or a switch of record replaces the editor's content._
6. _**Limits:** 100,000 bytes of HTML and 20,000 characters of text by default, configurable per field; too long is
   a validation error, never a silent cut._

_Delivery: two pull requests, (1) `editor` and (2) `markdown-editor`, each with its form-theme wiring, lab, specs,
fresh install and docs. Decided with the user on 2026-10-08: the recommended answer to every open question at the
end (names `editor` and `markdown-editor`, a kit `EditorType`, a non-modal link dialog, a Live Component preview,
the library size accepted with a dynamic import)._

## Sources read

| Source | What matters here |
|---|---|
| `@tiptap/core` 3.31.4 (npm, 2026-09-30), `dist/index.js` | `injectCSS` defaults to `true` and adds a `<style>` element (`createStyleTag`): set **`injectCSS: false`** and ship the styles in the recipe's stylesheet. `editor.destroy()` removes the view and its listeners. `setContent(html, { emitUpdate: false })` replaces content without an `update` event. The only `element.style` writes in core belong to the resizable node view (images), which the preset does not use. |
| `@tiptap/starter-kit` 3.31.4 | Bundles 23 extensions, including Link, Underline, CodeBlock and Dropcursor. The preset lists its extensions explicitly instead (below), so nothing outside the contract loads. |
| `@tiptap/extension-link` 3.31.4 | Defaults: `openOnClick: true`, `autolink: true`, `linkOnPaste: true`, `HTMLAttributes: {target: '_blank', rel: 'noopener noreferrer nofollow'}`. Its default `isAllowedUri` accepts `ftp`, `tel`, `sms`, `xmpp` and others. The preset sets `openOnClick: false`, its own `isAllowedUri` (answer 2), and `HTMLAttributes: {target: null, rel: 'noopener noreferrer nofollow'}`. |
| `symfony/html-sanitizer` (^7.4, in the demo's lock as a dependency) | `HtmlSanitizerConfig::allowElement()`, `allowLinkSchemes()`, `allowRelativeLinks()`, `forceAttribute()`, `withMaxInputLength()` (truncates: **check the length before sanitizing**). |
| `league/commonmark` 2.x, `twig/markdown-extra` 3.x | PR 2: `html_input: 'strip'`, `allow_unsafe_links: false`, nesting and delimiter limits; the output goes through the same sanitizer. |
| Research report, § lifecycle, § Live, § accessibility | Turbo cache, Frames, Streams `update`/`replace`, permanent elements; `data-live-ignore` protects the DOM but does not sync the value; the APG toolbar pattern (one tab stop, arrow keys). |

## PR 1: the `editor` recipe (Tiptap, restricted HTML)

### Preset (the contract)

| Feature | Stored HTML | Toolbar |
|---|---|---|
| Paragraphs, hard breaks | `p`, `br` | none |
| Bold, italic, strike | `strong`, `em`, `s` | 3 toggle buttons (`aria-pressed`) |
| Underline | `u` | **none** (answer 3): Ctrl+U and pasted `<u>` keep it |
| Headings | `h2`, `h3` only | 2 toggle buttons |
| Bullet and ordered lists, nesting | `ul`, `ol` (`start`), `li` | 2 toggle buttons; indent and outdent buttons (Tab is not trapped) |
| Blockquote | `blockquote` | toggle button |
| Inline code | `code` | toggle button |
| Links | `a href` (+ forced `rel`) | Link button opening a small dialog (URL field, Apply, Remove link) |
| Horizontal rule | `hr` | button |
| Undo, redo, clear formatting | none | 3 buttons |

Extensions: `@tiptap/core`, `@tiptap/pm`, `@tiptap/extension-{document,text,paragraph,hard-break,bold,italic,underline,strike,heading,blockquote,code,link,horizontal-rule}`, `@tiptap/extension-list` (`BulletList`, `OrderedList`, `ListItem`, `ListKeymap`), `@tiptap/extensions` (`UndoRedo`, `Gapcursor`, `TrailingNode`), all **3.31.4**. Out of scope: images, tables, colors, fonts, alignment, embeds, code blocks.

### Markup (`templates/components/Editor.html.twig`)

- `<div data-controller="editor">` holding:
  - a `role="toolbar"` with `aria-label` "Formatting" and `aria-controls` the editable; each button gets an icon, an sr-only name and `aria-pressed`;
  - the editable `div` that Tiptap mounts into, with `role="textbox"`, `aria-multiline="true"`, `aria-labelledby` (the label), and `aria-describedby` (help, errors, limits);
  - the hidden backing `<textarea name="…" hidden>` holding the HTML (it submits with the form, and Live binds to it);
  - the link dialog (a `popover`-style non-modal dialog, reusing the `popover` recipe's positioning).
- Server-rendered content: the editable shows the sanitized HTML before JavaScript runs (no flash, readable without JS), and the `textarea` holds the same value.
- Props: `name`, `id`, `value`, `placeholder`, `maxBytes` (100000), `maxChars` (20000), `toolbarLabel`, `disabled`, `readonly`.

### Controller (`editor_controller.js`)

- `connect()`: dynamic import of the Tiptap modules, guarded so that a controller disconnected meanwhile never mounts. `new Editor({ element, content: textarea.value, injectCSS: false, extensions: preset })`.
- Each transaction writes `editor.getHTML()` to the textarea (an empty document becomes `''`) and dispatches `input`; `blur` dispatches `change`.
- Toolbar: roving tabindex (one tab stop; arrows, Home, End), `aria-pressed` and `disabled` synced on `selectionUpdate`.
- Links: `isAllowedUri` accepts `https:`, `http:`, `mailto:`, and relative URLs (`/`, `#`, `?`, a path); `openOnClick: false`; `target` stripped.
- Turbo: on `turbo:before-cache`, write the HTML into the editable as plain markup and `destroy()` (Turbo caches clean markup, not a live editor); `connect()` re-mounts and restores the selection saved in the `before-cache` handler (answer 4: no undo history).
- `disconnect()`: `destroy()`, abort the pending import, remove listeners.
- Counter: characters of text and bytes of HTML, announced politely near the limit; over the limit, the field says so (the server still decides).

### Live (answer 5)

- The editable and the toolbar sit inside `data-live-ignore`; the `textarea` (with `data-model`) sits outside it.
- The controller writes the textarea and dispatches `change` on blur and before a Live action fires (`live:action` hook), debounced while typing.
- A re-render that brings back the value the editor sent (an echo) does nothing.
- A re-render with `data-editor-reset-value` changed (a counter the component bumps on an explicit reset or a record switch) replaces the content with `setContent(value, { emitUpdate: false })`.

### Server side (kit PHP, `src/UXor/Editor/`)

- `EditorHtmlPolicy`: builds the `HtmlSanitizer` above (elements of the preset, `ol[start]`, `a[href]`, schemes `https`, `http`, `mailto`, relative links allowed, `rel` forced). Nothing else is allowed: no `style`, `class`, `id`, `data-*`, event attributes or images.
- `EditorType` (parent `TextareaType`, block prefix `flowbite_editor`), options `max_bytes` and `max_chars`:
  - a pre-submit listener rejects a body over `max_bytes` (a form error, before sanitizing);
  - a model transformer sanitizes and turns an empty document (`<p></p>`) into `null`, so `NotBlank` works;
  - a `Length(max: max_chars)` check on the text content.
- Form theme: a `flowbite_editor_widget` block including the recipe's `form/flowbite_editor_widget.html.twig` (the `dropzone` precedent).
- Rendering stored content: `{{ post.body|flowbite_editor_html }}` (a Twig filter that sanitizes again with the same policy, so content written by other paths is safe too).

### Lab and specs

- Lab pages:
  - `editor-turbo/{one,two}`: a form, a `data-turbo-permanent` editor, a Turbo Frame that reloads;
  - `editor-stream`: Stream `replace` and `update`;
  - `live-editor`: an unrelated re-render while typing, a save action, an explicit reset.
- `editor.spec.ts`:
  - toolbar keyboard (one tab stop, arrows), every command and its stored HTML;
  - link dialog: allowed URLs and refused schemes (`javascript:`, `data:`, `ftp:`);
  - paste of Office/Google Docs HTML (styles and classes gone), no `<style>` element in the document;
  - a counter at the limit.
- `lab.editor.spec.ts`: the Turbo gate (Back restores content and selection, one editor instance, no duplicated toolbar), frame, permanent, Streams, and the Live cases of answer 5.
- `forms.spec.ts`: 422 with the content kept as sanitized, too long (bytes and characters), empty document and `NotBlank`, a hostile body (script, `onerror`, `style`, `javascript:` link) stored clean.
- PHP unit-style checks through a console command (the hostile-props precedent): sanitizing twice gives the same output; every preset feature survives.
- CSP: no `style=` in the server HTML, no `<style>` element after mounting. a11y lab pages.

### Fresh install

`ux:install editor`, a `/post` page with an `EditorType`; the check confirms the markup and that a posted
`<p>Hi <script>x</script></p>` comes back as `<p>Hi </p>`.

## PR 2: the `markdown-editor` recipe

- A `MarkdownEditor` Live Component: a `<textarea>` (the source, with the field's name) and a Preview tab rendered by the server with the configured CommonMark (`html_input: strip`, `allow_unsafe_links: false`, nesting 20, delimiters 500, strikethrough), then the same sanitizer with a Markdown policy (adds `pre`, `h1`–`h6`, `img` only if asked).
- A small toolbar inserting Markdown syntax (bold, italic, link, list, heading); the textarea stays native, the strongest accessibility starting point.
- `MarkdownType` (block prefix `flowbite_markdown`), the same length limits on the source.
- Rendering: `{{ post.body|flowbite_markdown_html }}`.
- Lab, specs (preview parity with stored rendering, hostile Markdown), fresh install, docs.

## Docs (both PRs)

README rows (*Forms*), *Turbo and Live Components* (editor content and selection survive Back, not undo), `FOR-AGENTS.md` (*Which recipe*: "Rich text" → `editor`, "Markdown" → `markdown-editor`), `llms.txt`, agent snippet (store the field's HTML only through `EditorType`; render with the filter, never `|raw`), CHANGELOG, `NOTICE` if code is copied (none planned).

## Out of scope

Collaboration, comments, mentions, images and uploads, tables, code blocks with highlighting, Markdown inside Tiptap, a JSON storage format, Turbo 8 refresh morph.

## Open questions (recommended answer first)

1. **Recipe names.** `editor` and `markdown-editor`. Alternatives: `rich-text` and `markdown`.
2. **Form wiring.** A kit `EditorType` (sanitizing and limits built in, block prefix `flowbite_editor`). Alternative: a `TextareaType` opt-in through `block_prefix`, with sanitizing left to the app (simpler, easier to get wrong).
3. **Link dialog.** A non-modal dialog positioned like `popover`. Alternative: `window.prompt` (not styleable, poor on mobile).
4. **Markdown preview.** A Live Component with a Preview tab. Alternative: a Stimulus controller posting to a kit route (needs routing config in the app).
5. **Library size.** About 150 KiB gzipped over about 41 modules (the report's estimate, to be measured on the demo's import map). Recommended: accept it, loaded only on pages with an editor (dynamic import).
