<?php

declare(strict_types=1);

namespace Xormania\UXor;

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
        $vendor = $this->relative((string) ($composer['config']['vendor-dir'] ?? 'vendor'));
        $bin = $this->relative((string) ($composer['config']['bin-dir'] ?? $vendor.'/bin'));
        foreach ([$vendor, $bin] as $directory) {
            $absolute = $this->path($root, $directory);
            if (file_exists($absolute) && !is_dir($absolute)) {
                throw new \InvalidArgumentException('Expected a Composer directory: '.$directory);
            }
        }
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
        if (is_link($path) || !is_file($path) || !is_readable($path) || filesize($path) > 16 * 1024 * 1024) {
            throw new \InvalidArgumentException('Expected a readable regular project JSON file: '.$path);
        }
        $value = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($value)) {
            throw new \InvalidArgumentException('Expected a JSON object: '.$path);
        }
        return $value;
    }

    public function relative(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        if ('' === $path || str_starts_with($path, '/') || preg_match('/[\x00-\x1f:]/', $path)) {
            throw new \InvalidArgumentException('Use a project-relative Composer directory inside the selected application.');
        }
        while (str_starts_with($path, './')) {
            $path = substr($path, 2);
        }
        $path = rtrim($path, '/');
        $parts = explode('/', $path);
        if (array_intersect($parts, ['', '.', '..'])) {
            throw new \InvalidArgumentException('Project paths must not contain empty, dot or parent segments.');
        }
        return implode('/', $parts);
    }

    public function path(string $root, string $relative): string
    {
        $relative = $this->relative($relative);
        $path = $root;
        $parts = explode('/', $relative);
        foreach ($parts as $index => $part) {
            $path .= '/'.$part;
            if (is_link($path)) {
                throw new \InvalidArgumentException('Setup does not follow a symbolic link: '.$relative);
            }
            if ($index < count($parts) - 1 && file_exists($path) && !is_dir($path)) {
                throw new \InvalidArgumentException('Setup requires directory ancestors: '.$relative);
            }
        }
        return $path;
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
