<?php

namespace App\Tests\MarkdownEditor;

use App\UXor\MarkdownEditor\MarkdownEditor;
use App\UXor\MarkdownEditor\MarkdownRenderer;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\UX\LiveComponent\Test\InteractsWithLiveComponents;
use Symfony\UX\LiveComponent\Test\TestLiveComponent;

/**
 * The MarkdownEditor Live Component through real Live requests: its counter counts as MarkdownType and the browser's
 * counter do (a Windows line break is one character, a character beyond the BMP one), and its Preview shows Markdown
 * too long to render as such instead of failing.
 */
final class MarkdownEditorTest extends KernelTestCase
{
    use InteractsWithLiveComponents;

    private function editor(string $value, int $maxChars = 3): TestLiveComponent
    {
        return $this->createLiveComponent('MarkdownEditor', ['id' => 'body', 'name' => 'body', 'value' => $value, 'maxChars' => $maxChars]);
    }

    public function testTheCounterCountsAWindowsLineBreakAsOneCharacter(): void
    {
        $component = $this->editor("a\r\nb");
        $counter = $component->render()->crawler()->filter('[data-markdown-editor-target="counter"]');

        $editor = $component->component();
        self::assertInstanceOf(MarkdownEditor::class, $editor);
        self::assertSame(3, $editor->getLength());
        self::assertSame('3 / 3 characters', trim($counter->text()));
        self::assertNull($counter->attr('data-over'));
    }

    public function testTheCounterCountsCharactersNotBytes(): void
    {
        // 2 characters, 6 bytes, 3 UTF-16 units: the browser's counter spreads the string into its code points
        $counter = $this->editor('é😀', 2)->render()->crawler()->filter('[data-markdown-editor-target="counter"]');

        self::assertSame('2 / 2 characters', trim($counter->text()));
        self::assertNull($counter->attr('data-over'));
    }

    public function testTheCounterIsMarkedOverTheLimit(): void
    {
        $counter = $this->editor("a\r\nbc")->render()->crawler()->filter('[data-markdown-editor-target="counter"]');

        self::assertSame('4 / 3 characters', trim($counter->text()));
        self::assertNotNull($counter->attr('data-over'));
    }

    public function testThePreviewOfMarkdownTooLongToRenderSaysSo(): void
    {
        $preview = $this->editor(str_repeat('a', MarkdownRenderer::MAX_INPUT_BYTES + 1))->call('preview')->render()->crawler()->filter('#body_preview');

        self::assertSame('Too long to preview.', trim($preview->text()));
    }

    public function testThePreviewOfTheLongestMarkdownTheRendererReadsIsRendered(): void
    {
        $preview = $this->editor(str_repeat('a', MarkdownRenderer::MAX_INPUT_BYTES))->call('preview')->render()->crawler()->filter('#body_preview p');

        self::assertSame(MarkdownRenderer::MAX_INPUT_BYTES, \strlen($preview->text()));
    }
}
