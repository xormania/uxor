<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Shared operation/result contract consumed unchanged by the CLI and Mate adapters. */
final class Operations
{
    public function __construct(
        private readonly ReferenceBundle $references,
        private readonly ProjectInspector $inspector,
        private readonly ProjectDoctor $doctor,
        private readonly NativeTools $nativeTools,
    ) {
    }

    public static function create(): self
    {
        $inspector = new ProjectInspector();
        return new self(new ReferenceBundle(), $inspector, new ProjectDoctor(), new NativeTools($inspector));
    }

    public function run(string $operation, array $arguments = []): array
    {
        $result = ['operation' => $operation, 'status' => 'completed', 'summary' => '',
            'reference' => null, 'changes' => [], 'data' => null];
        try {
            $version = class_exists(\Composer\InstalledVersions::class) && \Composer\InstalledVersions::isInstalled('xormania/uxor')
                ? \Composer\InstalledVersions::getPrettyVersion('xormania/uxor') : null;
            $result['reference'] = ['package' => 'xormania/uxor', 'version' => $version]
                + ('workflow' === $operation ? ['source_type' => 'uxor-authored'] : ['uxor' => $this->references->metadata()]);
            $root = (string) ($arguments['project_root'] ?? '');
            $result['data'] = match ($operation) {
                'catalog' => $this->references->catalog((string) ($arguments['query'] ?? ''), (string) ($arguments['category'] ?? ''),
                    (int) ($arguments['limit'] ?? 10), (int) ($arguments['offset'] ?? 0)),
                'component' => $this->references->component((string) ($arguments['name'] ?? '')),
                'reference' => $this->references->document((string) ($arguments['path'] ?? ''),
                    (int) ($arguments['offset'] ?? 0), (int) ($arguments['limit'] ?? 12000)),
                'workflow' => $this->references->workflow((string) ($arguments['name'] ?? ''),
                    (int) ($arguments['offset'] ?? 0), (int) ($arguments['limit'] ?? 12000)),
                'inspect' => $this->inspector->inspect($root),
                'doctor' => $this->diagnose($root, (string) ($arguments['component'] ?? ''), (string) ($arguments['asset_profile'] ?? 'auto')),
                'tools' => $this->nativeTools->discover($root, (string) ($arguments['kind'] ?? 'maker'),
                    (string) ($arguments['name'] ?? ''), (int) ($arguments['limit'] ?? 20), true === ($arguments['trust_project_code'] ?? false)),
                default => throw new \InvalidArgumentException('Unknown operation. Use catalog, component, reference, workflow, inspect, doctor, or tools.'),
            };
            $result['status'] = $result['data']['status'] ?? 'completed';
            $result['summary'] = $result['data']['summary'] ?? match ($operation) {
                'catalog' => sprintf('%d component references match.', $result['data']['total']),
                'component' => 'UXor component reference loaded; inspect application-owned files before editing.',
                'reference' => 'Packaged UXor reference loaded.',
                'workflow' => 'UXor-authored workflow loaded; adapt it to the selected application.',
                'inspect' => 'Application metadata inspected; runtime behavior remains unverified.',
                default => 'Operation completed.',
            };
        } catch (\Throwable $e) {
            $result['status'] = 'failed';
            $result['summary'] = $e->getMessage();
            $result['error'] = ['type' => $e instanceof \InvalidArgumentException ? 'invalid_input' : 'operation_failed'];
        }
        return $result;
    }

    private function diagnose(string $root, string $component, string $assetProfile): array
    {
        $project = $this->inspector->inspect($root);
        $selected = '' === $component ? null : $this->references->component($component);
        $findings = $this->doctor->findings($project, $selected, $assetProfile);
        $counts = array_count_values(array_column($findings, 'status'));
        return ['status' => ($counts['unknown'] ?? 0) > 0 ? 'incomplete' : 'completed',
            'summary' => sprintf('%d failed checks; %d checks need project-specific verification.', $counts['fail'] ?? 0, $counts['unknown'] ?? 0),
            'project' => ['root' => $project['root'], 'php_binary' => $project['php_binary']],
            'selected_component' => '' === $component ? null : $component, 'asset_profile' => $assetProfile,
            'findings' => $findings, 'counts' => $counts];
    }
}
