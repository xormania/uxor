<?php

namespace App\Kit;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\String\Slugger\AsciiSlugger;
use Symfony\UX\Toolkit\Kit\Kit;
use Symfony\UX\Toolkit\Kit\KitFactory;
use Symfony\UX\Toolkit\Kit\KitManifest;
use Symfony\UX\Toolkit\Kit\KitSynchronizer;
use Symfony\UX\Toolkit\Recipe\Recipe;
use Symfony\UX\Toolkit\Recipe\RecipeSynchronizer;

/**
 * Loads the kit this demo showcases with the UX Toolkit itself (the same way its
 * ux-toolkit-kit-lint/debug binaries do), so recipes, descriptions and README example ids
 * are exactly what the toolkit sees.
 */
final class KitReader
{
    private ?Kit $kit = null;
    private ?KitManifest $manifest = null;

    public function __construct(
        #[Autowire('%app.kit_dir%')]
        private readonly string $kitDir,
    ) {
    }

    public function getKit(): Kit
    {
        if (null === $this->kit) {
            $filesystem = new Filesystem();
            $factory = new KitFactory($filesystem, new KitSynchronizer($filesystem, new RecipeSynchronizer()));
            $this->kit = $factory->createKitFromAbsolutePath(Path::canonicalize($this->kitDir));
        }

        return $this->kit;
    }

    /**
     * The kit's manifest.json alone, without loading its recipes: the name and repository every page prints
     * (templates/base.html.twig, through the `kit_reader` Twig global).
     */
    public function getManifest(): KitManifest
    {
        return $this->manifest ??= $this->kit?->manifest
            ?? KitManifest::fromJson((new Filesystem())->readFile(Path::join($this->kitDir, 'manifest.json')));
    }

    /**
     * @return array<string, Recipe> keyed by recipe name (its directory name), sorted by name
     */
    public function getRecipes(): array
    {
        $recipes = $this->getKit()->getRecipes();
        ksort($recipes);

        return $recipes;
    }

    public function getRecipe(string $name): ?Recipe
    {
        return $this->getKit()->getRecipe($name);
    }

    /**
     * The README examples of a recipe: every fenced block whose info string carries a JSON object.
     *
     * Ported from symfony/ux main (f152d0b) Recipe::getExamples(), which also gives each example the
     * id its upstream screenshots are named after; symfony/ux-toolkit v3.5.1 returns no ids yet.
     *
     * @return list<array{id: string, language: string, code: string, options: array<string, mixed>}>
     */
    public function getExamples(Recipe $recipe): array
    {
        if (null === $recipe->doc || !preg_match_all('/^```(?<language>\S+)\h+(?<json>\{.*?\})\h*$\R(?<code>.*?)\R```\h*$/ms', $recipe->doc, $matches, \PREG_SET_ORDER | \PREG_OFFSET_CAPTURE)) {
            return [];
        }

        $slugger = new AsciiSlugger();
        $usedIds = [];
        $examples = [];
        foreach ($matches as $match) {
            $options = json_decode($match['json'][0], true);
            if (!\is_array($options)) {
                continue;
            }

            $baseId = self::getExampleBaseId(substr($recipe->doc, 0, $match[0][1]), $slugger);
            $id = $baseId;
            for ($i = 2; isset($usedIds[$id]); ++$i) {
                $id = $baseId.'-'.$i;
            }
            $usedIds[$id] = true;

            $examples[] = ['id' => $id, 'language' => $match['language'][0], 'code' => $match['code'][0], 'options' => $options];
        }

        return $examples;
    }

    /**
     * @return array{id: string, language: string, code: string, options: array<string, mixed>}|null
     */
    public function getExample(string $recipe, string $id): ?array
    {
        if (null === $recipeObject = $this->getRecipe($recipe)) {
            return null;
        }

        foreach ($this->getExamples($recipeObject) as $example) {
            if ($example['id'] === $id) {
                return $example;
            }
        }

        return null;
    }

    /**
     * The slug of the last heading above the example; "default" right under the title.
     */
    private static function getExampleBaseId(string $docBefore, AsciiSlugger $slugger): string
    {
        $prose = preg_replace('/^```.*?^```\h*$/ms', '', $docBefore);
        if (!preg_match_all('/^(#{1,6})\h+(.+)$/m', $prose, $headings, \PREG_SET_ORDER)) {
            return 'default';
        }

        [, $level, $title] = end($headings);
        if ('#' === $level) {
            return 'default';
        }

        $slug = $slugger->slug($title)->lower()->toString();

        return '' === $slug ? 'default' : $slug;
    }
}
