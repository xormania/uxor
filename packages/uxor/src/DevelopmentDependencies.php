<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Installed Composer evidence shared by development setup and environment inspection. */
final class DevelopmentDependencies
{
    public static function evaluate(array $project): array
    {
        $requirements = [
            'symfony/profiler-pack' => '',
            'symfony/maker-bundle' => '',
            ...SymfonyPreparation::REQUIREMENTS,
        ];
        if (isset($project['packages']['monolog/monolog']) || isset($project['packages']['symfony/monolog-bundle'])) {
            $requirements['symfony/ai-monolog-mate-extension'] = '1.0.0-BETA1';
        }
        $result = [];
        foreach ($requirements as $package => $constraint) {
            // Flex can unpack a pack; its installed contents satisfy this setup request.
            $version = $project['packages'][$package] ?? null;
            if ('symfony/profiler-pack' === $package && null === $version && isset($project['packages']['symfony/web-profiler-bundle'], $project['packages']['symfony/stopwatch'])) {
                $version = 'unpacked';
            }
            $result[] = ['package' => $package, 'constraint' => $constraint, 'installed_version' => $version,
                'compatible' => null !== $version && ('' === $constraint || ltrim($version, 'v') === $constraint)];
        }
        return $result;
    }
}
