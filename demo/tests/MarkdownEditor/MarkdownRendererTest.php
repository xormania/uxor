<?php

namespace App\Tests\MarkdownEditor;

use App\UXor\MarkdownEditor\MarkdownRenderer;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The Markdown renderer (markdown-editor/src/UXor/MarkdownEditor/MarkdownRenderer.php) on hostile and ordinary
 * Markdown: it keeps what Markdown makes, strips raw HTML and images, refuses unsafe links, limits nesting, and renders
 * HTML far longer than its Markdown whole. The browser parses the MarkdownEditor component given a hostile value in
 * tests/e2e/hostile-props.spec.ts.
 */
final class MarkdownRendererTest extends TestCase
{
    /** Raw HTML, images, attributes outside the preset, and an unsafe link address (an unsafe autolink keeps its text only). */
    private const OUTSIDE_THE_PRESET = '/<(script|style|img|svg|iframe|b)\b|\s(style|class|id|on[a-z]+|target)=|="\s*(javascript|vbscript|data):/i';

    private const PLAIN = "**bold** _italic_ ~~strike~~ `code`  \nnext line";
    private const BLOCKS = "# H1\n\n### H3\n\n- one\n  - nested\n\n3. three\n\n> quote\n\n```js\ncode <b>x</b>\n```\n\n---";
    private const LINKS = '[https](https://example.com "Example") [mail](mailto:a@example.com) [relative](/pricing#faq) <https://example.org>';
    private const HOSTILE_LINKS = '[js](javascript:alert(1)) [JS](JAVASCRIPT:alert(1)) [data](data:text/html,x) [vb](vbscript:x) <javascript:alert(1)> [tab](jav&#x09;ascript:x)';
    private const RAW = '<script>x()</script> <img src=x onerror=x()> <p style="color:red" onclick="x()">raw</p> <iframe src="/"></iframe> <b onmouseover="x()">b</b> <svg onload=x()></svg>';
    private const IMAGES = "![picture](https://example.com/a.png) ![ref][pic]\n\n[pic]: https://example.com/b.png";
    private const BLANK = "   \n\n  ";

    private static function deep(): string
    {
        return str_repeat('> ', 60).'deep';
    }

    private static function delimiters(): string
    {
        return str_repeat('*a', 3000);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function inputs(): iterable
    {
        yield 'plain' => [self::PLAIN];
        yield 'blocks' => [self::BLOCKS];
        yield 'links' => [self::LINKS];
        yield 'hostile links' => [self::HOSTILE_LINKS];
        yield 'raw HTML' => [self::RAW];
        yield 'images' => [self::IMAGES];
        yield 'deep nesting' => [self::deep()];
        yield 'many delimiters' => [self::delimiters()];
        yield 'blank' => [self::BLANK];
    }

    #[DataProvider('inputs')]
    public function testTheHtmlHoldsNothingOutsideThePreset(string $markdown): void
    {
        self::assertDoesNotMatchRegularExpression(self::OUTSIDE_THE_PRESET, (new MarkdownRenderer())->toHtml($markdown));
    }

    public function testInlineFormattingAndLineBreaks(): void
    {
        self::assertSame("<p><strong>bold</strong> <em>italic</em> <del>strike</del> <code>code</code><br />\nnext line</p>", (new MarkdownRenderer())->toHtml(self::PLAIN));
    }

    public function testBlocksAndACodeBlockShownAsText(): void
    {
        $html = (new MarkdownRenderer())->toHtml(self::BLOCKS);

        self::assertStringContainsString('<h1>H1</h1>', $html);
        self::assertStringContainsString('<ol start="3">', $html);
        // a code block shows its HTML as text, without the language class
        self::assertStringContainsString("<pre><code>code &lt;b&gt;x&lt;/b&gt;\n</code></pre>", $html);
    }

    public function testLinksGetTheForcedRel(): void
    {
        $html = (new MarkdownRenderer())->toHtml(self::LINKS);

        self::assertStringContainsString('<a href="/pricing#faq" rel="noopener noreferrer nofollow">relative</a>', $html);
        self::assertStringContainsString('<a href="https://example.org" rel="noopener noreferrer nofollow">https://example.org</a>', $html);
    }

    public function testUnsafeLinksLoseTheirAddress(): void
    {
        self::assertStringNotContainsString('href=', (new MarkdownRenderer())->toHtml(self::HOSTILE_LINKS));
    }

    public function testRawHtmlIsStripped(): void
    {
        self::assertSame('', (new MarkdownRenderer())->toHtml(self::RAW));
    }

    public function testImagesAreDropped(): void
    {
        self::assertStringNotContainsString('example.com', (new MarkdownRenderer())->toHtml(self::IMAGES));
    }

    public function testNestingStopsAtTwentyLevels(): void
    {
        self::assertSame(20, substr_count((new MarkdownRenderer())->toHtml(self::deep()), '<blockquote>'));
    }

    public function testManyDelimitersStillRender(): void
    {
        self::assertNotSame('', (new MarkdownRenderer())->toHtml(self::delimiters()));
    }

    public function testBlankMarkdownIsEmpty(): void
    {
        self::assertSame('', (new MarkdownRenderer())->toHtml(self::BLANK));
    }

    public function testHtmlFarLongerThanItsMarkdownIsRenderedWhole(): void
    {
        // each `&` is `&amp;`: the HTML is five times longer than the Markdown, under the input limit
        $html = (new MarkdownRenderer())->toHtml(str_repeat('&', 900_000));

        self::assertSame(900_000, substr_count($html, '&amp;'));
        self::assertStringEndsWith('</p>', $html);
    }
}
