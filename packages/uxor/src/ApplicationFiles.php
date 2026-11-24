<?php

declare(strict_types=1);

namespace Xormania\UXor;

use Composer\Semver\VersionParser;
use Xormania\UXor\Preparation\ProjectPath;

/** Project-local metadata and writes. It never loads application PHP. */
final class ApplicationFiles
{
    public function __construct(private readonly ProjectInspector $inspector)
    {
    }

    public function project(string $directory): array
    {
        $root = $this->inspector->root($directory);
        $composer = $this->json($this->path($root, 'composer.json'));
        $vendor = ProjectPath::composerDirectory($root, $composer['config']['vendor-dir'] ?? 'vendor');
        $bin = ProjectPath::composerDirectory($root, $composer['config']['bin-dir'] ?? $vendor.'/bin');
        $installedPath = $this->path($root, $vendor.'/composer/installed.json');
        $installed = is_file($installedPath) ? $this->json($installedPath) : [];
        $packages = [];
        $packageMetadata = [];
        foreach (($installed['packages'] ?? $installed) as $package) {
            if (is_array($package) && isset($package['name'], $package['version'])) {
                $name = $package['name'];
                $packages[$name] = (string) $package['version'];
                $packageMetadata[$name] = [
                    'normalized' => $package['version_normalized'] ?? null,
                    'branches' => $package['extra']['branch-alias'] ?? [],
                ];
            }
        }
        return compact('root', 'composer', 'vendor', 'bin', 'packages', 'packageMetadata');
    }

    /** Read aliases only for an installed version that did not itself satisfy a pack constraint. */
    public function installedAliases(array $project, string $name): array
    {
        $version = $project['packages'][$name];
        $metadata = $project['packageMetadata'][$name] ?? [];
        $parser = new VersionParser();
        $branch = $this->branchAlias($version, $metadata['branches'] ?? [], $parser);
        $aliases = null === $branch ? [] : [$branch];
        if (!isset($project['root']) || !is_file($project['root'].'/composer.lock')) {
            return $aliases;
        }
        $records = $this->json($this->path($project['root'], 'composer.lock'))['aliases'] ?? [];
        $normalized = $metadata['normalized'] ?? $parser->normalize($version);
        foreach (is_array($records) ? $records : [] as $alias) {
            if (($alias['package'] ?? null) === $name && ($alias['version'] ?? null) === $normalized
                && is_string($alias['alias'] ?? null) && is_string($alias['alias_normalized'] ?? null)) {
                $aliases[] = ['alias' => $alias['alias'], 'normalized' => $alias['alias_normalized']];
            }
        }
        return $aliases;
    }

    private function branchAlias(string $version, mixed $branches, VersionParser $parser): ?array
    {
        if (!is_array($branches) || (!str_starts_with($version, 'dev-') && !str_ends_with($version, '-dev'))) {
            return null;
        }
        $target = array_change_key_case($branches)[strtolower($version)] ?? null;
        if (!is_string($target) || !str_ends_with($target, '-dev')) {
            return null;
        }
        $normalized = $parser->normalizeBranch(substr($target, 0, -4));
        $sourcePrefix = $parser->parseNumericAliasPrefix($version);
        $targetPrefix = $parser->parseNumericAliasPrefix($target);
        if (!str_ends_with($normalized, '-dev') || (false !== $sourcePrefix && false !== $targetPrefix && !str_starts_with($targetPrefix, $sourcePrefix))) {
            return null;
        }
        return ['alias' => $target, 'normalized' => $normalized];
    }

    public function json(string $path): array
    {
        $value = json_decode($this->readJson($path), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($value)) {
            throw new \InvalidArgumentException('Expected a JSON object: '.$path);
        }
        return $value;
    }

    public function readJson(string $path): string
    {
        if (is_link($path) || !is_file($path) || !is_readable($path) || filesize($path) > 16 * 1024 * 1024) {
            throw new \InvalidArgumentException('Expected a readable regular project JSON file: '.$path);
        }
        return (string) file_get_contents($path);
    }

    public function relative(string $path): string
    {
        return ProjectPath::relative($path);
    }

    public function path(string $root, string $relative): string
    {
        return ProjectPath::writablePath($root, $relative);
    }

    public function proposal(string $root, string $path, string $content): array
    {
        $absolute = $this->path($root, $path);
        if (file_exists($absolute)) {
            if (!is_file($absolute) || !is_readable($absolute)) {
                throw new \InvalidArgumentException('Expected a regular application file: '.$path);
            }
            return ['path' => $path, 'action' => 'preserve', 'sha256' => hash_file('sha256', $absolute)];
        }
        return ['path' => $path, 'action' => 'create', 'content' => $content];
    }

    /** All paths and expected originals are checked before the first write. */
    public function apply(string $root, array $files): array
    {
        $changes = [];
        try {
            foreach ($files as $file) {
                $path = $this->path($root, $file['path']);
                if ('create' === $file['action'] && file_exists($path)) {
                    throw new \RuntimeException('Application changed during setup; plan again: '.$file['path']);
                }
                if (in_array($file['action'], ['preserve', 'update'], true)
                    && (!is_file($path) || !hash_equals($file['sha256'], (string) hash_file('sha256', $path)))) {
                    throw new \RuntimeException('Application changed during setup; plan again: '.$file['path']);
                }
            }
            foreach ($files as $file) {
                if ('preserve' === $file['action']) {
                    continue;
                }
                $path = $this->path($root, $file['path']);
                $parent = dirname($path);
                if (!is_dir($parent) && !mkdir($parent, 0755, true) && !is_dir($parent)) {
                    throw new \RuntimeException('Cannot create setup directory: '.$file['path']);
                }
                $this->path($root, $file['path']);
                if ('create' === $file['action']) {
                    $stream = fopen($path, 'x');
                    if (false === $stream) {
                        throw new \RuntimeException('Cannot create setup file: '.$file['path']);
                    }
                    $complete = false;
                    try {
                        if (fwrite($stream, $file['content']) !== strlen($file['content'])) {
                            throw new \RuntimeException('Could not completely write setup file: '.$file['path']);
                        }
                        $complete = true;
                    } finally {
                        fclose($stream);
                        if (!$complete && is_file($path) && !is_link($path)) {
                            unlink($path);
                        }
                    }
                } else {
                    $temporary = tempnam($parent, '.uxor-');
                    if (false === $temporary) {
                        throw new \RuntimeException('Cannot prepare setup file: '.$file['path']);
                    }
                    try {
                        if (file_put_contents($temporary, $file['content']) !== strlen($file['content'])
                            || !hash_equals($file['sha256'], (string) hash_file('sha256', $path))
                            || !rename($temporary, $path)) {
                            throw new \RuntimeException('Cannot update unchanged setup file: '.$file['path']);
                        }
                    } finally {
                        if (is_file($temporary)) {
                            unlink($temporary);
                        }
                    }
                }
                $changes[] = ['path' => $file['path'], 'action' => $file['action']];
            }
            return ['changes' => $changes, 'error' => null];
        } catch (\Throwable $error) {
            return ['changes' => $changes, 'error' => $error->getMessage()];
        }
    }

    public static function encode(array $value): string
    {
        return json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
    }
}
