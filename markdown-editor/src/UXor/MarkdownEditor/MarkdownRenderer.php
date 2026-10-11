<?php

namespace App\UXor\MarkdownEditor;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\Strikethrough\StrikethroughExtension;
use League\CommonMark\MarkdownConverter;
use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/**
 * Markdown to HTML, the same for the preview and for stored content: CommonMark with strikethrough, raw HTML stripped,
 * unsafe links refused, nesting and delimiters limited; then a sanitizer keeping only what that Markdown produces.
 * Paragraphs, line breaks, bold, italic, strike, code and code blocks, headings, lists, quotes, horizontal lines and
 * links (https, http, mailto or relative, with `rel="noopener noreferrer nofollow"`). No raw HTML, image, `class`,
 * `style`, event attribute or `target`.
 *
 * Copied into your app by `ux:install markdown-editor`.
 */
final class MarkdownRenderer
{
    /** The most bytes of Markdown a field accepts by default. */
    public const MAX_BYTES = 100_000;

    /** The most characters of Markdown a field accepts by default. */
    public const MAX_CHARS = 20_000;

    /** The most bytes of Markdown the renderer reads: longer input is refused, never cut. A field's `max_bytes` stays at or below it. */
    public const MAX_INPUT_BYTES = 1_000_000;

    private const ELEMENTS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'li', 'blockquote', 'hr'];

    private readonly MarkdownConverter $converter;

    private readonly HtmlSanitizer $sanitizer;

    public function __construct()
    {
        $environment = new Environment([
            'html_input' => 'strip',
            'allow_unsafe_links' => false,
            'max_nesting_level' => 20,
            'max_delimiters_per_line' => 500,
        ]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $environment->addExtension(new StrikethroughExtension());
        $this->converter = new MarkdownConverter($environment);

        $config = (new HtmlSanitizerConfig())
            // no limit here: the sanitizer would cut longer HTML, and CommonMark's escaping makes the HTML several times
            // longer than its Markdown (`&` is `&amp;`); toHtml() refuses Markdown over MAX_INPUT_BYTES before converting
            ->withMaxInputLength(-1)
            ->allowLinkSchemes(['https', 'http', 'mailto'])
            ->allowRelativeLinks(true)
            ->allowElement('ol', ['start'])
            ->allowElement('a', ['href', 'title'])
            ->forceAttribute('a', 'rel', 'noopener noreferrer nofollow');
        foreach (self::ELEMENTS as $element) {
            $config = $config->allowElement($element);
        }
        $this->sanitizer = new HtmlSanitizer($config);
    }

    /**
     * The Markdown as HTML with only the elements above; '' for blank Markdown.
     *
     * @throws \LengthException when the Markdown is longer than MAX_INPUT_BYTES, instead of rendering part of it
     */
    public function toHtml(string $markdown): string
    {
        if (\strlen($markdown) > self::MAX_INPUT_BYTES) {
            throw new \LengthException(\sprintf('The Markdown holds %d bytes, more than the %d the renderer reads.', \strlen($markdown), self::MAX_INPUT_BYTES));
        }
        if ('' === trim($markdown)) {
            return '';
        }

        return trim($this->sanitizer->sanitize($this->converter->convert($markdown)->getContent()));
    }
}
