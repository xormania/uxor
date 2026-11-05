<?php

namespace App\Twig;

use App\Kit\DocKitRef;
use Twig\Extension\AbstractExtension;
use Twig\TwigFunction;
use Twig\TwigTest;

/**
 * For the recipe documentation's templates (templates/bundles/UXToolkitBundle/): `recipe_doc_kit_ref()`, the kit ref
 * the documentation being rendered installs from (App\Kit\DocKitRef), and `is utf8`, whether a recipe file is text
 * the install step can print.
 */
final class RecipeDocsExtension extends AbstractExtension
{
    public function __construct(
        private readonly DocKitRef $ref,
    ) {
    }

    public function getFunctions(): array
    {
        return [
            new TwigFunction('recipe_doc_kit_ref', $this->ref->get(...)),
        ];
    }

    public function getTests(): array
    {
        return [
            new TwigTest('utf8', static fn (string $value): bool => mb_check_encoding($value, 'UTF-8')),
        ];
    }
}
