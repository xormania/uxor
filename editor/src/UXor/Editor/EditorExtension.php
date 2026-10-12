<?php

namespace App\UXor\Editor;

use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;
use Twig\TwigTest;

/**
 * `{{ post.body|flowbite_editor_html }}`: prints HTML written with the editor, sanitized again with
 * {@see EditorHtmlPolicy}, so content saved by another path is safe too. Never print it with `|raw`. The filter throws
 * a `LengthException` for HTML longer than the policy reads; `value is flowbite_editor_readable` tells it first (the
 * `Editor` shows such a value, a refused submit, empty).
 */
final class EditorExtension extends AbstractExtension
{
    public function __construct(private readonly EditorHtmlPolicy $policy)
    {
    }

    public function getFilters(): array
    {
        return [new TwigFilter('flowbite_editor_html', fn (?string $html): string => null === $html ? '' : $this->policy->sanitize($html), ['is_safe' => ['html']])];
    }

    public function getTests(): array
    {
        return [new TwigTest('flowbite_editor_readable', static fn (?string $html): bool => null === $html || EditorHtmlPolicy::isReadable($html))];
    }
}
