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

        $html = DocMarkup::resolveHtmlLinks(DocMarkup::focusableScrolling($doc->html), $recipe->name, fn (string $path): string => $this->recipePageUrl($path) ?? $this->repositoryUrl($path, $ref));

        return new RenderedRecipeDoc($html, $doc->tableOfContents);
    }

    /**
     * A README links other files by their path in the repository (`../spinner/README.md#usage`), which the gallery
     * does not serve: a recipe's README becomes its gallery page (the fragment kept: the headings' ids are their slugs,
     * as GitHub's), or null for any other file.
     */
    public function recipePageUrl(string $path): ?string
    {
        $recipe = $this->readmeRecipe($path);

        return null !== $recipe ? $this->urls->generate('app_recipe', ['recipe' => $recipe]) : null;
    }

    /**
     * The same file in the portable Markdown, saved under `r/` beside the other recipes': its name there, or null.
     */
    public function readmeRecipe(string $path): ?string
    {
        return preg_match('#^([a-z0-9][a-z0-9-]*)/README\.md$#', $path, $readme) && null !== $this->kit->getRecipe($readme[1]) ? $readme[1] : null;
    }

    /**
     * A file of the repository on GitHub, at the ref the page installs (the default branch without one).
     */
    public function repositoryUrl(string $path, ?string $ref): string
    {
        return \sprintf('%s/blob/%s/%s', $this->kit->getManifest()->homepage, $ref ?? 'main', $path);
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
        $markdown = $this->ref->during($release, fn (): string => $this->renderer->renderAsMarkdown($this->kit->getKit(), $recipe));

        // saved beside the other recipes' (`r/<recipe>.md`): a link to another recipe's README is that file
        return DocMarkup::resolveMarkdownLinks($markdown, $recipe->name, fn (string $path): string => null !== ($other = $this->readmeRecipe($path)) ? $other.'.md' : $this->repositoryUrl($path, $release));
    }
}
