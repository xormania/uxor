<?php

declare(strict_types=1);

namespace Xormania\UXor\Tools;

use Symfony\Component\Console\Input\InputDefinition;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Process\Process;
use Xormania\UXor\EnvironmentSetup;
use Xormania\UXor\ProjectInspector;
use Xormania\UXor\SetupIntegration;
use Xormania\UXor\SymfonyPreparation;

/** Consumer configuration for the same checkout whose command definitions and provider launcher we ship. */
final class ConfigurationGuide
{
    public static function render(InputDefinition $setup, string $launcher, array $composer): string
    {
        $requirements = [];
        foreach ($composer['require'] as $name => $constraint) {
            // A Composer OR constraint includes literal pipes inside the Markdown table cell.
            $requirements[] = '| `'.$name.'` | `'.str_replace('|', '\|', $constraint).'` |';
        }
        $binaries = array_map(static fn (string $path): string => '`'.basename($path).'`', $composer['bin']);

        $requests = [];
        foreach (self::setupPlanDependencies() as $row) {
            if (!$row['install_requested'] || isset($composer['require'][$row['package']])) {
                continue;
            }
            $constraint = '' === $row['constraint'] ? 'Composer selects a compatible version'
                : '`'.str_replace('|', '\|', $row['constraint']).'`';
            $requests[] = '| `'.$row['package'].'` | '.$constraint.' |';
        }

        $defaults = [];
        foreach ($setup->getOptions() as $option) {
            $value = $option->getDefault();
            $default = match (true) {
                'project-root' === $option->getName() && getcwd() === $value => 'Current working directory',
                '' === $value => 'Empty string',
                is_string($value) => '`'.$value.'`',
                default => '`'.json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES).'`',
            };
            $defaults[] = '| `--'.$option->getName().'` | '.$default.' |';
        }

        $paths = [];
        foreach ([
            'Mago source paths and exclusions' => SetupIntegration::Mago->value,
            'Mago configuration for Symfony wiring' => SetupIntegration::MagoConfig->value,
            'MCP server definitions for manual client setup' => SetupIntegration::LocalMcp->value,
            'Claude MCP configuration' => SetupIntegration::Claude->value,
            'Codex MCP configuration' => SetupIntegration::Codex->value,
            'Development profiler configuration supplied by UXor' => EnvironmentSetup::PROFILER_CONFIG,
        ] as $label => $path) {
            $paths[] = '| '.$label.' | `'.$path.'` |';
        }

        $providers = [];
        foreach (['cli' => 'Mago CLI', 'serena' => 'Serena'] as $provider => $label) {
            // "image" only prints the selection. Remove the caller's override so generation always reports shipped defaults.
            $result = new Process(['sh', $launcher, 'image', $provider], env: ['UXOR_MAGO_IMAGE' => false]);
            $image = trim($result->mustRun()->getOutput());
            if ('' === $image || false !== strpbrk($image, "\r\n|`")) {
                throw new \RuntimeException('Invalid default image from the '.$provider.' launcher.');
            }
            $providers[] = '| '.$label.' | `'.$image.'` |';
        }

        $installation = [] === $requests
            ? "Composer supplies the development tools through UXor’s direct requirements. After reviewing the plan, run `vendor/bin/uxor setup --apply` to apply the proposed application and client configuration."
            : sprintf(<<<'MARKDOWN'
                These are the additional package requests outside UXor’s direct Composer requirements.

                | Development dependency | Requested version |
                | --- | --- |
                %s

                Symfony Flex can unpack a pack into individual dependencies. Setup checks the installed components when the pack itself is absent and skips requests your application already satisfies.
                After reviewing the plan, run `vendor/bin/uxor setup --apply --install --trust-project-code` to authorize installation in the selected application.
                MARKDOWN, implode("\n", $requests));

        return sprintf(<<<'MARKDOWN'
            # Composer package configuration

            ## Composer installation

            Installing UXor with `composer require --dev` puts the package in your application's development dependencies.
            Composer checks the platform requirements and resolves the required packages against your application's own constraints.
            Follow the [installation guide](../packages/uxor/README.md) for the release-specific command.

            | Direct requirement | Constraint |
            | --- | --- |
            %s

            UXor declares the executables %s. Composer exposes them in your application's binary directory, normally `vendor/bin`.

            ## Optional development setup

            Run `vendor/bin/uxor setup --format=json` to see the proposed configuration and installed dependency evidence for your application.

            %s

            ## Setup defaults

            | Setup option | Default when omitted |
            | --- | --- |
            %s

            Set `--host-project-root` to the absolute checkout path on the MCP host when that path differs from the one used by application PHP.
            See [setup options and permissions](../packages/uxor/OPERATIONS.md#setup) before saving permission for future Serena connections.

            ## Application files

            Paths are relative to the selected application. The setup plan shows which files apply to your client and configuration.

            | Setting | Application path |
            | --- | --- |
            %s

            An application's existing `framework.profiler` settings take precedence. With UXor’s fallback configuration, set `PROFILER_COLLECT=1` on the local Symfony server to collect profiles during a diagnostic run. See [browser diagnostics](../packages/uxor/OPERATIONS.md#browser-diagnostics).

            ## Provider images

            The launcher uses these local image tags by default. Set `UXOR_MAGO_IMAGE` on the Docker host to select a compatible custom image for both providers.

            | Provider | Default image |
            | --- | --- |
            %s

            Run `vendor/bin/uxor-mago image cli` or `vendor/bin/uxor-mago image serena` to see the selection on your host.
            See [provider preparation](../packages/uxor/OPERATIONS.md#prepare-the-providers-on-the-docker-host) to build or pull it.

            MARKDOWN,
            implode("\n", $requirements),
            implode(', ', $binaries),
            $installation,
            implode("\n", $defaults),
            implode("\n", $paths),
            implode("\n", $providers),
        );
    }

    /** Read the consumer-facing plan using an empty Composer app, independent of the maintainer's installed tools. */
    private static function setupPlanDependencies(): array
    {
        $fs = new Filesystem();
        $root = sys_get_temp_dir().'/uxor-doc-setup-'.bin2hex(random_bytes(12));
        $fs->mkdir($root, 0700);
        try {
            $fs->dumpFile($root.'/composer.json', "{}\n");
            // The CLI wraps this same plan with metadata from the generated reference bundle.
            // Reading the plan directly lets maintainers regenerate that bundle from a clean tree.
            $inspector = new ProjectInspector();
            $setup = new EnvironmentSetup($inspector, new SymfonyPreparation($inspector));
            $plan = $setup->setup($root);
            if ('plan' !== ($plan['mode'] ?? null) || !is_array($plan['dependencies'] ?? null)) {
                throw new \RuntimeException('Could not read dependency evidence from the UXor setup plan.');
            }

            return $plan['dependencies'];
        } finally {
            $fs->remove($root);
        }
    }
}
