<?php

namespace App\Kit;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\HeadingPermalink\HeadingPermalinkExtension;
use League\CommonMark\Extension\Table\TableExtension;
use League\CommonMark\MarkdownConverter;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;

/**
 * The consumer guides the gallery publishes, from the repository's own files: getting started (INSTALL.md) and the
 * guide (docs/GUIDE.md), as pages (/install, /guide) and as portable Markdown beside them (/install.md, /guide.md).
 *
 * Their links name files in the repository: a recipe's README becomes its gallery page (r/<recipe>.md in Markdown),
 * the other guide its page, the recipe list the gallery's own, any other file its page on GitHub at the ref the copy
 * installs. On a copy of a release, the install commands' `:<version>` names it.
 */
final class GuideDocs
{
    /** the guides, by name: their file in the repository, their title and description in the gallery */
    public const GUIDES = [
        'install' => ['file' => 'INSTALL.md', 'title' => 'Getting started', 'description' => 'Set a Symfony project up for the UXor kit: requirements, Tailwind CSS and Flowbite CSS, the theme, then installing recipes with ux:install.'],
        'guide' => ['file' => 'docs/GUIDE.md', 'title' => 'Guide', 'description' => "Installing and updating the UXor kit's recipes, using them with Turbo and Live Components, security, and versioning."],
    ];

    public function __construct(
        #[Autowire('%app.kit_dir%')]
        private readonly string $kitDir,
        private readonly RecipeDocs $recipes,
        private readonly UrlGeneratorInterface $urls,
    ) {
    }

    /**
     * @param string|null $ref the release (or a development copy's branch) the copy installs; null for the dev server
     */
    public function html(string $name, ?string $ref = null): string
    {
        $environment = new Environment(['heading_permalink' => ['insert' => 'none', 'apply_id_to_heading' => true, 'id_prefix' => '', 'fragment_prefix' => '']]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $environment->addExtension(new TableExtension());
        $environment->addExtension(new HeadingPermalinkExtension());

        $html = (string) new MarkdownConverter($environment)->convert($this->source($name, $ref));

        return DocMarkup::resolveHtmlLinks(DocMarkup::focusableScrolling($html), \dirname(self::GUIDES[$name]['file']), fn (string $path): string => match (true) {
            null !== $page = $this->recipes->recipePageUrl($path) => $page,
            null !== $guide = self::guide($path) => $this->urls->generate('app_guide', ['name' => $guide]),
            'docs/RECIPES.md' === $path => $this->urls->generate('app_index').'#recipes',
            default => $this->recipes->repositoryUrl($path, $ref),
        });
    }

    /**
     * Portable Markdown, saved at the copy's root beside the recipes' (`r/<recipe>.md`): always a release or a branch.
     */
    public function markdown(string $name, string $ref): string
    {
        return DocMarkup::resolveMarkdownLinks($this->source($name, $ref), \dirname(self::GUIDES[$name]['file']), fn (string $path): string => match (true) {
            null !== $recipe = $this->recipes->readmeRecipe($path) => 'r/'.$recipe.'.md',
            null !== $guide = self::guide($path) => $guide.'.md',
            default => $this->recipes->repositoryUrl($path, $ref),
        });
    }

    /**
     * The guide's Markdown, its `:<version>` naming the release a copy of one installs.
     */
    private function source(string $name, ?string $ref): string
    {
        $markdown = (new Filesystem())->readFile(Path::join($this->kitDir, self::GUIDES[$name]['file']));

        return null !== $ref && preg_match('/^\d+\.\d+\.\d+$/', $ref) ? str_replace('uxor:<version>', 'uxor:'.$ref, $markdown) : $markdown;
    }

    /**
     * The guide a repository path names, or null.
     */
    private static function guide(string $path): ?string
    {
        foreach (self::GUIDES as $name => $guide) {
            if ($guide['file'] === $path) {
                return $name;
            }
        }

        return null;
    }
}
