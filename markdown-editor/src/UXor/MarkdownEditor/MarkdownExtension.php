<?php

namespace App\UXor\MarkdownEditor;

use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;

/**
 * `{{ post.body|flowbite_markdown_html }}`: prints stored Markdown as HTML with {@see MarkdownRenderer}, the same
 * rendering as the editor's preview. Never print the Markdown with `|raw` or `|markdown_to_html` instead.
 */
final class MarkdownExtension extends AbstractExtension
{
    public function __construct(private readonly MarkdownRenderer $renderer)
    {
    }

    public function getFilters(): array
    {
        return [new TwigFilter('flowbite_markdown_html', fn (?string $markdown): string => null === $markdown ? '' : $this->renderer->toHtml($markdown), ['is_safe' => ['html']])];
    }
}
