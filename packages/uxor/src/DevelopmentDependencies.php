<?php

declare(strict_types=1);

namespace Xormania\UXor;

use Composer\Semver\Semver;

/** Installed Composer evidence shared by development setup and environment inspection. */
final class DevelopmentDependencies
{
    public static function evaluate(array $project, ?ApplicationFiles $files = null): array
    {
        $profiler = self::pack('profiler-pack', $project, false, $files);
        $dependencies = [self::pack('debug-pack', $project, true, $files, $profiler), $profiler];
        foreach ([
            'symfony/maker-bundle' => '',
            ...SymfonyPreparation::REQUIREMENTS,
            'symfony/ai-monolog-mate-extension' => '1.0.0-BETA1',
        ] as $package => $constraint) {
            $row = self::installed($package, $constraint, $project, exactPin: true);
            $dependencies[] = $row + ['satisfied_by' => $row['compatible'] ? 'installed_package' : null, 'install_requested' => true];
        }
        return $dependencies;
    }

    public static function missingRequests(array $dependencies): array
    {
        return array_filter($dependencies, static fn (array $row): bool => $row['install_requested'] && !$row['compatible']);
    }

    private static function pack(string $name, array $project, bool $installRequested, ?ApplicationFiles $files, ?array $profiler = null): array
    {
        // Flex can remove both metapackages; only the published runtime requirements describe their installed contents.
        $path = __DIR__.'/../resources/symfony/packs/'.$name.'/composer.json';
        $manifest = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        $pack = self::installed($manifest['name'], '', $project);
        $components = [];
        foreach ($manifest['require'] as $package => $constraint) {
            $component = self::installed($package, $constraint, $project, $files);
            // The debug pack accepts any profiler pack, including its Flex-unpacked contents.
            if (null !== $profiler && $package === $profiler['package'] && '*' === $constraint) {
                $component['compatible'] = $profiler['compatible'];
            }
            $components[] = $component;
        }

        $packed = $pack['compatible'];
        $pack['compatible'] = $packed || !in_array(false, array_column($components, 'compatible'), true);
        $pack['satisfied_by'] = $packed ? 'installed_package' : ($pack['compatible'] ? 'installed_components' : null);
        $pack['install_requested'] = $installRequested;
        $pack['components'] = $components;
        return $pack;
    }

    private static function installed(string $package, string $constraint, array $project, ?ApplicationFiles $files = null, bool $exactPin = false): array
    {
        $version = $project['packages'][$package] ?? null;
        $compatible = null !== $version;
        $row = ['package' => $package, 'constraint' => $constraint, 'installed_version' => $version];
        if (null !== $version && '' !== $constraint) {
            // The Mago provider checks its exact release string. Pack components follow Composer constraints.
            $compatible = $exactPin ? ltrim($version, 'v') === $constraint : Semver::satisfies($version, $constraint);
        }
        if (null !== $version && !$compatible && !$exactPin && null !== $files) {
            foreach ($files->installedAliases($project, $package) as $alias) {
                try {
                    $matches = Semver::satisfies($alias['normalized'], $constraint);
                } catch (\UnexpectedValueException) {
                    continue;
                }
                if ($matches) {
                    return $row + ['compatible' => true, 'matched_alias' => $alias['alias']];
                }
            }
        }
        return $row + ['compatible' => $compatible];
    }
}
