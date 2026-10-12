<?php

namespace App\Tests\Editor;

use App\UXor\Editor\EditorHtmlPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The editor's policy (editor/src/UXor/Editor/EditorHtmlPolicy.php) on hostile and ordinary HTML: it keeps the
 * toolbar's preset, removes everything else, and gives the same output when run on its own output. The browser parses
 * the Editor component given a hostile value in tests/e2e/hostile-props.spec.ts.
 */
final class EditorHtmlPolicyTest extends TestCase
{
    /** Anything outside the preset: elements, attributes and link schemes. */
    private const OUTSIDE_THE_PRESET = '/<(script|style|img|svg|math|iframe|form|input|table|div|span|h1)\b|\s(style|class|id|data-[a-z-]+|on[a-z]+|target)=|javascript:|vbscript:|data:text/i';

    private const PLAIN = '<p>Plain <strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s> <code>code</code><br>next</p>';
    private const BLOCKS = '<h2>Title</h2><h3>Sub</h3><ul><li><p>one</p><ul><li><p>nested</p></li></ul></li></ul><ol start="3"><li><p>three</p></li></ol><blockquote><p>quote</p></blockquote><hr>';
    private const LINKS = '<p><a href="https://example.com" title="Example">https</a> <a href="mailto:a@example.com">mail</a> <a href="/pricing#faq">relative</a></p>';
    private const HOSTILE_LINKS = '<p><a href="javascript:alert(1)">js</a><a href=" jav&#x09;ascript:alert(1)">js2</a><a href="data:text/html,x">data</a><a href="vbscript:x">vb</a><a href="https://example.com" target="_blank" rel="opener" onclick="x()">target</a></p>';
    private const HOSTILE = '<p style="color:red" class="x" id="y" data-controller="z" onmouseover="x()">attributes</p><script>x()</script><style>p{}</style><img src=x onerror=x()><svg onload=x()></svg><math><mi>x</mi></math><iframe src="/"></iframe><form><input></form>';
    private const FOREIGN = '<h1>H1</h1><div><span style="font-weight:bold">span</span> <b>b</b> <i>i</i></div><table><tr><td>cell</td></tr></table><p></p>';
    private const TRICKS = '<p><!-- comment --><scr<script>ipt>x()</script></p><p>&lt;script&gt;text&lt;/script&gt;</p>';
    private const EMPTY = '<p></p><p>   </p>';
    /** HTML written by hand or by another tool: lines and indentation between blocks, as the editor writes none. */
    private const INDENTED = "<h2>Title</h2>\r\n<p>one</p>\n\n<ul>\n  <li>\n    <p>item</p>\n  </li>\n  <li><p>two</p> </li>\n</ul>\n<blockquote>\n\t<p>quote</p>\n</blockquote>\n<hr>\n<ol start=\"2\">\n  <li><p>three</p></li>\n</ol>\n<p> <strong>a</strong> <em>b</em> </p>";

    /**
     * @return iterable<string, array{string}>
     */
    public static function inputs(): iterable
    {
        yield 'plain' => [self::PLAIN];
        yield 'blocks' => [self::BLOCKS];
        yield 'links' => [self::LINKS];
        yield 'hostile links' => [self::HOSTILE_LINKS];
        yield 'hostile elements and attributes' => [self::HOSTILE];
        yield 'foreign formatting' => [self::FOREIGN];
        yield 'tricks' => [self::TRICKS];
        yield 'empty' => [self::EMPTY];
        yield 'white space between blocks' => [self::INDENTED];
        // found by MarkupPropertyTest (SEED=20261011): the unwrapped div left a heading inside a heading, which the next
        // parse split, so the output was not its own output
        yield 'a heading in an unwrapped block in a heading' => ['<h2><div><h2>x</h2></div></h2><h3><span><h2>y</h2></span></h3>'];
    }

    #[DataProvider('inputs')]
    public function testTheOutputHoldsNothingOutsideThePresetAndIsStable(string $input): void
    {
        $policy = new EditorHtmlPolicy();
        $once = $policy->sanitize($input);

        self::assertDoesNotMatchRegularExpression(self::OUTSIDE_THE_PRESET, $once);
        self::assertSame($once, $policy->sanitize($once));
    }

    public function testThePresetIsKeptAsWritten(): void
    {
        $policy = new EditorHtmlPolicy();

        // the sanitizer writes void elements as <br /> and <hr />
        self::assertSame(str_replace('<br>', '<br />', self::PLAIN), $policy->sanitize(self::PLAIN));
        self::assertSame(str_replace('<hr>', '<hr />', self::BLOCKS), $policy->sanitize(self::BLOCKS));
    }

    public function testLinksKeepTheirAddressAndTitleWithTheForcedRel(): void
    {
        self::assertSame(
            '<p><a href="https://example.com" title="Example" rel="noopener noreferrer nofollow">https</a> <a href="mailto:a&#64;example.com" rel="noopener noreferrer nofollow">mail</a> <a href="/pricing#faq" rel="noopener noreferrer nofollow">relative</a></p>',
            (new EditorHtmlPolicy())->sanitize(self::LINKS),
        );
    }

    public function testHostileLinksLoseTheirAddress(): void
    {
        self::assertStringNotContainsString('href="j', (new EditorHtmlPolicy())->sanitize(self::HOSTILE_LINKS));
    }

    public function testHostileElementsAndAttributesAreRemoved(): void
    {
        self::assertSame('<p>attributes</p>', (new EditorHtmlPolicy())->sanitize(self::HOSTILE));
    }

    public function testFormattingFromElsewhereKeepsItsText(): void
    {
        $once = (new EditorHtmlPolicy())->sanitize(self::FOREIGN);

        self::assertStringContainsString('H1', $once);
        self::assertStringContainsString('cell', $once);
    }

    public function testEscapedMarkupStaysText(): void
    {
        self::assertStringContainsString('&lt;script&gt;text&lt;/script&gt;', (new EditorHtmlPolicy())->sanitize(self::TRICKS));
    }

    public function testHtmlWithoutTextIsEmpty(): void
    {
        self::assertSame('', (new EditorHtmlPolicy())->sanitize(self::EMPTY));
    }

    public function testWhiteSpaceNextToABlocksTagIsRemoved(): void
    {
        self::assertSame(
            '<h2>Title</h2><p>one</p><ul><li><p>item</p></li><li><p>two</p></li></ul><blockquote><p>quote</p></blockquote><hr /><ol start="2"><li><p>three</p></li></ol><p><strong>a</strong> <em>b</em></p>',
            (new EditorHtmlPolicy())->sanitize(self::INDENTED),
        );
    }

    public function testSpaceBetweenInlineElementsStays(): void
    {
        $html = '<p><strong>a</strong> <em>b</em> <a href="/x" rel="noopener noreferrer nofollow">c</a><br /><code>d</code></p>';

        self::assertSame($html, (new EditorHtmlPolicy())->sanitize($html));
    }

    public function testTextBetweenBlocksStays(): void
    {
        // a no-break space is text, as in the editor
        self::assertSame("<p>a</p>x<p>b</p>\u{A0}<p>c</p>", (new EditorHtmlPolicy())->sanitize("<p>a</p> x <p>b</p>\u{A0}<p>c</p>"));
    }

    public function testTheTextOfIndentedBlocksCountsAsInTheEditorsCounter(): void
    {
        // the editor's counter (getText with no block separator) shows 8 characters
        $clean = (new EditorHtmlPolicy())->sanitize("<p>ab</p>\r\n<ul>\n  <li><p>cd</p></li>\n</ul>\n<h2>ef</h2>\n<hr>\n<p>gh</p>");

        self::assertSame(8, EditorHtmlPolicy::textLength($clean));
    }

    public function testWhiteSpaceIsReadAsTheEditorsParserReadsIt(): void
    {
        $policy = new EditorHtmlPolicy();
        // ProseMirror drops white space after a line break and at a block's start and end, and makes a run one space
        self::assertSame('<p>a<br />b</p>', $policy->sanitize('<p>a<br> b</p>'));
        self::assertSame(3, EditorHtmlPolicy::textLength($policy->sanitize('<p>a<br> b</p>')));
        self::assertSame('<p>a b <strong>c</strong></p>', $policy->sanitize("<p>  a \n\t b  <strong>c </strong> </p>"));
        self::assertSame('<p>a <em>b</em></p>', $policy->sanitize('<p>a <em> b</em></p>'));
        // a no-break space is text
        self::assertSame("<p>\u{A0}a</p>", $policy->sanitize("<p> \u{A0}a</p>"));
    }

    public function testALineBreakIsOneCharacterAsInTheEditorsCounter(): void
    {
        // Tiptap's hard break is a line break in getText(): the counter shows 3 for a<br>b
        self::assertSame(3, EditorHtmlPolicy::textLength((new EditorHtmlPolicy())->sanitize('<p>a<br>b</p>')));
        self::assertSame(3, EditorHtmlPolicy::textLength('<p>a<br/>b</p>'));
        self::assertSame(5, EditorHtmlPolicy::textLength('<p>a<BR>b<br>c</p>'));
    }

    /**
     * Only an original input over MAX_INPUT_BYTES is refused: HTML under the limit whose sanitized form grows past it
     * (each `&` written `&amp;`) comes back whole, never cut by a later pass.
     */
    public function testHtmlUnderTheLimitThatGrowsWhenEscapedComesBackWhole(): void
    {
        $count = EditorHtmlPolicy::MAX_INPUT_BYTES - 7;
        $clean = (new EditorHtmlPolicy())->sanitize('<p>'.str_repeat('&', $count).'</p>');

        self::assertGreaterThan(EditorHtmlPolicy::MAX_INPUT_BYTES, \strlen($clean), 'the output is longer than the limit');
        self::assertSame($count, EditorHtmlPolicy::textLength($clean), 'every character of the text is kept');
        self::assertStringEndsWith('</p>', $clean);
    }
}
