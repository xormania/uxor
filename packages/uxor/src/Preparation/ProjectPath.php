<?php

declare(strict_types=1);

namespace Xormania\UXor\Preparation;

/** Composer paths used by setup, the application writer and the standalone image reader. */
final class ProjectPath
{
    public static function relative(string $path, bool $allowRoot = false): string
    {
        $path = str_replace('\\', '/', $path);
        if (str_starts_with($path, '/') || preg_match('/[\x00-\x1f\x7f:]/', $path)) {
            throw new \InvalidArgumentException('Use a project-relative path inside the selected application.');
        }
        while (str_starts_with($path, './')) {
            $path = substr($path, 2);
        }
        $path = rtrim($path, '/');
        if ($allowRoot && ('' === $path || '.' === $path)) {
            return '';
        }
        if (array_intersect(explode('/', $path), ['', '.', '..'])) {
            throw new \InvalidArgumentException('Project paths must not contain empty, dot or parent segments.');
        }
        return $path;
    }

    public static function composerDirectory(string $root, mixed $value): string
    {
        if (!is_string($value)) {
            throw new \InvalidArgumentException('A Composer directory must be a path inside the application.');
        }
        if (str_starts_with($value, $root.'/')) {
            $value = substr($value, strlen($root) + 1);
        }
        $relative = self::relative($value);
        $absolute = self::writablePath($root, $relative);
        if (file_exists($absolute) && !is_dir($absolute)) {
            throw new \InvalidArgumentException('Expected a Composer directory: '.$relative);
        }
        return $relative;
    }

    /** Resolve a destination without following symbolic links in the checkout. */
    public static function writablePath(string $root, string $relative): string
    {
        $path = $root;
        $parts = explode('/', self::relative($relative));
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
}
