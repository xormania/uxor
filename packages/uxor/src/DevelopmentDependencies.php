<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Installed Composer evidence shared by development setup and environment inspection. */
final class DevelopmentDependencies
{
    public static function evaluate(array $project): array
    {
        $packages = $project['installedPackages'] ?? new InstalledPackages(array_map(
            static fn (string $name, string $version): array => ['name' => $name, 'version' => $version],
            array_keys($project['packages']), $project['packages'],
        ));
        $manifest = json_decode((string) file_get_contents(dirname(__DIR__, 3).'/composer.json'), true, flags: JSON_THROW_ON_ERROR);
        $profiler = self::pack('profiler-pack', '*', $packages, false);
        $dependencies = [$profiler];
        foreach ($manifest['require'] as $package => $constraint) {
            if (!str_contains($package, '/')) {
                continue; // PHP, extensions and the Composer plugin API are platform requirements.
            }
            $dependencies[] = 'symfony/debug-pack' === $package
                ? self::pack('debug-pack', $constraint, $packages, true, $profiler)
                : self::package($packages, $package, $constraint, isset(SymfonyPreparation::REQUIREMENTS[$package])) + ['install_requested' => true];
        }
        return $dependencies;
    }

    public static function missing(array $dependencies): array
    {
        return array_filter($dependencies, static fn (array $row): bool => $row['install_requested'] && !$row['compatible']);
    }

    private static function pack(string $name, string $required, InstalledPackages $packages, bool $installRequested, ?array $profiler = null): array
    {
        // Flex can remove both metapackages; only the published runtime requirements describe their installed contents.
        $path = __DIR__.'/../resources/symfony/packs/'.$name.'/composer.json';
        $manifest = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        $pack = self::package($packages, $manifest['name'], $required);
        $components = [];
        foreach ($manifest['require'] as $package => $constraint) {
            $component = self::package($packages, $package, $constraint);
            // The debug pack accepts any profiler pack, including its Flex-unpacked contents.
            if (null !== $profiler && $package === $profiler['package'] && '*' === $constraint) {
                $component['compatible'] = $profiler['compatible'];
                $component['satisfied_by'] = $profiler['satisfied_by'];
            }
            $components[] = $component;
        }

        if (null === $pack['installed_version'] && !$pack['compatible'] && !in_array(false, array_column($components, 'compatible'), true)) {
            $pack['compatible'] = true;
            $pack['satisfied_by'] = 'installed_components';
        }
        $pack['install_requested'] = $installRequested;
        $pack['components'] = $components;
        return $pack;
    }

    private static function package(InstalledPackages $packages, string $name, string $constraint, bool $exactPin = false): array
    {
        $version = $packages->version($name);
        if ($exactPin) {
            // These tools verify the exact release on disk.
            $evidence = null !== $version && ltrim($version, 'v') === $constraint ? ['satisfied_by' => 'installed_package'] : null;
        } else {
            $evidence = $packages->match($name, $constraint);
        }
        return ['package' => $name, 'constraint' => $constraint, 'installed_version' => $version, 'compatible' => null !== $evidence]
            + ($evidence ?? ['satisfied_by' => null]);
    }
}
