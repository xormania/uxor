<?php

namespace App\UXor\Editor;

use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/**
 * The editor's formatting, and nothing else: what the `editor` recipe's toolbar can produce is what this policy keeps.
 * Paragraphs and line breaks, bold, italic, underline, strike, inline code, level 2 and 3 headings, lists (an ordered
 * list keeps its `start`), quotes, horizontal lines, and links to https, http, mailto or a relative URL, always with
 * `rel="noopener noreferrer nofollow"`. No `style`, `class`, `id`, `data-*`, event attribute, image or `target`.
 * Other formatting and structure tags (`b`, `span`, `div`, `h1`, tables…) are unwrapped, their text kept; scripts,
 * styles, images, media, frames and forms are removed with their content. White space alone next to a block's tag
 * (between two paragraphs, or a list's indentation) is removed, as the editor drops it: the server counts the text the
 * editor's counter counts.
 *
 * Copied into your app by `ux:install editor`: change it with the recipe's toolbar, never one without the other.
 */
final class EditorHtmlPolicy
{
    /** The most bytes of HTML a field accepts by default. */
    public const MAX_BYTES = 100_000;

    /** The most characters of text a field accepts by default. */
    public const MAX_CHARS = 20_000;

    /** The most bytes of HTML the policy reads: longer input is refused, never cut. A field's `max_bytes` stays at or below it. */
    public const MAX_INPUT_BYTES = 1_000_000;
    /** Sanitizer passes until the output no longer changes (one more than needed shows it is stable). */
    private const MAX_PASSES = 4;

    private const ELEMENTS = ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'h2', 'h3', 'ul', 'li', 'blockquote', 'hr'];

    /** The blocks the policy keeps: white space alone next to one of their tags is not text. */
    private const BLOCKS = ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr'];

    /** Tags removed with their text kept (formatting and structure from elsewhere); anything else not allowed is dropped whole. */
    private const UNWRAPPED = ['b', 'i', 'del', 'strike', 'ins', 'mark', 'small', 'sub', 'sup', 'span', 'font', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'h1', 'h4', 'h5', 'h6', 'pre', 'kbd', 'samp', 'abbr', 'cite', 'q', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption'];

    private readonly HtmlSanitizer $sanitizer;

    /** The same policy without a length limit, for the passes over its own output, which may be longer than the input. */
    private readonly HtmlSanitizer $again;

    public function __construct()
    {
        $config = (new HtmlSanitizerConfig())
            ->allowLinkSchemes(['https', 'http', 'mailto'])
            ->allowRelativeLinks(true)
            ->allowElement('ol', ['start'])
            ->allowElement('a', ['href', 'title'])
            ->forceAttribute('a', 'rel', 'noopener noreferrer nofollow');
        foreach (self::ELEMENTS as $element) {
            $config = $config->allowElement($element);
        }
        foreach (self::UNWRAPPED as $element) {
            $config = $config->blockElement($element);
        }
        // the sanitizer cuts longer input: sanitize() refuses it first
        $this->sanitizer = new HtmlSanitizer($config->withMaxInputLength(self::MAX_INPUT_BYTES));
        // its own output is never cut: escaping makes it longer than the input it came from (each `&` is `&amp;`)
        $this->again = new HtmlSanitizer($config->withMaxInputLength(-1));
    }

    /** Whether the policy reads the HTML whole: at most MAX_INPUT_BYTES bytes. */
    public static function isReadable(string $html): bool
    {
        return \strlen($html) <= self::MAX_INPUT_BYTES;
    }

    /**
     * The HTML with only the editor's formatting, its white space as the editor reads it; '' when it holds no
     * text (e.g. `<p></p>`). Its own output gives the same output.
     *
     * @throws \LengthException when the HTML is longer than MAX_INPUT_BYTES, instead of storing part of it
     */
    public function sanitize(string $html): string
    {
        if (!self::isReadable($html)) {
            throw new \LengthException(\sprintf('The HTML holds %d bytes, more than the %d the editor policy reads.', \strlen($html), self::MAX_INPUT_BYTES));
        }
        // until it no longer changes: a block unwrapped from between two others can leave one inside the other
        // (`<h2><div><h2>` gives `<h2><h2>`), which the next parse, a browser's or this policy's, splits; another pass
        // gives what it splits to, so the output is its own output
        $clean = $this->sanitizer->sanitize($html);
        for ($pass = 1; $pass < self::MAX_PASSES; ++$pass) {
            $again = $this->again->sanitize($clean);
            if ($again === $clean) {
                break;
            }
            $clean = $again;
        }
        $clean = trim(self::asTheEditorReadsIt($clean));

        return self::isEmpty($clean) ? '' : $clean;
    }

    /** The number of characters of text, not counting markup, a line break (`<br>`) as one: as the editor's counter counts. */
    public static function textLength(string $html): int
    {
        return mb_strlen(html_entity_decode(strip_tags(preg_replace('~<br\b[^>]*>~i', "\n", $html) ?? $html), \ENT_QUOTES | \ENT_HTML5, 'UTF-8'));
    }

    /** Whether the HTML holds no text and no horizontal line. */
    public static function isEmpty(string $html): bool
    {
        return '' === trim(html_entity_decode(strip_tags($html), \ENT_QUOTES | \ENT_HTML5, 'UTF-8'), " \t\n\r\0\x0B\u{A0}") && !str_contains($html, '<hr');
    }

    /**
     * The white space as the editor's parser (ProseMirror, white space not preserved) reads it, so the stored HTML counts
     * as the editor's counter shows it: each run of HTML white space (no `&nbsp;`) is one space, dropped at the start of
     * a block, after a line break or after a space, and at the end of a block. Rendering is unchanged: browsers collapse
     * it the same way. The sanitizer's output encodes `>` in text and attributes, so a `>` ends a tag.
     */
    private static function asTheEditorReadsIt(string $html): string
    {
        $parts = preg_split('~(<[^>]*>)~', $html, -1, \PREG_SPLIT_DELIM_CAPTURE | \PREG_SPLIT_NO_EMPTY) ?: [];
        $out = [];
        $lineStart = true;
        $lastText = null;
        foreach ($parts as $part) {
            if (preg_match('~^</?([a-z][a-z0-9]*)\b~i', $part, $tag)) {
                $name = strtolower($tag[1]);
                if (\in_array($name, self::BLOCKS, true)) {
                    if (null !== $lastText) {
                        $out[$lastText] = rtrim($out[$lastText], ' ');
                    }
                    $lastText = null;
                    $lineStart = true;
                } elseif ('br' === $name) {
                    $lastText = null;
                    $lineStart = true;
                }
                $out[] = $part;
                continue;
            }
            $text = preg_replace('~[ \t\n\r\f]+~', ' ', $part) ?? $part;
            if ($lineStart) {
                $text = ltrim($text, ' ');
            }
            if ('' === $text) {
                continue;
            }
            $out[] = $text;
            $lastText = array_key_last($out);
            $lineStart = str_ends_with($text, ' ');
        }

        return implode('', $out);
    }
}
