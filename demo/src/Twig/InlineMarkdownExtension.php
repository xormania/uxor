<?php

namespace App\Twig;

use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;

/**
 * A recipe's description is the first paragraph of its README, in Markdown: the gallery prints its code spans and
 * links rendered, not as source.
 */
final class InlineMarkdownExtension extends AbstractExtension
{
    public function getFilters(): array
    {
        return [
            new TwigFilter('inline_markdown', self::render(...), ['is_safe' => ['html']]),
        ];
    }

    /**
     * The text escaped, its `code` spans as <code>, its [links](https://…) as <a> (http and https only), or as their
     * text alone without `$links` (inside an element that is a link already).
     */
    public static function render(string $markdown, bool $links = true): string
    {
        $html = htmlspecialchars($markdown, \ENT_QUOTES | \ENT_SUBSTITUTE | \ENT_HTML5, 'UTF-8');
        $html = preg_replace('/`([^`]+)`/', '<code>$1</code>', $html) ?? $html;

        return preg_replace_callback(
            '/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/',
            static fn (array $match): string => $links ? \sprintf('<a href="%s" class="underline hover:text-heading">%s</a>', $match[2], $match[1]) : $match[1],
            $html,
        ) ?? $html;
    }
}
