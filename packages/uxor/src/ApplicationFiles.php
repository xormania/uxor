<?php

declare(strict_types=1);

namespace Xormania\UXor;

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
        foreach (($installed['packages'] ?? $installed) as $package) {
            if (is_array($package) && isset($package['name'], $package['version'])) {
                $packages[$package['name']] = (string) $package['version'];
            }
        }
        return compact('root', 'composer', 'vendor', 'bin', 'packages');
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

    /** A directory lock survives atomic replacement of Composer and UXor configuration files. */
    public static function lockProject(string $root)
    {
        $lock = fopen($root, 'rb');
        if (false === $lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            throw new \RuntimeException('Another setup or detachment may be in progress. Retry when it finishes.');
        }
        return $lock;
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
                if (in_array($file['action'], ['preserve', 'update', 'remove'], true)
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
                if ('remove' === $file['action']) {
                    if (!is_file($path) || !hash_equals($file['sha256'], (string) hash_file('sha256', $path)) || !unlink($path)) {
                        throw new \RuntimeException('Cannot remove unchanged setup file: '.$file['path']);
                    }
                } elseif ('create' === $file['action']) {
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
                            || !chmod($temporary, fileperms($path) & 0777)
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
