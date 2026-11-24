<?php

namespace UXor\Website;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\CommonMark\Node\Block\Heading;
use League\CommonMark\Extension\HeadingPermalink\HeadingPermalinkExtension;
use League\CommonMark\Extension\Table\TableExtension;
use League\CommonMark\MarkdownConverter;
use League\CommonMark\Node\NodeIterator;
use League\CommonMark\Node\RawMarkupContainerInterface;
use League\CommonMark\Node\StringContainerHelper;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;

/**
 * The consumer guides the gallery publishes from the repository's own files, as HTML and portable Markdown.
 *
 * Their links name files in the repository: a recipe's README becomes its gallery page (r/<recipe>.md in Markdown),
 * the other guide its page, the recipe list the gallery's own, any other file its page on GitHub at the ref the copy
 * installs. On a copy of a release, the install commands' `:<version>` names it.
 */
final class GuideDocs
{
    private const REPOSITORY_DOC_PREFIX = 'https://github.com/xormania/uxor/blob/main/';

    /** @var array<string, array{section: string, file: string, title: string, description: string}> */
    private readonly array $guides;

    public function __construct(
        private readonly string $kitDir,
        private readonly RecipeDocs $recipes,
        private readonly UrlGeneratorInterface $urls,
    ) {
        $guides = json_decode((new Filesystem())->readFile($kitDir.'/packages/uxor/resources/guides.json'), true, flags: \JSON_THROW_ON_ERROR);
        foreach ($guides as $slug => $guide) {
            if (!preg_match('/^[a-z][a-z0-9-]*$/D', (string) $slug) || in_array($slug, ['r', 'demo', 'preview', 'assets', 'website-assets'], true)
                || !isset($guide['file'], $guide['title'], $guide['description'], $guide['section']) || !is_string($guide['section']) || '' === trim($guide['section'])) {
                throw new \InvalidArgumentException('Invalid public guide entry: '.$slug);
            }
        }
        $this->guides = $guides;
    }

    /** @return array<string, array{section: string, file: string, title: string, description: string}> */
    public function all(): array
    {
        return $this->guides;
    }

    /** @return list<array{title: string, guides: array}> */
    public function sections(): array
    {
        $sections = [];
        foreach ($this->guides as $slug => $guide) {
            $title = $guide['section'];
            $sections[$title] ??= ['title' => $title, 'guides' => []];
            $sections[$title]['guides'][$slug] = $guide;
        }

        return array_values($sections);
    }

    /**
     * @param string|null $ref the release (or a development copy's branch) the copy installs; null for the default branch
     * @return array{doc: string, guide_toc: list<array{id: string, title: string}>}
     */
    public function render(string $name, ?string $ref = null): array
    {
        $environment = new Environment(['heading_permalink' => ['insert' => 'none', 'apply_id_to_heading' => true, 'id_prefix' => '', 'fragment_prefix' => '']]);
        $environment->addExtension(new CommonMarkCoreExtension());
        $environment->addExtension(new TableExtension());
        $environment->addExtension(new HeadingPermalinkExtension());

        $result = (new MarkdownConverter($environment))->convert($this->source($name, $ref));
        $contents = [];
        foreach ($result->getDocument()->iterator(NodeIterator::FLAG_BLOCKS_ONLY) as $node) {
            if ($node instanceof Heading && 2 === $node->getLevel()) {
                $contents[] = [
                    'id' => $node->data->get('attributes/id'),
                    'title' => StringContainerHelper::getChildText($node, [RawMarkupContainerInterface::class]),
                ];
            }
        }
        $html = DocMarkup::resolveHtmlLinks(DocMarkup::focusableScrolling($result->getContent()), \dirname($this->guides[$name]['file']), fn (string $path): string => match (true) {
            null !== $page = $this->recipes->recipePageUrl($path) => $page,
            null !== $guide = $this->slugForFile($path) => $this->urls->generate('app_guide', ['name' => $guide]),
            'docs/RECIPES.md' === $path => $this->urls->generate('app_index').'#recipes',
            default => $this->recipes->repositoryUrl($path, $ref),
        }, self::REPOSITORY_DOC_PREFIX);

        return ['doc' => $html, 'guide_toc' => $contents];
    }

    /**
     * Portable Markdown, saved at the copy's root beside the recipes' (`r/<recipe>.md`): always a release or a branch.
     */
    public function markdown(string $name, string $ref): string
    {
        return DocMarkup::resolveMarkdownLinks($this->source($name, $ref), \dirname($this->guides[$name]['file']), fn (string $path): string => match (true) {
            null !== $recipe = $this->recipes->readmeRecipe($path) => 'r/'.$recipe.'.md',
            null !== $guide = $this->slugForFile($path) => $guide.'.md',
            default => $this->recipes->repositoryUrl($path, $ref),
        }, self::REPOSITORY_DOC_PREFIX);
    }

    /**
     * The guide's Markdown, its `:<version>` naming the release a copy of one installs.
     */
    private function source(string $name, ?string $ref): string
    {
        $path = realpath($this->kitDir).'/'.$this->guides[$name]['file'];
        if (!str_ends_with($path, '.md') || realpath($path) !== $path || !is_file($path)) {
            throw new \RuntimeException('Guide source must be a Markdown file inside the kit: '.$name);
        }
        $markdown = (new Filesystem())->readFile($path);

        return null !== $ref && preg_match('/^\d+\.\d+\.\d+$/', $ref) ? str_replace('uxor:<version>', 'uxor:'.$ref, $markdown) : $markdown;
    }

    /**
     * The guide a repository path names, or null.
     */
    public function slugForFile(string $path): ?string
    {
        foreach ($this->guides as $name => $guide) {
            if ($guide['file'] === $path) {
                return $name;
            }
        }

        return null;
    }
}
