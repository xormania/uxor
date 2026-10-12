# Editor

A rich text editor ([Tiptap](https://tiptap.dev)) that stores restricted HTML: paragraphs, bold, italic, strike,
inline code, headings, lists, quotes, links and horizontal lines, with a keyboard-friendly toolbar. The server
sanitizes the same set, so what the toolbar makes is all a field ever stores.

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:FormField for="editor-default" label="Description" :labelAttr="{id: 'editor-default_label'}">
        <twig:Editor id="editor-default" name="description" labelledBy="editor-default_label" value="<p>Our <strong>spring collection</strong> is here: light fabrics, bright colors.</p><ul><li><p>Free shipping over 50 €</p></li><li><p>Returns within 30 days</p></li></ul>" />
    </twig:FormField>
</div>
```

## Installation

::: installation

Then:

1. Run the `composer require` and `importmap:require` commands `ux:install` prints: `symfony/html-sanitizer` and the
   Tiptap modules.
2. Import the recipe's stylesheet after the theme in `assets/styles/app.css`:

   ```css
   @import "./uxor-editor.css";
   ```

The editor's controller is lazy: Tiptap downloads only on pages with an editor.

## Usage

In a Symfony form, use the recipe's `EditorType` (copied into `src/UXor/Editor/`). The form theme renders it,
its data is sanitized HTML, and too long is an error, never a cut:

```php
use App\UXor\Editor\EditorType;
use Symfony\Component\Validator\Constraints as Assert;

$builder->add('body', EditorType::class, [
    'help' => 'Headings, lists and links are kept; everything else is removed.',
    'attr' => ['placeholder' => 'Write your post…'],
    'max_chars' => 5000, // characters of text; the default is 20000
    'constraints' => [new Assert\NotBlank()],
]);
```

- `getData()` gives sanitized HTML, or `null` when the text is empty (`<p></p>` counts as empty), so `NotBlank` works.
- `max_bytes` (default 100000, at most 1000000) limits the HTML, `max_chars` (default 20000) the text: longer input
  is a field error, and the content stays as typed. More than 1000000 bytes is too long to sanitize and show again:
  the editor shows empty, with the error.
- `max_chars` counts the characters the editor's counter shows: the text without markup, an entity as one character,
  a line break (`<br>`) as one, and white space between blocks as none.
- Print stored content with the `flowbite_editor_html` filter, which sanitizes it again (content saved by another
  path is safe too; sanitized content comes back unchanged, nested blocks included), and throws a `LengthException`
  for more than 1000000 bytes. Never with `|raw`:

  ```twig
  <div class="space-y-2">{{ post.body|flowbite_editor_html }}</div>
  ```

Outside a form, `<twig:Editor id="…" name="…" />` submits its HTML under `name` (a hidden textarea): sanitize it on
the server with `EditorHtmlPolicy::sanitize()` before you store it. It throws a `LengthException` for more than
1000000 bytes rather than keep part of the HTML: check the length first (`EditorHtmlPolicy::isReadable()`, in Twig
`value is flowbite_editor_readable`).

- `label` names the editor when no label points at it; with a `FormField`, give the label an id
  (`labelAttr: {id: '<id>_label'}`) and pass it as `labelledBy`. A click on the label focuses the editor.
- `value` is the initial HTML, sanitized before it is shown; more than 1000000 bytes shows empty, never cut.
- `placeholder`, `maxChars` (the counter), `counterText` (`%count%`, `%max%`), `toolbarLabel`, `readonly`, `disabled`.
- `aria-describedby`, `aria-invalid` and `aria-required` go to the editable area, as on a form control.

### The toolbar

One tab stop: Tab reaches the toolbar, the arrow keys, Home and End move between its buttons, Tab again reaches the
text. Each format button says whether it applies to the selection (`aria-pressed`). The editor's own shortcuts work
too: Ctrl+B, Ctrl+I, Ctrl+Shift+S, Ctrl+E (code), Ctrl+Z, Ctrl+Shift+Z, Ctrl+U (underline, which has no button: it
can look like a link). Tab and Shift+Tab indent list items; elsewhere they leave the editor.

The Link button opens a small dialog: type an address and press Enter or Apply; Remove link takes it off. Links go to
`https`, `http`, `mailto` or a relative URL (`/pricing`, `#faq`); any other scheme is refused, here and on the server.

### What is kept

| Kept | Stored as |
| --- | --- |
| Paragraphs, line breaks | `p`, `br` |
| Bold, italic, underline, strike, inline code | `strong`, `em`, `u`, `s`, `code` |
| Headings | `h2`, `h3` |
| Lists, nested | `ul`, `ol` (with `start`), `li` |
| Quotes, horizontal lines | `blockquote`, `hr` |
| Links | `a href`, with `rel="noopener noreferrer nofollow"` |

Pasted content keeps only these: styles, classes, images, tables, colors and fonts are dropped. White space is
read as the editor reads it, by the editor and by `EditorHtmlPolicy`: a run of spaces or lines is one space, and none
at the start or end of a block or after a line break (lines between paragraphs, a list's indentation). To change the set, change the controller's
extensions and `EditorHtmlPolicy` together.

## Turbo and Live Components

- Before Turbo caches the page, the editor saves its content and selection in the markup and stays on screen (a frame
  visit promoted to history caches the page while the editor is still in use). Back builds a new editor from the
  cached copy, with that content and selection (the undo history is not kept).
- Turbo Frames and Streams create and destroy the editor with its markup.
- In a Live Component, bind the field with the `model` prop (`<twig:Editor … model="on(change)|body" />`, the value
  of a `data-model`), or use a `ComponentWithFormTrait` form: the content reaches the component when the editor loses
  the focus. Re-renders leave
  the editor alone (it sits in `data-live-ignore`), so typing is never overwritten. To replace the content from the
  server (a reset, another record), change the `reset` prop in the same re-render.

## Accessibility

- The editable area is a multiline textbox named by its label, described by its help and errors.
- The toolbar is a named `role="toolbar"` with one tab stop and arrow keys; every button has a name.
- The counter shows the characters used and turns red past `maxChars`.

## Security

- Tiptap's own stylesheet is never injected: the editor works under a strict Content Security Policy.
- The server decides: `EditorType` sanitizes every submit, and `flowbite_editor_html` sanitizes on output. Scripts,
  event attributes, styles, `javascript:` links and anything outside the table above are removed.

## Examples

### Placeholder and help

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:FormField for="editor-placeholder" label="Your message" :labelAttr="{id: 'editor-placeholder_label'}" help="Lists and links are kept.">
        <twig:Editor id="editor-placeholder" name="message" labelledBy="editor-placeholder_label" placeholder="Write something…" maxChars="500" aria-describedby="editor-placeholder_help" />
    </twig:FormField>
</div>
```

### Invalid

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:FormField for="editor-invalid" label="Summary" :labelAttr="{id: 'editor-invalid_label'}" error="This value should not be blank.">
        <twig:Editor id="editor-invalid" name="summary" labelledBy="editor-invalid_label" aria-invalid="true" aria-describedby="editor-invalid_error" />
    </twig:FormField>
</div>
```

### Read-only

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:Editor id="editor-readonly" name="terms" label="Terms" readonly value="<h2>Terms</h2><p>By ordering, you accept our <a href='/terms'>terms of sale</a>.</p><blockquote><p>Prices include taxes.</p></blockquote>" />
</div>
```
