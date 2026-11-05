<?php

namespace App\Kit;

use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\UX\Toolkit\Markdown\CodeOptions;
use Symfony\UX\Toolkit\Markdown\PreviewUrlGenerator;

/**
 * The preview page of each `{"preview": true}` example of one recipe's README: the gallery's own app_preview
 * route, by the example id KitReader gives it, so the documentation and the gallery show the same previews.
 *
 * The renderer asks in document order; the same code twice in a README is two examples, matched in turn.
 * The URL has no theme: the preview template adds `?theme=light` and `?theme=dark`.
 */
final class ExamplePreviewUrls implements PreviewUrlGenerator
{
    /** @var array<int, string> the code of the examples not matched yet, by their index in $examples */
    private array $pending = [];

    /**
     * @param list<array{id: string, code: string}> $examples KitReader::getExamples()
     */
    public function __construct(
        private readonly array $examples,
        private readonly string $recipe,
        private readonly UrlGeneratorInterface $urls,
    ) {
        foreach ($examples as $index => $example) {
            $this->pending[$index] = $example['code'];
        }
    }

    public function generate(string $code, CodeOptions $options): ?string
    {
        $index = array_search(rtrim($code, "\r\n"), $this->pending, true);
        if (false === $index) {
            return null;
        }
        unset($this->pending[$index]);

        return $this->urls->generate('app_preview', ['recipe' => $this->recipe, 'example' => $this->examples[$index]['id']]);
    }
}
