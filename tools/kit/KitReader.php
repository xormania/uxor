<?php

namespace UXor\Kit;

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
 * Loads the same kit manifest, recipes and README example IDs for the website and example runtime.
 */
final class KitReader
{
    private ?Kit $kit = null;
    private ?KitManifest $manifest = null;

    public function __construct(
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
     * Read the kit name and repository without loading all recipes.
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
     * Keep the fence options and report parsing failures so both consumers export the same example IDs.
     *
     * @return list<array{id: string, language: string, code: string, options: array<string, mixed>}>
     */
    public function getExamples(Recipe $recipe): array
    {
        if (null === $recipe->doc) {
            return [];
        }
        $found = preg_match_all('/^```(?<language>\S+)\h+(?<json>\{.*?\})\h*$\R(?<code>.*?)\R```\h*$/ms', $recipe->doc, $matches, \PREG_SET_ORDER | \PREG_OFFSET_CAPTURE);
        if (false === $found) {
            throw self::pcreError('find the README examples', $recipe->name);
        }
        if (0 === $found) {
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

            $baseId = self::getExampleBaseId(substr($recipe->doc, 0, $match[0][1]), $slugger, $recipe->name);
            $id = $baseId;
            for ($i = 2; isset($usedIds[$id]); ++$i) {
                $id = $baseId.'-'.$i;
            }
            $usedIds[$id] = true;

            $examples[] = ['id' => $id, 'language' => $match['language'][0], 'code' => $match['code'][0], 'options' => $options];
        }

        return $examples;
    }

    /** @return list<array{id: string, language: string, code: string, options: array<string, mixed>}> */
    public function getPreviewExamples(Recipe $recipe): array
    {
        return array_values(array_filter($this->getExamples($recipe), static fn (array $example): bool => true === ($example['options']['preview'] ?? null)));
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
    private static function getExampleBaseId(string $docBefore, AsciiSlugger $slugger, string $recipe): string
    {
        $prose = preg_replace('/^```.*?^```\h*$/ms', '', $docBefore) ?? throw self::pcreError('name the README example', $recipe);
        $found = preg_match_all('/^(#{1,6})\h+(.+)$/m', $prose, $headings, \PREG_SET_ORDER);
        if (false === $found) {
            throw self::pcreError('name the README example', $recipe);
        }
        if (0 === $found) {
            return 'default';
        }

        [, $level, $title] = end($headings);
        if ('#' === $level) {
            return 'default';
        }

        $slug = $slugger->slug($title)->lower()->toString();

        return '' === $slug ? 'default' : $slug;
    }

    /**
     * A PCRE error (its backtrack limit on a long README, invalid UTF-8): reading the examples fails naming the step,
     * where the error read as "no examples" or gave the example the id "default".
     */
    private static function pcreError(string $step, string $recipe): \RuntimeException
    {
        return new \RuntimeException(\sprintf('Reading the README examples of %s could not %s: %s.', $recipe, $step, preg_last_error_msg()));
    }
}
