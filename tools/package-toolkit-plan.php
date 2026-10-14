#!/usr/bin/env php
<?php

/**
 * Resolve the unpublished package's roots through the actual Symfony UX Toolkit.
 *
 * This author-side adapter isolates Toolkit's internal API. It neither installs into an application nor
 * chooses a winning dependency constraint. The content identity covers the selected manifests and files,
 * including uncommitted changes; it is not a claim about an upstream release or the whole repository.
 *
 * Usage: php tools/package-toolkit-plan.php TOOLKIT_AUTOLOAD REPOSITORY NEW_OUTPUT_JSON
 */

use Composer\InstalledVersions;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\UX\Toolkit\Dependency\RecipeDependency;
use Symfony\UX\Toolkit\Kit\KitFactory;
use Symfony\UX\Toolkit\Kit\KitSynchronizer;
use Symfony\UX\Toolkit\Recipe\RecipeSynchronizer;

/** @return array<string, mixed> */
function createToolkitPackagePlan(string $repository): array
{
    if (!class_exists(InstalledVersions::class) || !InstalledVersions::isInstalled('symfony/ux-toolkit')) {
        throw new RuntimeException('The supplied autoloader does not provide symfony/ux-toolkit.');
    }
    $version = InstalledVersions::getPrettyVersion('symfony/ux-toolkit');
    if ('3.5.1.0' !== InstalledVersions::getVersion('symfony/ux-toolkit')) {
        throw new RuntimeException(sprintf('Unsupported Toolkit version "%s"; this adapter is tested with 3.5.1 only.', $version ?? 'unknown'));
    }
    $reference = InstalledVersions::getReference('symfony/ux-toolkit');
    if (null === $version || null === $reference || '' === $reference) {
        throw new RuntimeException('Toolkit installation must identify its exact version and source reference.');
    }
    $repository = realpath($repository);
    if (false === $repository || !is_dir($repository)) {
        throw new RuntimeException('Repository must be an existing directory.');
    }

    $filesystem = new Filesystem();
    $kit = (new KitFactory($filesystem, new KitSynchronizer($filesystem, new RecipeSynchronizer())))
        ->createKitFromAbsolutePath($repository);
    $roots = ['data-table', 'theme'];
    $pending = $roots;
    $selected = [];
    while ([] !== $pending) {
        $name = array_pop($pending);
        if (isset($selected[$name])) {
            continue;
        }
        $recipe = $kit->getRecipe($name);
        if (null === $recipe) {
            throw new RuntimeException(sprintf('Package depends on unregistered Toolkit recipe "%s".', $name));
        }
        $selected[$name] = $recipe;
        foreach ($recipe->manifest->dependencies as $dependency) {
            if ($dependency instanceof RecipeDependency) {
                $pending[] = $dependency->name;
            }
        }
    }
    ksort($selected, SORT_STRING);

    $manifestRecord = static function (string $path) use ($repository): array {
        $hash = hash_file('sha256', $repository.'/'.$path);
        if (false === $hash) {
            throw new RuntimeException('Cannot hash manifest: '.$path);
        }

        return ['path' => $path, 'sha256' => $hash];
    };
    $requirements = [];
    // Toolkit validates these manifests first; retain their original declarations, including conflicting
    // constraints. Pool's version_compare-based winner selection is not a compatibility solver.
    $recordRequirements = static function (string $owner, string $path) use ($repository, &$requirements): void {
        $manifest = json_decode(file_get_contents($repository.'/'.$path), true, flags: JSON_THROW_ON_ERROR);
        foreach ($manifest['dependencies'] ?? [] as $type => $declarations) {
            foreach ($declarations as $requirement) {
                $requirements[] = ['owner' => $owner, 'type' => $type, 'requirement' => $requirement];
            }
        }
    };
    $recordRequirements('kit', 'manifest.json');
    $recipes = [];
    $files = [];
    foreach ($selected as $name => $recipe) {
        $manifestPath = $name.'/manifest.json';
        // Conservative membership evidence lets a consumer reject an old plan when a recipe adds a file.
        // Keep traversal independent of copy-files mappings so an unsupported new location cannot disappear.
        $inventory = [];
        $entries = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($recipe->absolutePath, FilesystemIterator::SKIP_DOTS));
        foreach ($entries as $entry) {
            if ($entry->isLink()) {
                throw new RuntimeException('Toolkit recipe files must not be symlinks: '.$entry->getPathname());
            }
            if ($entry->isFile()) {
                $inventory[] = substr($entry->getPathname(), strlen($recipe->absolutePath) + 1);
            }
        }
        sort($inventory, SORT_STRING);
        $recipes[] = ['name' => $name, 'type' => $recipe->manifest->type->value, 'manifest' => $manifestRecord($manifestPath), 'inventory' => $inventory];
        $recordRequirements('recipe:'.$name, $manifestPath);
        foreach ($recipe->getFiles() as $file) {
            $source = $name.'/'.$file->sourceRelativePathName;
            $absolute = realpath($repository.'/'.$source);
            if (false === $absolute || !str_starts_with($absolute, $repository.'/'.$name.'/')) {
                throw new RuntimeException('Toolkit source file is missing or escapes its recipe: '.$source);
            }
            $hash = hash_file('sha256', $absolute);
            if (false === $hash) {
                throw new RuntimeException('Cannot hash Toolkit source file: '.$source);
            }
            $files[] = ['recipe' => $name, 'source' => $source, 'destination' => $file->destinationRelativePathName, 'sha256' => $hash];
        }
    }
    usort($files, static fn (array $a, array $b): int => [$a['source'], $a['destination']] <=> [$b['source'], $b['destination']]);
    usort($requirements, static fn (array $a, array $b): int => [$a['owner'], $a['type'], $a['requirement']] <=> [$b['owner'], $b['type'], $b['requirement']]);
    $kitRecord = ['name' => $kit->manifest->name, 'manifest' => $manifestRecord('manifest.json')];
    $identity = json_encode(['kit' => $kitRecord, 'roots' => $roots, 'recipes' => $recipes, 'files' => $files], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

    return [
        'format' => 1,
        'toolkit' => ['package' => 'symfony/ux-toolkit', 'version' => $version, 'reference' => $reference],
        'source' => ['sha256' => hash('sha256', $identity)],
        'kit' => $kitRecord,
        'roots' => $roots,
        'recipes' => $recipes,
        'files' => $files,
        'requirements' => $requirements,
    ];
}

try {
    if (4 !== $argc) {
        throw new InvalidArgumentException('Usage: php tools/package-toolkit-plan.php TOOLKIT_AUTOLOAD REPOSITORY NEW_OUTPUT_JSON');
    }
    if (!is_file($argv[1])) {
        throw new RuntimeException('Toolkit autoloader does not exist: '.$argv[1]);
    }
    if (file_exists($argv[3]) || is_link($argv[3])) {
        throw new RuntimeException('Choose a new output file; the Toolkit plan never overwrites an existing path.');
    }
    require $argv[1];
    $plan = createToolkitPackagePlan($argv[2]);
    $json = json_encode($plan, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n";
    $output = fopen($argv[3], 'x');
    if (false === $output) {
        throw new RuntimeException('Cannot create Toolkit plan output: '.$argv[3]);
    }
    try {
        if (strlen($json) !== fwrite($output, $json)) {
            throw new RuntimeException('Could not write the complete Toolkit plan.');
        }
    } finally {
        fclose($output);
    }
    printf("Toolkit %s package plan: %d recipes, %d files, %d originating requirements.\n", $plan['toolkit']['version'], count($plan['recipes']), count($plan['files']), count($plan['requirements']));
} catch (Throwable $error) {
    fwrite(STDERR, 'package-toolkit-plan: '.$error->getMessage()."\n");
    exit(1);
}
