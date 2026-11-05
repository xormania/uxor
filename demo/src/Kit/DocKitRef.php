<?php

namespace App\Kit;

/**
 * The kit ref (a release, or a branch for a development copy) the recipe documentation RecipeDocs is rendering
 * installs from: the `--kit=<repository>:<ref>` of its `::: installation` step. Toolkit's renderer gives its
 * templates a fixed context, so RecipeDocs sets it here for one render and the template reads it through the
 * `recipe_doc_kit_ref()` Twig function (App\Twig\RecipeDocsExtension). Null outside a render, or for the dev
 * server's pages, which install the repository's default branch.
 */
final class DocKitRef
{
    private ?string $ref = null;

    /**
     * @template T
     *
     * @param \Closure(): T $render
     *
     * @return T
     */
    public function during(?string $ref, \Closure $render): mixed
    {
        $previous = $this->ref;
        $this->ref = $ref;
        try {
            return $render();
        } finally {
            $this->ref = $previous;
        }
    }

    public function get(): ?string
    {
        return $this->ref;
    }
}
