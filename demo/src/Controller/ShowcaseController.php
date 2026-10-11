<?php

namespace App\Controller;

use App\Kit\KitReader;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
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
    public function recipe(string $recipe): Response
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
            'examples' => $this->kit->getExamples($found),
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
