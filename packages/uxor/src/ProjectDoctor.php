<?php

declare(strict_types=1);

namespace Xormania\UXor;

final class ProjectDoctor
{
    public function findings(array $project, ?array $component = null, string $assetProfile = 'auto'): array
    {
        $findings = [];
        foreach (['symfony/twig-bundle', 'symfony/ux-twig-component', 'symfony/ux-turbo',
            'symfony/stimulus-bundle', 'symfony/asset-mapper'] as $name) {
            $package = $project['packages'][$name];
            $placement = $package['declared_in'];
            $findings[] = ['check' => 'runtime_dependency', 'subject' => $name,
                'status' => 'require' === $placement ? 'pass' : ('require-dev' === $placement ? 'fail' : 'unknown'),
                'evidence' => ['file' => 'composer.json', 'declared_in' => $placement,
                    'installed_version' => $package['installed_version']],
                'suggested_action' => 'require' === $placement ? null : ('require-dev' === $placement
                    ? 'Declare this application runtime dependency in require, then verify a no-dev install.'
                    : 'Check whether the selected UXor workflow uses this package or a supported alternative; declare runtime dependencies explicitly.')];
        }
        foreach (['assets/bootstrap.js', 'assets/controllers.json', 'assets/styles/app.css', 'bin/console'] as $path) {
            $present = $project['configuration'][$path];
            $findings[] = ['check' => 'setup_file', 'subject' => $path,
                'status' => $present ? 'pass' : 'unknown', 'evidence' => ['file' => $path, 'exists' => $present],
                'suggested_action' => $present ? null : 'Read uxor://reference/INSTALL.md and check the application-specific equivalent.'];
        }
        if (null !== $component) {
            return [...$findings, ...(new ComponentWiring())->findings($project, $component, $assetProfile)];
        }
        $findings[] = ['check' => 'component_wiring', 'subject' => 'installed UXor components', 'status' => 'unknown',
            'evidence' => ['files_sampled' => count($project['component_evidence']['files']), 'application_executed' => false],
            'suggested_action' => 'Select a component with --component for documented static wiring checks, read its README, then verify the actual application workflow.'];
        return $findings;
    }
}
