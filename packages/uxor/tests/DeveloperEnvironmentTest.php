<?php

declare(strict_types=1);

namespace Xormania\UXor\Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Filesystem\Filesystem;
use Xormania\UXor\Console\Application;
use Xormania\UXor\Operations;

final class DeveloperEnvironmentTest extends TestCase
{
    private string $directory;
    private string $project;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir().'/uxor-environment-'.bin2hex(random_bytes(8));
        $this->project = $this->directory.'/application with spaces';
        mkdir($this->project.'/vendor/composer', 0777, true);
        mkdir($this->project.'/src');
        mkdir($this->project.'/tests');
        mkdir($this->project.'/templates');
        file_put_contents($this->project.'/templates/example.html.twig', '<span>{{ value }}</span>');
        mkdir($this->project.'/bin');
        file_put_contents($this->project.'/composer.json', json_encode([
            'name' => 'example/consumer',
            'require' => ['php' => '^8.4', 'symfony/framework-bundle' => '^8.1'],
            'require-dev' => ['xormania/uxor' => '^0.3'],
        ], JSON_THROW_ON_ERROR));
        file_put_contents($this->project.'/vendor/composer/installed.json', json_encode([
            'packages' => [['name' => 'symfony/framework-bundle', 'version' => 'v8.1.0']],
        ], JSON_THROW_ON_ERROR));
        $canary = '<?php file_put_contents('.var_export($this->project.'/application-executed', true).', "executed");';
        file_put_contents($this->project.'/vendor/autoload.php', $canary);
        file_put_contents($this->project.'/bin/console', $canary);
        file_put_contents($this->project.'/AGENTS.md', "# Application guidance\n\nKeep this application's decisions.\n");
        file_put_contents($this->project.'/src/Custom.php', '<?php namespace App; final class Custom { public const VALUE = "keep"; }');
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->directory);
    }

    private function invoke(string $operation, array $options = []): array
    {
        $tester = new CommandTester((new Application(Operations::create()))->find($operation));
        $code = $tester->execute(['--project-root' => $this->project, '--format' => 'json'] + $options);
        $result = json_decode($tester->getDisplay(), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame($operation, $result['operation']);
        return [$code, $result];
    }

    private function snapshot(string $root): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST,
        );
        foreach ($iterator as $file) {
            $path = substr($file->getPathname(), strlen($root) + 1);
            $files[$path] = $file->isLink() ? ['link' => readlink($file->getPathname())]
                : ($file->isDir() ? ['directory' => true] : ['sha256' => hash_file('sha256', $file->getPathname())]);
        }
        ksort($files);
        return $files;
    }

    public function testPlanningAndStaticInspectionDoNotExecuteOrWriteApplicationCode(): void
    {
        $before = $this->snapshot($this->directory);
        foreach (['setup', 'environment'] as $operation) {
            [$code, $result] = $this->invoke($operation);
            self::assertContains($code, [0, 2], json_encode($result));
            self::assertNotSame('failed', $result['status']);
            self::assertSame([], $result['changes']);
            self::assertSame($before, $this->snapshot($this->directory));
        }
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testApplyingSetupProducesUsableConfigurationAndRepeatingItPreservesApplicationFiles(): void
    {
        $instructions = file_get_contents($this->project.'/AGENTS.md');
        $source = file_get_contents($this->project.'/src/Custom.php');
        [$code, $result] = $this->invoke('setup', ['--apply' => true]);
        self::assertContains($code, [0, 2], json_encode($result));
        self::assertNotSame('failed', $result['status']);
        self::assertNotEmpty($result['changes']);
        foreach (['mago.toml', '.uxor/mago/config.toml', '.uxor/mago/worker.php', '.uxor/mago/.gitignore',
            'config/packages/dev/uxor.yaml', '.uxor/browser.mjs', '.uxor/README.md', '.uxor/mcp.json'] as $path) {
            self::assertFileExists($this->project.'/'.$path, $path);
        }
        self::assertStringContainsString('.uxor/mago/config.toml', file_get_contents($this->project.'/mago.toml'));
        self::assertStringNotContainsString('[extension-hosts.', file_get_contents($this->project.'/.uxor/mago/config.toml'));
        $configuration = json_decode(file_get_contents($this->project.'/.uxor/mcp.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(['--project-root', $this->project, 'serena'], $configuration['mcpServers']['uxor-mago']['args']);
        self::assertFalse($result['data']['mcp_binding']['requested_trust_project_code']);
        self::assertFalse($result['data']['mcp_binding']['verified']);
        self::assertFileDoesNotExist($this->project.'/config/packages/uxor.yaml');
        self::assertFileDoesNotExist($this->project.'/.mcp.json');
        self::assertFileDoesNotExist($this->project.'/.codex/config.toml');
        self::assertSame($instructions, file_get_contents($this->project.'/AGENTS.md'));
        self::assertSame($source, file_get_contents($this->project.'/src/Custom.php'));
        self::assertFileDoesNotExist($this->project.'/application-executed');

        $before = $this->snapshot($this->directory);
        [$code, $again] = $this->invoke('setup', ['--apply' => true]);
        self::assertContains($code, [0, 2], json_encode($again));
        self::assertSame([], $again['changes']);
        self::assertSame($before, $this->snapshot($this->directory));
    }

    public function testExistingProjectConfigurationIsPreservedAndClientEntriesAreMergedOnce(): void
    {
        $mago = "version = \"1.60.2\"\n[source]\npaths = [\"custom-src\"]\n";
        file_put_contents($this->project.'/mago.toml', $mago);
        $server = ['command' => 'consumer-owned-command', 'args' => ['keep-this']];
        file_put_contents($this->project.'/.mcp.json', json_encode([
            'application_setting' => 'keep',
            'mcpServers' => ['existing' => $server],
        ], JSON_THROW_ON_ERROR));
        [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        self::assertContains($code, [0, 2], json_encode($result));
        self::assertSame($mago, file_get_contents($this->project.'/mago.toml'));
        $client = json_decode(file_get_contents($this->project.'/.mcp.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame('keep', $client['application_setting']);
        self::assertSame($server, $client['mcpServers']['existing']);
        self::assertArrayNotHasKey('uxor-mate', $client['mcpServers']);
        self::assertArrayHasKey('uxor-mago', $client['mcpServers']);
        self::assertSame(['--project-root', $this->project, 'serena'], $client['mcpServers']['uxor-mago']['args']);
        $before = $this->snapshot($this->directory);
        $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        self::assertSame($before, $this->snapshot($this->directory));
    }

    public function testConflictingNamedClientServerIsPreservedAndReported(): void
    {
        $server = ['command' => 'my-custom-mago', 'args' => ['do-not-replace']];
        file_put_contents($this->project.'/.mcp.json', json_encode(['mcpServers' => ['uxor-mago' => $server]], JSON_THROW_ON_ERROR));
        [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        self::assertNotSame(0, $code, json_encode($result));
        self::assertNotSame('completed', $result['status']);
        $client = json_decode(file_get_contents($this->project.'/.mcp.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame($server, $client['mcpServers']['uxor-mago']);
    }

    public function testCodexSetupAppendsMissingServersWithoutReplacingConsumerSettings(): void
    {
        mkdir($this->project.'/.codex');
        $custom = "# Consumer settings\napproval_policy = \"on-request\"\n[mcp_servers.existing]\ncommand = \"keep-me\"\n";
        file_put_contents($this->project.'/.codex/config.toml', $custom);
        [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'codex']);
        self::assertContains($code, [0, 2], json_encode($result));
        $configured = file_get_contents($this->project.'/.codex/config.toml');
        self::assertStringStartsWith($custom, $configured);
        self::assertSame(0, substr_count($configured, '[mcp_servers.uxor-mate]'));
        self::assertSame(1, substr_count($configured, '[mcp_servers.uxor-mago]'));
        self::assertStringNotContainsString('--trust-project-code', $configured);
        self::assertStringNotContainsString('--write', $configured);
        $this->invoke('setup', ['--apply' => true, '--client' => 'codex']);
        self::assertSame($configured, file_get_contents($this->project.'/.codex/config.toml'));
    }

    public function testInvalidClientConfigurationFailsBeforeAnyFilesAreWritten(): void
    {
        file_put_contents($this->project.'/.mcp.json', "{not-json\n");
        $before = $this->snapshot($this->directory);
        [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        self::assertNotSame(0, $code, json_encode($result));
        self::assertSame($before, $this->snapshot($this->directory));
    }

    public function testEscapingConfigurationSymlinkFailsBeforeAnyFilesAreWritten(): void
    {
        mkdir($this->directory.'/outside');
        file_put_contents($this->directory.'/outside/keep.txt', 'untouched');
        symlink($this->directory.'/outside', $this->project.'/.uxor');
        $before = $this->snapshot($this->directory);
        [$code, $result] = $this->invoke('setup', ['--apply' => true]);
        self::assertNotSame(0, $code, json_encode($result));
        self::assertSame($before, $this->snapshot($this->directory));
    }


    public function testNonDirectoryConfigurationParentsFailBeforeAnyWrites(): void
    {
        foreach (['.codex', 'config'] as $path) {
            file_put_contents($this->project.'/'.$path, 'application-owned-file');
            $before = $this->snapshot($this->directory);
            [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'codex']);
            self::assertNotSame(0, $code, json_encode($result));
            self::assertSame($before, $this->snapshot($this->directory));
            unlink($this->project.'/'.$path);
        }
    }

    public function testCodexInlineOrDottedServerDefinitionsAreNotDuplicated(): void
    {
        mkdir($this->project.'/.codex');
        foreach ([
            "[mcp_servers]\nuxor-mago = { command = \"consumer-owned\" }\n",
            "mcp_servers.uxor-mago.command = \"consumer-owned\"\n",
        ] as $custom) {
            file_put_contents($this->project.'/.codex/config.toml', $custom);
            [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'codex']);
            self::assertNotSame(0, $code, json_encode($result));
            self::assertSame($custom, file_get_contents($this->project.'/.codex/config.toml'));
        }
    }


    public function testHostMappingChangesClientPathsWhileAllSetupWritesStayInTheSelectedApplication(): void
    {
        $host = '/host/projects/consumer with spaces';
        $manifest = json_decode(file_get_contents($this->project.'/composer.json'), true, 512, JSON_THROW_ON_ERROR);
        $manifest['config']['bin-dir'] = 'tools/bin';
        file_put_contents($this->project.'/composer.json', json_encode($manifest, JSON_THROW_ON_ERROR));
        [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'claude', '--host-project-root' => $host]);
        self::assertContains($code, [0, 2], json_encode($result));
        foreach (['.uxor/mcp.json', '.mcp.json'] as $path) {
            $configuration = json_decode(file_get_contents($this->project.'/'.$path), true, 512, JSON_THROW_ON_ERROR);
            $server = $configuration['mcpServers']['uxor-mago'];
            self::assertSame($host.'/tools/bin/uxor-mago', $server['command']);
            self::assertSame(['--project-root', $host, 'serena'], $server['args']);
        }
        self::assertFileExists($this->project.'/mago.toml');
        self::assertFileExists($this->project.'/.uxor/mago/config.toml');
        self::assertFileDoesNotExist($this->project.'/application-executed');
        [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'codex', '--host-project-root' => $host]);
        self::assertContains($code, [0, 2], json_encode($result));
        $codex = file_get_contents($this->project.'/.codex/config.toml');
        self::assertStringContainsString($host.'/tools/bin/uxor-mago', $codex);
        self::assertMatchesRegularExpression('/cwd\s*=\s*["\']'.preg_quote($host, '/').'["\']/', $codex);
    }

    public function testInvalidHostMappingsFailBeforeAnySetupWrites(): void
    {
        $before = $this->snapshot($this->directory);
        foreach (['relative/project', "/host/project\nother"] as $host) {
            [$code, $result] = $this->invoke('setup', ['--apply' => true, '--host-project-root' => $host]);
            self::assertNotSame(0, $code, json_encode($result));
            self::assertSame($before, $this->snapshot($this->directory));
        }
    }

    public function testGeneratedMagoTargetsTheComposerPlatformAndIncludesExistingTemplates(): void
    {
        $manifest = json_decode(file_get_contents($this->project.'/composer.json'), true, 512, JSON_THROW_ON_ERROR);
        $manifest['config']['platform']['php'] = '8.5.4';
        file_put_contents($this->project.'/composer.json', json_encode($manifest, JSON_THROW_ON_ERROR));
        [$code, $result] = $this->invoke('setup', ['--apply' => true]);
        self::assertContains($code, [0, 2], json_encode($result));
        $mago = file_get_contents($this->project.'/mago.toml');
        self::assertMatchesRegularExpression('/php-version\s*=\s*["\']8\.5["\']/', $mago);
        self::assertMatchesRegularExpression('/["\']templates["\']/', $mago);
    }


    public function testCurrentExecutionTrustIsNotSavedForFutureConnections(): void
    {
        foreach (['none', 'claude', 'codex'] as $client) {
            [$code, $result] = $this->invoke('setup', [
                '--apply' => true, '--client' => $client, '--trust-project-code' => true,
            ]);
            self::assertContains($code, [0, 2], json_encode($result));
            self::assertNotSame('failed', $result['status']);
        }

        $savedBindings = [];
        foreach (['.uxor/mcp.json', '.mcp.json'] as $path) {
            $configuration = json_decode(file_get_contents($this->project.'/'.$path), true, 512, JSON_THROW_ON_ERROR);
            if (in_array('--trust-project-code', $configuration['mcpServers']['uxor-mago']['args'], true)) {
                $savedBindings[] = $path;
            }
        }
        $codex = file_get_contents($this->project.'/.codex/config.toml');
        self::assertSame(1, preg_match('/^args\s*=\s*(\[.*\])\s*$/m', $codex, $match));
        $arguments = json_decode($match[1], true, 512, JSON_THROW_ON_ERROR);
        if (in_array('--trust-project-code', $arguments, true)) {
            $savedBindings[] = '.codex/config.toml';
        }
        self::assertSame([], $savedBindings, 'CURRENT_EXECUTION_TRUST_WAS_SAVED: '.implode(', ', $savedBindings));
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testOnlyExplicitTrustIsSavedInNewBindingsWithoutExecutingTheApplication(): void
    {
        $host = '/host/projects/trusted consumer';
        $manifest = json_decode(file_get_contents($this->project.'/composer.json'), true, 512, JSON_THROW_ON_ERROR);
        $manifest['config']['bin-dir'] = 'tools/bin';
        file_put_contents($this->project.'/composer.json', json_encode($manifest, JSON_THROW_ON_ERROR));
        $before = $this->snapshot($this->directory);
        foreach (['none', 'claude', 'codex'] as $client) {
            [$code, $result] = $this->invoke('setup', [
                '--client' => $client, '--host-project-root' => $host, '--trust-project-code' => true,
            ]);
            self::assertSame(0, $code, json_encode($result));
            self::assertSame('plan', $result['data']['mode']);
            self::assertTrue($result['data']['mcp_binding']['requested_trust_project_code']);
            self::assertFalse($result['data']['mcp_binding']['verified']);
            self::assertSame([], $result['changes']);
            self::assertSame([], $result['data']['executions']);
            self::assertSame($before, $this->snapshot($this->directory));
        }
        foreach (['none', 'claude', 'codex'] as $client) {
            [$code, $result] = $this->invoke('setup', [
                '--apply' => true, '--client' => $client, '--host-project-root' => $host,
                '--trust-project-code' => true,
            ]);
            self::assertContains($code, [0, 2], json_encode($result));
            self::assertNotSame('failed', $result['status']);
            self::assertTrue($result['data']['mcp_binding']['requested_trust_project_code']);
            self::assertFalse($result['data']['mcp_binding']['verified']);
            self::assertSame([], $result['data']['executions']);
        }
        foreach (['.uxor/mcp.json', '.mcp.json'] as $path) {
            $configuration = json_decode(file_get_contents($this->project.'/'.$path), true, 512, JSON_THROW_ON_ERROR);
            $server = $configuration['mcpServers']['uxor-mago'];
            self::assertSame($host.'/tools/bin/uxor-mago', $server['command']);
            self::assertSame(['--project-root', $host, '--trust-project-code', 'serena'], $server['args']);
        }
        $codex = file_get_contents($this->project.'/.codex/config.toml');
        self::assertStringContainsString('command = "'.$host.'/tools/bin/uxor-mago"', $codex);
        self::assertStringContainsString('args = ["--project-root","'.$host.'","--trust-project-code","serena"]', $codex);
        self::assertStringContainsString('cwd = "'.$host.'"', $codex);
        self::assertStringNotContainsString('--write', $codex);
        self::assertSame(1, substr_count($codex, '--trust-project-code'));
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testRequestingTrustPreservesPreviouslyUntrustedBindingsAndReportsReconciliation(): void
    {
        $this->assertPreservedTrustTransition(false);
    }

    public function testOmittingTrustPreservesPreviouslyTrustedBindingsAndReportsReconciliation(): void
    {
        $this->assertPreservedTrustTransition(true);
    }

    private function assertPreservedTrustTransition(bool $initialTrust): void
    {
        // Satisfy static dependency metadata so only a binding conflict can
        // change a matching completed setup into an incomplete result.
        file_put_contents($this->project.'/vendor/composer/installed.json', json_encode([
            'packages' => [
                ['name' => 'symfony/framework-bundle', 'version' => 'v8.1.0'],
                ['name' => 'symfony/profiler-pack', 'version' => 'v1.0.0'],
                ['name' => 'symfony/maker-bundle', 'version' => 'v1.0.0'],
                ['name' => 'carthage-software/mago', 'version' => '1.60.2'],
                ['name' => 'byte-kitsune/mago-symfony-wiring', 'version' => '1.3.0'],
            ],
        ], JSON_THROW_ON_ERROR));
        foreach (['claude', 'codex'] as $client) {
            $options = ['--apply' => true, '--client' => $client];
            if ($initialTrust) {
                $options['--trust-project-code'] = true;
            }
            [$code, $result] = $this->invoke('setup', $options);
            self::assertSame(0, $code, json_encode($result));
            self::assertSame('completed', $result['status']);
            self::assertSame($initialTrust, $result['data']['mcp_binding']['requested_trust_project_code']);
        }
        $before = $this->snapshot($this->directory);
        foreach (['claude', 'codex'] as $client) {
            $options = ['--apply' => true, '--client' => $client];
            if ($initialTrust) {
                $options['--trust-project-code'] = true;
            }
            [$code, $result] = $this->invoke('setup', $options);
            self::assertSame(0, $code, json_encode($result));
            self::assertSame([], $result['changes']);
            self::assertSame($before, $this->snapshot($this->directory));
        }
        foreach (['claude', 'codex'] as $client) {
            $options = ['--apply' => true, '--client' => $client];
            if (!$initialTrust) {
                $options['--trust-project-code'] = true;
            }
            [$code, $result] = $this->invoke('setup', $options);
            self::assertSame(2, $code, json_encode($result));
            self::assertSame('incomplete', $result['status']);
            self::assertSame(!$initialTrust, $result['data']['mcp_binding']['requested_trust_project_code']);
            self::assertFalse($result['data']['mcp_binding']['verified']);
            self::assertSame([], $result['changes']);
            self::assertSame([], $result['data']['executions']);
            self::assertMatchesRegularExpression('/preserved.*execution trust/i', implode("\n", $result['data']['next_steps']));
            self::assertSame($before, $this->snapshot($this->directory));
        }
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testInstallationAndRuntimePreparationRequireExplicitExecutionConsent(): void
    {
        $before = $this->snapshot($this->directory);
        foreach ([
            ['setup', ['--apply' => true, '--install' => true]],
            ['setup', ['--install' => true, '--trust-project-code' => true]],
            ['environment', ['--probe' => true]],
            ['prepare', []],
        ] as [$operation, $options]) {
            [$code, $result] = $this->invoke($operation, $options);
            self::assertNotSame(0, $code, json_encode($result));
            self::assertNotSame('completed', $result['status']);
            self::assertSame($before, $this->snapshot($this->directory));
            self::assertFileDoesNotExist($this->project.'/application-executed');
        }
    }
}
