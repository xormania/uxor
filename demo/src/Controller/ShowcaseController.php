<?php

namespace App\Controller;

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

        // the static copy installs the release it shows (or, built from a branch, that branch); the dev server, the
        // repository's default branch
        $export = $request->attributes->get('_static_export');
        $ref = \is_array($export) ? ($export['release'] ?? $export['branch'] ?? 'main') : null;

        return $this->render('showcase/recipe.html.twig', [
            'kit' => $this->kit->getKit(),
            'recipe' => $found,
            'doc' => $this->docs->page($found, \is_string($ref) ? $ref : null),
            'dependencies' => $dependencies,
            'groups' => $this->getGroups(),
        ]);
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
