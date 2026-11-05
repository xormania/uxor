<?php

namespace App\Kit;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\HeadingPermalink\HeadingPermalinkExtension;
use League\CommonMark\Extension\Table\TableExtension;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\UX\Toolkit\Doc\RecipeDocRenderer;
use Symfony\UX\Toolkit\Doc\RenderedRecipeDoc;
use Symfony\UX\Toolkit\Markdown\Extension\Alert\AlertExtension;
use Symfony\UX\Toolkit\Markdown\Extension\Tabs\Node\Tabs;
use Symfony\UX\Toolkit\Markdown\Extension\Tabs\TabsExtension;
use Symfony\UX\Toolkit\Recipe\Recipe;
use Twig\Environment as Twig;

/**
 * A recipe's documentation, rendered by the UX Toolkit's RecipeDocRenderer from its README: the prose, the
 * `::: installation` steps and the `::: api-reference` tables generated from its `{% props %}` and blocks.
 *
 * UXor's side of it is small and lives in templates/bundles/UXToolkitBundle/: the install command names this
 * kit's repository and release, the API tables print each description, the tabs and alerts are the kit's own
 * components, and each example is its gallery preview page (app_preview, found by ExamplePreviewUrls) in both themes.
 */
final class RecipeDocs
{
    private readonly RecipeDocRenderer $renderer;

    public function __construct(
        private readonly KitReader $kit,
        private readonly Twig $twig,
        private readonly UrlGeneratorInterface $urls,
        private readonly DocKitRef $ref,
    ) {
        $this->renderer = new RecipeDocRenderer($twig);
    }

    /**
     * @param string|null $ref the release (or a development copy's branch) its install step names; null for the
     *                         repository's default branch, as the dev server's pages install
     */
    public function html(Recipe $recipe, ?string $ref = null): RenderedRecipeDoc
    {
        // the renderer's own default, without the popover extension: the API tables print the descriptions
        // (templates/bundles/UXToolkitBundle/doc/_api_reference.md.twig)
        // the headings' ids are their slugs, as the gallery's example anchors were (`/r/badge#large-badges`)
        $environment = new Environment(['heading_permalink' => ['insert' => 'none', 'apply_id_to_heading' => true, 'id_prefix' => '', 'fragment_prefix' => '']]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $environment->addExtension(new TableExtension());
        $environment->addExtension(new HeadingPermalinkExtension());
        $environment->addExtension(new AlertExtension($this->twig));
        $environment->addExtension(new TabsExtension($this->twig));
        // each tabs of a page gets its own id prefix: Toolkit's tab ids are their titles' hashes
        $environment->addRenderer(Tabs::class, new DocTabsRenderer($this->twig), 10);

        $previews = new ExamplePreviewUrls($this->kit->getExamples($recipe), $recipe->name, $this->urls);

        $doc = $this->ref->during($ref, fn (): RenderedRecipeDoc => $this->renderer->renderAsHtml($this->kit->getKit(), $recipe, $previews, $environment));

        return new RenderedRecipeDoc($this->resolveLinks(self::focusableScrolling($doc->html), $recipe, $ref), $doc->tableOfContents);
    }

    /**
     * A README links other files by their path in the repository (`../spinner/README.md#usage`), which the gallery
     * does not serve: a recipe's README becomes its gallery page, the fragment kept (the headings' ids are their slugs,
     * as GitHub's); any other file, its page on GitHub at the ref the page installs. Absolute paths, fragments and URLs
     * with a scheme stay as they are.
     */
    private function resolveLinks(string $html, Recipe $recipe, ?string $ref): string
    {
        return preg_replace_callback('#<a href="(?![a-z][a-z0-9+.-]*:|/|\#)([^"\#]*)(\#[^"]*)?"#i', function (array $match) use ($recipe, $ref): string {
            $parts = [];
            foreach (explode('/', $recipe->name.'/'.html_entity_decode($match[1])) as $part) {
                if ('..' === $part) {
                    array_pop($parts);
                } elseif ('' !== $part && '.' !== $part) {
                    $parts[] = $part;
                }
            }
            $path = implode('/', $parts);
            $fragment = $match[2] ?? '';

            if (preg_match('#^([a-z0-9][a-z0-9-]*)/README\.md$#', $path, $readme) && null !== $this->kit->getRecipe($readme[1])) {
                $url = $this->urls->generate('app_recipe', ['recipe' => $readme[1]]);
            } else {
                $url = \sprintf('%s/blob/%s/%s', $this->kit->getManifest()->homepage, $ref ?? 'main', $path);
            }

            return \sprintf('<a href="%s%s"', htmlspecialchars($url, \ENT_QUOTES), $fragment);
        }, $html) ?? $html;
    }

    /**
     * A code block and a table scroll sideways when they are wider than the page: each can take the focus, so a
     * keyboard reaches what is past its edge (axe: scrollable-region-focusable). CommonMark writes them bare.
     */
    private static function focusableScrolling(string $html): string
    {
        $html = str_replace('<pre>', '<pre tabindex="0">', $html);

        return str_replace(['<table>', '</table>'], ['<div class="recipe-doc-table" tabindex="0"><table>', '</table></div>'], $html);
    }

    /**
     * The documentation on the recipe page, which prints the recipe's name and description itself: the HTML without
     * the README's title and the paragraph under it (the description, KitReader's first paragraph).
     */
    public function page(Recipe $recipe, ?string $ref = null): string
    {
        $html = $this->html($recipe, $ref)->html;

        return preg_replace('#^\s*<h1\b[^>]*>.*?</h1>\s*(?:<p>.*?</p>\s*)?#s', '', $html, 1) ?? $html;
    }

    /**
     * Portable Markdown for a consumer or their agent: always a release, never a branch.
     */
    public function markdown(Recipe $recipe, string $release): string
    {
        return $this->ref->during($release, fn (): string => $this->renderer->renderAsMarkdown($this->kit->getKit(), $recipe));
    }
}
