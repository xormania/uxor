# Markdown Editor

A Markdown field: a native textarea with a small toolbar and a Preview tab rendered by the server, exactly as the
stored Markdown will be printed. CommonMark with strikethrough; raw HTML, images and unsafe links never reach the page.

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:FormField for="markdown-default" label="Release notes">
        <twig:MarkdownEditor id="markdown-default" name="notes" :value="'## Spring release\n\nOur **spring collection** is here: light fabrics, _bright_ colors.\n\n- Free shipping over 50 €\n- Returns within 30 days\n\nSee the [size guide](/sizes).'" />
    </twig:FormField>
</div>
```

## Installation

::: installation

Then run the `composer require` command `ux:install` prints: `league/commonmark`, `symfony/html-sanitizer` and
`symfony/ux-live-component` (the preview is a Live Component).

## Usage

In a Symfony form, use the recipe's `MarkdownType` (copied into `src/UXor/MarkdownEditor/`). The form theme
renders it, its data is the Markdown source, and too long is an error, never a cut:

```php
use App\UXor\MarkdownEditor\MarkdownType;
use Symfony\Component\Validator\Constraints as Assert;

$builder->add('body', MarkdownType::class, [
    'help' => 'Markdown: **bold**, _italic_, lists, links, `code`.',
    'attr' => ['placeholder' => 'Write your post…', 'rows' => 12],
    'max_chars' => 5000, // characters of Markdown; the default is 20000
    'constraints' => [new Assert\NotBlank()],
]);
```

- `getData()` gives the Markdown with Windows line breaks made `\n`, or `null` when blank, so `NotBlank` works.
- `max_bytes` (default 100000, at most 1000000) and `max_chars` (default 20000) limit the Markdown: longer input is a
  field error, and the content stays as typed.
- Print stored Markdown with the `flowbite_markdown_html` filter, the same rendering as the preview. Never with `|raw`:

  ```twig
  <div class="space-y-2">{{ post.body|flowbite_markdown_html }}</div>
  ```

Outside a form, `<twig:MarkdownEditor id="…" name="…" />` submits its Markdown under `name`; render it with
`MarkdownRenderer::toHtml()`, which throws a `LengthException` for more than 1000000 bytes rather than render part of
it.

- `label` names the textarea when no label points at it; a `FormField`'s label points at it through `id`.
- `value` is the initial Markdown.
- `placeholder`, `rows` (8), `maxChars` (the counter), `counterText` (`%count%`, `%max%`), `toolbarLabel`,
  `readonly`, `disabled`.
- `aria-describedby`, `aria-invalid` and `aria-required` go to the textarea, as on a form control.

### Toolbar and tabs

The toolbar writes Markdown around the selection (bold, italic, a link with its address selected) or before the
selected lines (a heading, a bulleted or numbered list; again to remove it). Its edits join the browser's undo history.
One tab stop: the arrow keys, Home and End move between its buttons.

Write and Preview are tabs: the arrow keys switch between them. Typing sends nothing to the server; opening Preview
renders the current Markdown on the server.

### What is rendered

| Markdown | HTML |
| --- | --- |
| Paragraphs, line breaks | `p`, `br` |
| `**bold**`, `_italic_`, `~~strike~~`, `` `code` `` | `strong`, `em`, `del`, `code` |
| Headings, `#` to `######` | `h1` to `h6` |
| Lists, nested | `ul`, `ol` (with `start`), `li` |
| Quotes, code blocks, horizontal lines | `blockquote`, `pre`, `hr` |
| Links | `a href`, with `rel="noopener noreferrer nofollow"` |

Raw HTML is stripped, images are dropped, and links go to `https`, `http`, `mailto` or a relative URL only. Nesting
deeper than 20 levels and more than 500 emphasis markers on a line are kept as text.

## Turbo and Live Components

- What is typed is kept in the markup as it is typed, so every copy of the page Turbo caches holds it (a frame visit
  promoted to history copies the page early): Back shows it, and the preview renders it.
- Turbo Frames and Streams create and destroy the editor with its markup.
- The editor is a Live Component of its own: put it in a plain form, not inside another Live Component's re-rendered
  markup.

## Accessibility

- The textarea is a native form control, named by its label and described by its help and errors.
- Write and Preview are a `role="tablist"` with arrow keys; the preview panel is focusable.
- The toolbar is a named `role="toolbar"` with one tab stop; every button has a name.
- The counter shows the characters used and turns red past `maxChars`.

## Security

- The server renders: CommonMark strips raw HTML and refuses unsafe links, and a sanitizer keeps only the table above.
  The preview and `flowbite_markdown_html` use the same `MarkdownRenderer`.

## Examples

### Placeholder and help

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:FormField for="markdown-placeholder" label="Your message" help="Markdown: **bold**, _italic_, lists, links.">
        <twig:MarkdownEditor id="markdown-placeholder" name="message" placeholder="Write something…" maxChars="500" aria-describedby="markdown-placeholder_help" />
    </twig:FormField>
</div>
```

### Invalid

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:FormField for="markdown-invalid" label="Summary" error="This value should not be blank.">
        <twig:MarkdownEditor id="markdown-invalid" name="summary" aria-invalid="true" aria-describedby="markdown-invalid_error" />
    </twig:FormField>
</div>
```

### Read-only

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:MarkdownEditor id="markdown-readonly" name="terms" label="Terms" readonly :value="'## Terms\n\nBy ordering, you accept our [terms of sale](/terms).'" />
</div>
```
