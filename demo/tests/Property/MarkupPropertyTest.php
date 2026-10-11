<?php

namespace App\Tests\Property;

use App\UXor\Editor\EditorHtmlPolicy;
use App\UXor\MarkdownEditor\MarkdownRenderer;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;
use Random\Randomizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizer;

/**
 * The editor's HTML policy and the Markdown renderer on random input built from hostile and ordinary pieces (allowed
 * and refused tags, event and style attributes, link schemes, entities, comments, broken and nested markup): the
 * output holds no `<script>`, no `on*` attribute and no unsafe link, and is stable (the policy on its own output gives
 * the same output; the renderer's HTML, sanitized again by its own sanitizer, is unchanged). The release checks run
 * them with a random seed (Seeded).
 */
#[Group('property')]
final class MarkupPropertyTest extends TestCase
{
    use Seeded;

    /** What no output may hold: a script, an event attribute, a link or source with an unsafe scheme. */
    private const UNSAFE = '~<script\b|<(iframe|object|embed|style|img|svg)\b|\son[a-z]+\s*=|(href|src)\s*=\s*["\']?\s*(javascript|vbscript|data):~i';

    public function testTheEditorPolicyIsStableAndKeepsNothingUnsafe(): void
    {
        $seed = $this->seed(20261011);
        $random = $this->randomizer($seed);
        $policy = new EditorHtmlPolicy();
        for ($run = 1; $run <= $this->runs(); ++$run) {
            $html = $this->html($random, 3);
            $case = \sprintf('SEED=%d, run %d, input %s', $seed, $run, json_encode($html, \JSON_INVALID_UTF8_SUBSTITUTE));
            $once = $policy->sanitize($html);

            self::assertDoesNotMatchRegularExpression(self::UNSAFE, $once, $case);
            self::assertSame($once, $policy->sanitize($once), "$case: sanitize(sanitize(x)) differs from sanitize(x)");
        }
    }

    public function testTheMarkdownRendererIsStableAndKeepsNothingUnsafe(): void
    {
        $seed = $this->seed(20261012);
        $random = $this->randomizer($seed);
        $renderer = new MarkdownRenderer();
        $sanitizer = (new \ReflectionProperty(MarkdownRenderer::class, 'sanitizer'))->getValue($renderer);
        self::assertInstanceOf(HtmlSanitizer::class, $sanitizer);
        for ($run = 1; $run <= $this->runs(); ++$run) {
            $markdown = $this->markdown($random);
            $case = \sprintf('SEED=%d, run %d, input %s', $seed, $run, json_encode($markdown, \JSON_INVALID_UTF8_SUBSTITUTE));
            $html = $renderer->toHtml($markdown);

            self::assertDoesNotMatchRegularExpression(self::UNSAFE, $html, $case);
            self::assertSame($html, trim($sanitizer->sanitize($html)), "$case: its HTML sanitized again differs");
            self::assertSame($html, $renderer->toHtml($markdown), "$case: two renderings differ");
        }
    }

    public function testInputOverTheLimitIsRefusedNotCut(): void
    {
        $seed = $this->seed(20261013);
        $random = $this->randomizer($seed);
        $over = EditorHtmlPolicy::MAX_INPUT_BYTES + $random->getInt(1, 1_000);
        $html = '<p>'.str_repeat('x', $over - 7).'</p>';
        try {
            (new EditorHtmlPolicy())->sanitize($html);
            self::fail(\sprintf('SEED=%d: %d bytes of HTML were not refused', $seed, \strlen($html)));
        } catch (\LengthException) {
        }
        try {
            (new MarkdownRenderer())->toHtml(str_repeat('y', MarkdownRenderer::MAX_INPUT_BYTES + $random->getInt(1, 1_000)));
            self::fail(\sprintf('SEED=%d: Markdown over the limit was not refused', $seed));
        } catch (\LengthException) {
        }
        $this->addToAssertionCount(2);
    }

    /** Random HTML: text, entities and comments, allowed and refused elements with hostile attributes, nested, sometimes broken. */
    private function html(Randomizer $random, int $depth): string
    {
        $out = '';
        for ($i = $random->getInt(1, 4); $i > 0; --$i) {
            $out .= match ($random->getInt(0, 9)) {
                0, 1 => $this->text($random),
                2 => $this->pick($random, ['&lt;script&gt;', '&amp;', '&#106;avascript:', '&nbsp;', '&#x3C;img&#x3E;', '<!-- <script>x()</script> -->', '<![CDATA[x]]>', "\u{a0}", "\n  \t"]),
                3 => $this->pick($random, ['<script>alert(1)</script>', '<style>p{}</style>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<iframe src="/"></iframe>', '<scr<script>ipt>alert(1)</script>', '<math><mi xlink:href="javascript:x">y</mi></math>']),
                4 => $this->pick($random, ['<br>', '<hr>', '<br/>', '</p>', '<p', '<<p>>', '<a href=', '">', "'", '</ul></li>']),
                default => $this->element($random, $depth),
            };
        }

        return $out;
    }

    private function element(Randomizer $random, int $depth): string
    {
        $tag = $this->pick($random, ['p', 'strong', 'em', 'u', 's', 'code', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'b', 'i', 'span', 'div', 'h1', 'table', 'td', 'pre', 'form', 'input', 'textarea', 'select', 'object', 'template', 'noscript', 'button', 'details']);
        $attributes = '';
        for ($i = $random->getInt(0, 3); $i > 0; --$i) {
            $attributes .= ' '.$this->pick($random, [
                'onclick="alert(1)"', 'onmouseover=alert(1)', 'ONLOAD="x()"', 'style="color:red"', 'class="x"', 'id="y"', 'data-controller="z"',
                'href="javascript:alert(1)"', 'href=" JaVa&#x09;ScRiPt:alert(1)"', 'href="data:text/html,x"', 'href="vbscript:x"', 'href="https://example.com"',
                'href="/relative"', 'href="mailto:a@example.com"', 'target="_blank"', 'rel="opener"', 'start="3"', 'title="t"', 'src="x"', 'formaction="javascript:x"',
            ]);
        }
        $inner = $depth > 0 ? $this->html($random, $depth - 1) : $this->text($random);

        return 0 === $random->getInt(0, 9) ? "<$tag$attributes>$inner" : "<$tag$attributes>$inner</$tag>";
    }

    private function text(Randomizer $random): string
    {
        return $this->pick($random, ['Hello', 'world', ' ', 'a < b', 'x > y', '"quoted"', "it's", 'é', '😀', 'javascript:alert(1)', '{{ x }}', '%3Cscript%3E', 'text']);
    }

    /** Random Markdown: emphasis, code, headings, lists, quotes, links of every scheme, autolinks, images and raw HTML. */
    private function markdown(Randomizer $random): string
    {
        $out = '';
        for ($i = $random->getInt(1, 8); $i > 0; --$i) {
            $out .= match ($random->getInt(0, 11)) {
                0 => '**'.$this->text($random).'**',
                1 => '_'.$this->text($random).'_ ~~'.$this->text($random).'~~',
                2 => '`'.$this->text($random).'`',
                3 => "\n\n".str_repeat('#', $random->getInt(1, 7)).' '.$this->text($random)."\n\n",
                4 => "\n- ".$this->text($random)."\n  - ".$this->text($random)."\n",
                5 => "\n".$random->getInt(0, 99).'. '.$this->text($random)."\n",
                6 => "\n> ".$this->text($random)."\n",
                7 => '['.$this->text($random).']('.$this->pick($random, ['javascript:alert(1)', 'JAVASCRIPT:x', 'jav&#x09;ascript:x', 'data:text/html,x', 'vbscript:x', 'https://example.com', '/relative', 'mailto:a@example.com', '<javascript:x>', '"onclick=x"']).')',
                8 => $this->pick($random, ['<javascript:alert(1)>', '<https://example.org>', '![p](https://example.com/a.png)', '![x](javascript:x)', '[ref][r]'."\n\n[r]: javascript:x"]),
                9 => $this->html($random, 1),
                10 => "\n```\n".$this->html($random, 0)."\n```\n",
                default => ' '.$this->text($random).' ',
            };
        }

        return $out;
    }
}
