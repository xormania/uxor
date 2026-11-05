<?php

namespace App\Controller;

use App\Kit\GuideDocs;
use App\Kit\KitReader;
use App\Kit\RecipeDocs;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\UX\Toolkit\Dependency\ImportmapPackageDependency;
use Symfony\UX\Toolkit\Dependency\NpmPackageDependency;
use Symfony\UX\Toolkit\Dependency\PhpPackageDependency;
use Symfony\UX\Toolkit\Dependency\RecipeDependency;
use Symfony\UX\Toolkit\Recipe\Recipe;

#[Route(options: ['uxor_security' => 'public-read'])]
final class ShowcaseController extends AbstractController
{
    public function __construct(
        private readonly KitReader $kit,
        private readonly RecipeDocs $docs,
        private readonly GuideDocs $guides,
    ) {
    }

    #[Route('/', name: 'app_index', methods: ['GET'])]
    public function index(): Response
    {
        $exampleCounts = array_map(fn (Recipe $recipe): int => \count($this->kit->getExamples($recipe)), $this->kit->getRecipes());

        return $this->render('showcase/index.html.twig', [
            'kit' => $this->kit->getKit(),
            'recipes' => $this->kit->getRecipes(),
            'groups' => $this->getGroups(),
            'example_counts' => $exampleCounts,
        ]);
    }

    #[Route('/r/{recipe}', name: 'app_recipe', requirements: ['recipe' => '[a-z0-9][a-z0-9-]*'], methods: ['GET'])]
    public function recipe(string $recipe, Request $request): Response
    {
        if (null === $found = $this->kit->getRecipe($recipe)) {
            throw $this->createNotFoundException(\sprintf('Recipe "%s" does not exist in the kit.', $recipe));
        }

        $dependencies = ['recipes' => [], 'composer' => [], 'npm' => [], 'importmap' => []];
        foreach ($found->manifest->dependencies as $dependency) {
            $group = match (true) {
                $dependency instanceof RecipeDependency => 'recipes',
                $dependency instanceof PhpPackageDependency => 'composer',
                $dependency instanceof NpmPackageDependency => 'npm',
                $dependency instanceof ImportmapPackageDependency => 'importmap',
                default => null,
            };
            if (null !== $group) {
                $dependencies[$group][] = $dependency;
            }
        }

        return $this->render('showcase/recipe.html.twig', [
            'kit' => $this->kit->getKit(),
            'recipe' => $found,
            'doc' => $this->docs->page($found, self::ref($request)),
            'dependencies' => $dependencies,
            'groups' => $this->getGroups(),
        ]);
    }

    /**
     * The recipe's documentation as portable Markdown, for a consumer or their agent: what the page shows, its examples
     * as code, its install step at the release, its links to other recipes to their Markdown beside it.
     */
    #[Route('/r/{recipe}.md', name: 'app_recipe_markdown', requirements: ['recipe' => '[a-z0-9][a-z0-9-]*'], methods: ['GET'])]
    public function recipeMarkdown(string $recipe, Request $request): Response
    {
        if (null === $found = $this->kit->getRecipe($recipe)) {
            throw $this->createNotFoundException(\sprintf('Recipe "%s" does not exist in the kit.', $recipe));
        }

        return new Response($this->docs->markdown($found, self::ref($request) ?? 'main'), headers: ['Content-Type' => 'text/markdown; charset=UTF-8']);
    }

    /**
     * A consumer guide, from the repository (GuideDocs): getting started (INSTALL.md) or the guide (docs/GUIDE.md).
     */
    #[Route('/{name}', name: 'app_guide', requirements: ['name' => 'install|guide'], methods: ['GET'])]
    public function guide(string $name, Request $request): Response
    {
        return $this->render('showcase/guide.html.twig', [
            'title' => GuideDocs::GUIDES[$name]['title'],
            'name' => $name,
            'doc' => $this->guides->html($name, self::ref($request)),
        ]);
    }

    /**
     * The same guide as portable Markdown.
     */
    #[Route('/{name}.md', name: 'app_guide_markdown', requirements: ['name' => 'install|guide'], methods: ['GET'])]
    public function guideMarkdown(string $name, Request $request): Response
    {
        return new Response($this->guides->markdown($name, self::ref($request) ?? 'main'), headers: ['Content-Type' => 'text/markdown; charset=UTF-8']);
    }

    /**
     * The ref a page installs: the release a static copy shows (or, built from a branch, that branch); on the dev
     * server, none (the repository's default branch).
     */
    private static function ref(Request $request): ?string
    {
        $export = $request->attributes->get('_static_export');
        $ref = \is_array($export) ? ($export['release'] ?? $export['branch'] ?? 'main') : null;

        return \is_string($ref) ? $ref : null;
    }

    /**
     * @return array<string, array{title: string, recipes: list<Recipe>}> the recipes by type, components first
     */
    private function getGroups(): array
    {
        $groups = [
            'component' => ['title' => 'Components', 'recipes' => []],
            'block' => ['title' => 'Blocks', 'recipes' => []],
        ];
        foreach ($this->kit->getRecipes() as $recipe) {
            $groups[$recipe->manifest->type->value]['recipes'][] = $recipe;
        }

        return array_filter($groups, fn (array $group): bool => [] !== $group['recipes']);
    }
}
