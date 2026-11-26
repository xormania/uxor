<?php

declare(strict_types=1);

namespace Xormania\UXor;

use ByteKitsune\MagoSymfonyWiring\ContainerReferenceLoader;
use Symfony\Component\Process\Process;
use Xormania\UXor\Preparation\PreparationSnapshot;

/**
 * Prepares compiled development-container facts in the application's PHP runtime.
 * Analysis reads the sanitized snapshot; preparation never clears caches or logs.
 */
final class SymfonyPreparation
{
    public const DIRECTORY = PreparationSnapshot::DIRECTORY;
    public const CONFIG = PreparationSnapshot::CONFIG;
    public const WORKER = PreparationSnapshot::WORKER;
    public const REFERENCE = PreparationSnapshot::REFERENCE;
    public const MANIFEST = PreparationSnapshot::MANIFEST;
    public const REQUIREMENTS = PreparationSnapshot::REQUIREMENTS;

    private readonly PreparationSnapshot $snapshot;

    public function __construct(private readonly ProjectInspector $inspector = new ProjectInspector())
    {
        $this->snapshot = new PreparationSnapshot();
    }

    public static function configurationFiles(string $vendorDirectory = 'vendor'): array
    {
        return PreparationSnapshot::configurationFiles($vendorDirectory);
    }

    public static function generatedConfiguration(string $content): bool
    {
        return in_array($content, [PreparationSnapshot::NATIVE_CONFIG, PreparationSnapshot::ACTIVE_CONFIG], true);
    }

    /** Readiness concerns tracked inputs, not an assertion of runtime health. */
    public function status(string $directory): array
    {
        $root = $this->inspector->root($directory);
        $state = $this->snapshot->readiness($root);
        unset($state['generation']);
        $result = $this->result($root, $state['state'], $state['enabled'], $state['summary']);
        if ($state['fresh']) {
            $result['status'] = 'completed';
            $result['next_steps'] = [];
        }
        return array_replace($result, $state);
    }

    public function assertFresh(string $directory): array
    {
        $state = $this->status($directory);
        if (!$state['enabled'] || !$state['fresh']) {
            throw new \RuntimeException($state['summary'].' Run uxor prepare in the application’s PHP environment.');
        }
        return $state;
    }

    public function prepare(string $directory, bool $trustProjectCode = false): array
    {
        $root = $this->inspector->root($directory);
        $result = $this->result($root, 'unprepared', false, 'Symfony preparation requires execution of the trusted application’s PHP code.');
        $result['project_code_executed'] = false;
        if (!$trustProjectCode) {
            $result['next_steps'] = ['In an authorized, trusted application, run uxor prepare --trust-project-code in its PHP environment.'];
            return $result;
        }

        $temporary = null;
        $lock = null;
        $attempt = null;
        $changes = [];
        try {
            $vendor = $this->vendorDirectory($root);
            $this->snapshot->dependencies($root, $vendor);
            $this->snapshot->checkWorker($root, $vendor);
            $config = $this->snapshot->readFile($root, self::CONFIG, 65536);
            $result['enabled'] = PreparationSnapshot::ACTIVE_CONFIG === $config;
            if (!self::generatedConfiguration($config)) {
                throw new \RuntimeException('The owned Mago configuration has custom changes. Reconcile it with setup; preparation preserves it.');
            }
            $this->snapshot->readFile($root, 'bin/console', 1024 * 1024);
            $this->assertOwnedDirectory($root);
            $lockPath = $root.'/'.PreparationSnapshot::LOCK;
            if (is_link($lockPath)) {
                throw new \RuntimeException('The preparation lock must not be a symbolic link.');
            }
            if (!is_file($lockPath)) {
                $created = fopen($lockPath, 'x');
                if (false === $created) {
                    throw new \RuntimeException('Cannot create the preparation lock. Retry if another preparation just started.');
                }
                chmod($lockPath, 0644);
                fclose($created);
            }
            $lock = fopen($lockPath, 'r');
            if (false === $lock || !flock($lock, LOCK_EX | LOCK_NB)) {
                throw new \RuntimeException('Another Symfony preparation is running. Retry after it completes.');
            }
            $id = bin2hex(random_bytes(16));
            $attempt = ['schema' => 1, 'state' => 'preparing', 'enabled' => true, 'preparation_id' => $id];
            $this->publish($root, self::MANIFEST, PreparationSnapshot::json($attempt), $changes);
            $temporaryPath = self::DIRECTORY.'/.prepare-'.$id;
            if (!mkdir($root.'/'.$temporaryPath, 0700)) {
                throw new \RuntimeException('Cannot create private preparation storage.');
            }
            $temporary = $temporaryPath;

            // The final snapshot includes the config that will be activated on success.
            $before = $this->snapshot->snapshot($root, $vendor, PreparationSnapshot::ACTIVE_CONFIG);
            $console = [PHP_BINARY, $root.'/bin/console', 'debug:container', '--env=dev',
                '--format=json', '--no-interaction', '--no-ansi'];
            $result['project_code_executed'] = true;
            $this->capture([...$console, '--types'], $root, $root.'/'.$temporary.'/types.json');
            $this->capture($console, $root, $root.'/'.$temporary.'/services.json');
            $exporter = $vendor.'/byte-kitsune/mago-symfony-wiring/bin/create-container-reference.php';
            $this->capture([PHP_BINARY, $root.'/'.$exporter,
                '--types='.$root.'/'.$temporary.'/types.json',
                '--services='.$root.'/'.$temporary.'/services.json',
                '--autoload='.$root.'/'.$vendor.'/autoload.php',
            ], $root, $root.'/'.$temporary.'/reference.json');
            $reference = $this->snapshot->readFile($root, $temporary.'/reference.json', PreparationSnapshot::MAX_OUTPUT_BYTES);
            // Validate the producer's bounded schema before publishing it to any worker.
            (new ContainerReferenceLoader($root, $temporary.'/reference.json'))->load();
            $after = $this->snapshot->snapshot($root, $vendor, PreparationSnapshot::ACTIVE_CONFIG);
            if (!hash_equals($before['sha256'], $after['sha256'])
                || $config !== $this->snapshot->readFile($root, self::CONFIG, 65536)) {
                throw new \RuntimeException('Application inputs changed during preparation. Retry after the changes finish.');
            }

            $manifest = [
                'schema' => 1, 'state' => 'ready', 'enabled' => true, 'preparation_id' => $id,
                'prepared_at' => gmdate('c'), 'environment' => 'dev', 'debug' => true,
                'vendor_directory' => $vendor, 'php_version' => PHP_VERSION,
                'dependencies' => self::REQUIREMENTS,
                'reference_sha256' => hash('sha256', $reference),
                'inputs_sha256' => $after['sha256'], 'input_files' => $after['files'],
                'inputs_scope' => $result['inputs_scope'],
            ];
            // Each file is atomic. During replacement, the manifest/hash guard fails closed.
            $this->publish($root, self::REFERENCE, $reference, $changes);
            if ($config !== PreparationSnapshot::ACTIVE_CONFIG) {
                $this->publish($root, self::CONFIG, PreparationSnapshot::ACTIVE_CONFIG, $changes);
            }
            $this->publish($root, self::MANIFEST, PreparationSnapshot::json($manifest), $changes);
            return array_replace($result, [
                'status' => 'completed', 'state' => 'ready', 'enabled' => true, 'fresh' => true,
                'preparation_id' => $id, 'prepared_at' => $manifest['prepared_at'],
                'summary' => 'Prepared sanitized Symfony development-container facts and enabled the wiring worker.',
                'changes' => array_values($changes), 'source_files' => $after['files'],
                'next_steps' => [
                    'Ensure the application’s root mago.toml extends ".uxor/mago/config.toml".',
                    'The packaged Serena graph interface restarts its language server for this preparation. Reconnect other clients before querying the refreshed graph.',
                    'Run the application’s tests and a fresh request to verify runtime behavior.',
                ],
            ]);
        } catch (\Throwable $error) {
            if (null !== $attempt) {
                $attempt['state'] = 'failed';
                try {
                    $this->publish($root, self::MANIFEST, PreparationSnapshot::json($attempt), $changes);
                } catch (\Throwable) {
                    // The existing preparing marker still prevents it being treated as ready.
                }
            }
            return array_replace($result, [
                'status' => 'incomplete', 'state' => 'unavailable', 'fresh' => false,
                'summary' => $error->getMessage(),
                'changes' => array_values($changes),
                'next_steps' => [
                    'Run setup to inspect the required dependencies and owned configuration.',
                    'Diagnose Symfony Console in the application’s PHP environment, then run uxor prepare --trust-project-code again.',
                    'Existing profiles and logs remain available for diagnosis; preparation does not clear them.',
                ],
            ]);
        } finally {
            if (null !== $temporary) {
                foreach (['types.json', 'services.json', 'reference.json'] as $file) {
                    $path = $root.'/'.$temporary.'/'.$file;
                    if (is_file($path) || is_link($path)) {
                        unlink($path);
                    }
                }
                if (is_dir($root.'/'.$temporary)) {
                    rmdir($root.'/'.$temporary);
                }
            }
            if (is_resource($lock)) {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
        }
    }

    public function vendorDirectory(string $directory): string
    {
        return $this->snapshot->vendorDirectory($this->inspector->root($directory));
    }

    private function capture(array $argv, string $root, string $destination): void
    {
        $output = fopen($destination, 'xb');
        if (false === $output) {
            throw new \RuntimeException('Cannot capture private Symfony metadata.');
        }
        chmod($destination, 0600);
        $bytes = 0;
        $process = new Process($argv, $root, ['APP_ENV' => 'dev', 'APP_DEBUG' => '1'], timeout: 120);
        $process->disableOutput();
        try {
            $process->run(static function (string $type, string $chunk) use ($output, &$bytes): void {
                if (Process::OUT !== $type) {
                    return;
                }
                $bytes += strlen($chunk);
                if ($bytes > PreparationSnapshot::MAX_OUTPUT_BYTES || fwrite($output, $chunk) !== strlen($chunk)) {
                    throw new \RuntimeException('Symfony metadata exceeded its output bound or could not be captured.');
                }
            });
            if (!$process->isSuccessful()) {
                throw new \RuntimeException('Symfony metadata command failed. Run debug:container in the application’s PHP environment to diagnose it; raw output was not published.');
            }
        } finally {
            if ($process->isRunning()) {
                $process->stop(0);
            }
            fclose($output);
        }
    }

    private function assertOwnedDirectory(string $root): void
    {
        foreach (['.uxor', self::DIRECTORY] as $relative) {
            $path = $root.'/'.$relative;
            if (!is_dir($path) || is_link($path) || realpath($path) !== $path) {
                throw new \RuntimeException('Run setup to create regular application-owned .uxor/mago directories.');
            }
        }
    }

    private function writeAtomic(string $root, string $relative, string $content): void
    {
        $this->assertOwnedDirectory($root);
        $path = $root.'/'.$relative;
        if (is_link($path) || (file_exists($path) && !is_file($path))) {
            throw new \RuntimeException('Refusing to replace a linked or non-file preparation artifact.');
        }
        $temporary = $root.'/'.self::DIRECTORY.'/.tmp-'.bin2hex(random_bytes(12));
        $handle = fopen($temporary, 'xb');
        if (false === $handle) {
            throw new \RuntimeException('Cannot write the preparation artifact.');
        }
        try {
            // Published data is sanitized. Different application/provider UIDs may read it.
            chmod($temporary, 0644);
            if (fwrite($handle, $content) !== strlen($content) || !fflush($handle)) {
                throw new \RuntimeException('Cannot complete the preparation artifact.');
            }
            fclose($handle);
            $handle = null;
            if (!rename($temporary, $path)) {
                throw new \RuntimeException('Cannot publish the preparation artifact.');
            }
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }

    private function result(string $root, string $state, bool $enabled, string $summary): array
    {
        return [
            'status' => 'incomplete', 'state' => $state, 'enabled' => $enabled, 'fresh' => false,
            'preparation_id' => null, 'summary' => $summary, 'root' => $root, 'changes' => [],
            'paths' => ['configuration' => self::CONFIG, 'worker' => self::WORKER,
                'reference' => self::REFERENCE, 'manifest' => self::MANIFEST],
            'inputs_scope' => [
                'Application src/config/tests and Composer autoload paths, Composer metadata, SDK/wiring source, root mago.toml, and owned Mago configuration.',
                'Imported service or Mago configuration outside those tracked paths requires an explicit refresh after changes.',
                'Environment variables, .env files and Symfony’s secrets directory are not inspected. Prepare again after runtime environment changes.',
                'Dependency metadata identifies installed packages; this is not a claim that every vendor file is immutable.',
                'Compiled facts describe the dev container; profiles and logs remain historical observations.',
            ],
            'next_steps' => ['Run uxor prepare --trust-project-code in the application’s PHP environment.'],
        ];
    }

    private function publish(string $root, string $relative, string $content, array &$changes): void
    {
        $change = $changes[$relative] ?? ['path' => $relative, 'action' => is_file($root.'/'.$relative) ? 'update' : 'create'];
        if (self::CONFIG === $relative) {
            (new SetupOwnership(new ApplicationFiles($this->inspector)))->recordPreparedConfiguration($root, $content);
        }
        $this->writeAtomic($root, $relative, $content);
        $changes[$relative] = $change;
    }
}
