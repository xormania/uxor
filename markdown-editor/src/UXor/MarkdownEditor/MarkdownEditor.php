<?php

namespace App\UXor\MarkdownEditor;

use Symfony\UX\LiveComponent\Attribute\AsLiveComponent;
use Symfony\UX\LiveComponent\Attribute\LiveAction;
use Symfony\UX\LiveComponent\Attribute\LiveProp;
use Symfony\UX\LiveComponent\DefaultActionTrait;

/**
 * A Markdown textarea with Write and Preview tabs: the preview is rendered by the server with {@see MarkdownRenderer},
 * as the stored content will be. The textarea is native and submits its Markdown under `name`; typing sends nothing
 * to the server, the Preview tab does.
 */
#[AsLiveComponent(name: 'MarkdownEditor', template: 'components/MarkdownEditor.html.twig')]
final class MarkdownEditor
{
    use DefaultActionTrait;

    /** The textarea's id: a `FormField` label's `for` and the help and error ids (`<id>_help`, `<id>_error`) derive from it. */
    #[LiveProp]
    public string $id = '';

    /** The name the Markdown submits under. */
    #[LiveProp]
    public string $name = '';

    /** The Markdown. */
    #[LiveProp(writable: true)]
    public string $value = '';

    /** The textarea's accessible name, when no label points at it. */
    #[LiveProp]
    public ?string $label = null;

    /** A text shown while the textarea is empty. */
    #[LiveProp]
    public ?string $placeholder = null;

    /** The textarea's height, in lines. */
    #[LiveProp]
    public int $rows = 8;

    /** The most characters the server accepts; a counter shows them. */
    #[LiveProp]
    public int $maxChars = MarkdownRenderer::MAX_CHARS;

    /** The counter's text: `%count%` and `%max%` are replaced. */
    #[LiveProp]
    public string $counterText = '%count% / %max% characters';

    /** The toolbar's accessible name. */
    #[LiveProp]
    public string $toolbarLabel = 'Formatting';

    #[LiveProp]
    public bool $readonly = false;

    /** Whether the textarea is disabled (it does not submit). */
    #[LiveProp]
    public bool $disabled = false;

    /** Whether the Preview tab is open. */
    #[LiveProp]
    public bool $previewing = false;

    public function __construct(private readonly MarkdownRenderer $renderer)
    {
    }

    #[LiveAction]
    public function preview(): void
    {
        $this->previewing = true;
    }

    #[LiveAction]
    public function write(): void
    {
        $this->previewing = false;
    }

    /** The preview's HTML, or null when the Markdown is too long to render. */
    public function getPreviewHtml(): ?string
    {
        try {
            return $this->renderer->toHtml($this->value);
        } catch (\LengthException) {
            return null;
        }
    }

    /** The number of characters, as the counter and MarkdownType count them. */
    public function getLength(): int
    {
        return mb_strlen(str_replace("\r\n", "\n", $this->value));
    }
}
