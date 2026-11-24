<?php

declare(strict_types=1);

namespace Xormania\UXor\Tools;

/** Render the application install command from the same release metadata Composer resolves. */
final class PackageInstallGuide
{
    public static function render(string $markdown, array $package, array $lock, string $release): string
    {
        $start = '<!-- package-install:start -->';
        $end = '<!-- package-install:end -->';
        if (1 !== substr_count($markdown, $start) || 1 !== substr_count($markdown, $end) || strpos($markdown, $end) < strpos($markdown, $start)) {
            throw new \RuntimeException('The package README needs one ordered pair of package-install markers.');
        }

        $commands = [];
        $requirements = [escapeshellarg($package['name'].':^'.$release)];
        // Composer records the root's explicit stability exceptions in the lock. Only its production
        // graph travels with the package. Its PHPUnit and other maintainer requirements stay out.
        foreach ($lock['packages'] as $dependency) {
            $name = $dependency['name'];
            if ('composer-plugin' === ($dependency['type'] ?? null) && true === ($package['config']['allow-plugins'][$name] ?? false)) {
                $commands[] = 'composer config '.escapeshellarg('allow-plugins.'.$name).' true';
            }
            $flag = $lock['stability-flags'][$name] ?? 0;
            if (0 === $flag) {
                continue;
            }

            // Composer's BasePackage STABILITY_* values. Keep the dependency's own allowed range.
            $stability = match ($flag) {
                5 => 'RC', 10 => 'beta', 15 => 'alpha', 20 => 'dev',
                default => throw new \RuntimeException('Unrecognized Composer stability flag for '.$name),
            };
            $constraint = $package['require'][$name] ?? '*';
            if (!str_contains($constraint, '@')) {
                $constraint .= '@'.$stability;
            }
            $requirements[] = escapeshellarg($name.':'.$constraint);
        }

        $commands[] = 'composer require --dev '.implode(" \\\n    ", $requirements);
        $block = "\n\nRequires PHP `".$package['require']['php']."`.\n\n```sh\n".implode("\n", $commands)."\n```\n\n";

        return substr($markdown, 0, strpos($markdown, $start) + strlen($start)).$block.substr($markdown, strpos($markdown, $end));
    }
}
