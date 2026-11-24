<?php

declare(strict_types=1);

namespace UXor\Website;

use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\String\Slugger\AsciiSlugger;
use Symfony\UX\Toolkit\Recipe\Recipe;

final class RecipeCategories
{
    /**
     * @param array<string, Recipe> $recipes
     * @return list<array{id: string, title: string, recipes: list<Recipe>}>
     */
    public static function fromSource(string $sourceRoot, array $recipes): array
    {
        $json = (new Filesystem())->readFile($sourceRoot.'/website/resources/recipe-categories.json');
        $catalog = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        $slugger = new AsciiSlugger('en');
        $groups = [];
        foreach ($catalog as $category) {
            $title = $category['title'];
            $id = 'category-'.$slugger->slug($title)->lower();
            if (isset($groups[$id])) {
                throw new \RuntimeException('Catalog categories have the same navigation anchor: '.$title);
            }
            $members = [];
            foreach ($category['recipes'] as $name) {
                $members[] = $recipes[$name] ?? throw new \RuntimeException('Unknown or duplicate catalog recipe: '.$name);
                unset($recipes[$name]);
            }
            $groups[$id] = ['id' => $id, 'title' => $title, 'recipes' => $members];
        }
        if ([] !== $recipes) {
            throw new \RuntimeException('Missing catalog recipes: '.implode(', ', array_keys($recipes)));
        }

        return array_values($groups);
    }
}
