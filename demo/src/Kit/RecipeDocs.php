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
        $environment = new Environment(['heading_permalink' => ['insert' => 'none', 'apply_id_to_heading' => true]]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $environment->addExtension(new TableExtension());
        $environment->addExtension(new HeadingPermalinkExtension());
        $environment->addExtension(new AlertExtension($this->twig));
        $environment->addExtension(new TabsExtension($this->twig));
        // each tabs of a page gets its own id prefix: Toolkit's tab ids are their titles' hashes
        $environment->addRenderer(Tabs::class, new DocTabsRenderer($this->twig), 10);

        $previews = new ExamplePreviewUrls($this->kit->getExamples($recipe), $recipe->name, $this->urls);

        return $this->ref->during($ref, fn (): RenderedRecipeDoc => $this->renderer->renderAsHtml($this->kit->getKit(), $recipe, $previews, $environment));
    }

    /**
     * Portable Markdown for a consumer or their agent: always a release, never a branch.
     */
    public function markdown(Recipe $recipe, string $release): string
    {
        return $this->ref->during($release, fn (): string => $this->renderer->renderAsMarkdown($this->kit->getKit(), $recipe));
    }
}
