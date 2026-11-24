<?php

declare(strict_types=1);

namespace Xormania\UXor;

use Symfony\Component\Process\Process;

/** Readiness is reported per capability; presence and live observations stay separate. */
final class EnvironmentStatus
{
    private readonly ApplicationFiles $files;

    public function __construct(
        private readonly ProjectInspector $inspector,
        private readonly SymfonyPreparation $preparation,
        private readonly NativeTools $nativeTools,
    ) {
        $this->files = new ApplicationFiles($inspector);
    }

    public function inspect(string $directory, bool $probe = false, bool $trustProjectCode = false): array
    {
        $project = $this->files->project($directory);
        $root = $project['root'];
        if ($probe && !$trustProjectCode) {
            return ['status' => 'incomplete', 'summary' => 'Runtime probes require --trust-project-code for the selected application.',
                'root' => $root, 'changes' => [], 'project_code_executed' => false,
                'next_steps' => ['Use existing application execution authorization to enable probes.']];
        }
        $has = static fn (string $package): bool => isset($project['packages'][$package]);
        $dependencies = DevelopmentDependencies::evaluate($project);
        $compatible = array_column($dependencies, 'compatible', 'package');
        $capabilities = [
            'mate' => ['installed' => $has('symfony/ai-mate'), 'configured' => is_file($root.'/mate/config.php'),
                'interface' => 'application CLI', 'observed' => 'not_probed'],
            'maker' => ['installed' => $compatible['symfony/maker-bundle'], 'configured' => is_file($root.'/bin/console'), 'observed' => 'not_probed'],
            'mago' => ['installed' => null, 'configured' => is_file($root.'/mago.toml'), 'observed' => 'not_probed'],
            'serena' => ['installed' => null, 'configured' => is_file($root.'/.uxor/mcp.json'), 'interface' => 'MCP stdio', 'observed' => 'not_probed',
                'note' => 'Configuration paths must resolve on the MCP host. The provider uses PHP 8.4; preparation in another PHP version does not prove the application autoloader runs there.'],
            'symfony_wiring' => $this->preparation->status($root),
            'profiler' => ['installed' => $compatible['symfony/profiler-pack'],
                'configured' => is_file($root.'/'.EnvironmentSetup::PROFILER_CONFIG) || is_file($root.'/config/packages/dev/uxor.yaml') ? true : null,
                'observed' => 'not_probed',
                'note' => 'Installed describes the profiler pack or its unpacked requirements. Static inspection recognizes UXor’s dev config; other application configuration and effective collection require runtime evidence. An exact HTTP response token and matching profile establish request capture.'],
            'browser' => ['configured' => is_file($root.'/.uxor/browser.mjs'), 'observed' => 'not_probed',
                'note' => 'The application must import the recorder into its Playwright fixture and set the served baseURL.'],
            'monolog' => ['installed' => $has('symfony/ai-monolog-mate-extension'), 'observed' => 'not_probed'],
        ];
        $ownership = new SetupOwnership($this->files);
        foreach (['serena' => SetupIntegration::LocalMcp, 'browser' => SetupIntegration::Browser] as $name => $integration) {
            if ($capabilities[$name]['configured']) {
                $capabilities[$name]['configured'] = $ownership->verifyClientConfiguration($root, $integration);
            }
        }
        $probes = [];
        if ($probe) {
            foreach (['maker', 'mate'] as $kind) {
                $discovery = $this->nativeTools->discover($root, $kind, '', 10, true);
                $probes[$kind] = ['status' => $discovery['status'], 'summary' => $discovery['summary'] ?? 'Installed native metadata was read.',
                    'evidence' => $discovery['evidence'] ?? null, 'count' => $discovery['total'] ?? null];
                $capabilities[$kind]['observed'] = 'completed' === $discovery['status'] ? 'metadata_available' : 'probe_failed';
            }
            $launcher = $root.'/'.$project['bin'].'/uxor-mago';
            foreach (['cli' => 'mago', 'serena' => 'serena'] as $provider => $capability) {
                $result = is_file($launcher) ? $this->command([$launcher, '--project-root', $root, 'version', $provider], $root)
                    : ['status' => 'incomplete', 'summary' => 'Installed uxor-mago entry point is missing.'];
                $probes[$capability] = $result;
                $capabilities[$capability]['installed'] = 'completed' === $result['status'];
                $capabilities[$capability]['observed'] = 'completed' === $result['status'] ? 'provider_version_available' : 'probe_failed';
            }
            if (is_file($root.'/bin/console')) {
                $probes['profiler'] = $this->command([PHP_BINARY, $root.'/bin/console', 'debug:container', 'profiler', '--env=dev', '--format=json', '--no-interaction'], $root);
                $capabilities['profiler']['observed'] = 'completed' === $probes['profiler']['status'] ? 'service_available' : 'probe_failed';
            }
        }
        $next = [];
        if (in_array(false, $compatible, true) || !$capabilities['mate']['configured'] || !$capabilities['mago']['configured']) {
            $next[] = 'Run setup to review missing configuration, then setup --apply --install --trust-project-code in the application PHP environment.';
        }
        if (!($capabilities['symfony_wiring']['fresh'] ?? false)) {
            $next[] = 'Run prepare --trust-project-code after source, dependencies, service configuration or environment changes.';
        }
        if (!$probe) {
            $next[] = 'Run environment --probe --trust-project-code to inspect real native entry points and prepared providers.';
        } elseif (in_array('probe_failed', array_column($capabilities, 'observed'), true)) {
            $next[] = 'Inspect the named failed probe in its owning runtime. Prepare external providers with uxor-mago pull on the Docker host.';
        }
        if (true === $capabilities['serena']['configured']) {
            $next[] = 'Connect Serena and query a current application symbol. Provider version checks do not establish an active MCP session.';
        }
        $next[] = 'Exercise the requested application journey and inspect its exact profiler token. Keep existing failure evidence when refreshing source facts.';
        if (!$has('symfony/flex')) {
            $next[] = 'This application does not have Flex. Register installed development bundles and profiler UI routes using its own kernel/configuration conventions.';
        }
        $failed = array_filter($probes, static fn (array $result): bool => 'completed' !== $result['status']);
        return ['status' => [] !== $failed ? 'incomplete' : 'completed',
            'summary' => $probe ? 'Development entry points probed; session and request evidence are reported separately.'
                : 'Development configuration inspected without running application code.',
            'root' => $root, 'php_binary' => PHP_BINARY, 'php_version' => PHP_VERSION, 'vendor_directory' => $project['vendor'],
            'project_code_executed' => $probe, 'capabilities' => $capabilities, 'dependencies' => $dependencies, 'probes' => $probes, 'changes' => [],
            'workflows' => [
                'understand' => ['mago', 'serena', 'symfony_wiring', 'mate'],
                'build' => ['maker', 'serena', 'mago'],
                'diagnose' => ['browser', 'profiler', 'monolog', 'mate'],
            ],
            'next_steps' => $next];
    }

    private function command(array $argv, string $root): array
    {
        $process = new Process($argv, $root, ['APP_ENV' => 'dev', 'APP_DEBUG' => '1'], timeout: 30);
        $process->disableOutput();
        try {
            $process->run();
            return ['status' => $process->isSuccessful() ? 'completed' : 'incomplete',
                'argv' => $argv, 'exit_code' => $process->getExitCode(),
                'summary' => $process->isSuccessful() ? 'Native entry point completed.' : 'Run this command in its owning runtime to inspect the failure.'];
        } catch (\Throwable) {
            return ['status' => 'incomplete', 'argv' => $argv, 'exit_code' => null, 'summary' => 'Native entry point could not complete within its execution limit.'];
        }
    }
}
