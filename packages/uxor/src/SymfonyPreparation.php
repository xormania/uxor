<?php

declare(strict_types=1);

namespace Xormania\UXor;

use ByteKitsune\MagoSymfonyWiring\ContainerReferenceLoader;
use Symfony\Component\Process\Process;

/**
 * Prepares compiled development-container facts in the application's PHP runtime.
 * Analysis reads the sanitized snapshot; preparation never clears caches or logs.
 */
final class SymfonyPreparation
{
    public const DIRECTORY = '.uxor/mago';
    public const CONFIG = self::DIRECTORY.'/config.toml';
    public const WORKER = self::DIRECTORY.'/worker.php';
    public const REFERENCE = self::DIRECTORY.'/container-reference.dev.json';
    public const MANIFEST = self::DIRECTORY.'/preparation.json';
    public const REQUIREMENTS = [
        'carthage-software/mago' => '1.60.2',
        'byte-kitsune/mago-symfony-wiring' => '1.3.0',
    ];

    private const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
    private const MAX_INPUT_BYTES = 256 * 1024 * 1024;
    private const MAX_INPUT_FILES = 20000;
    private const NATIVE_CONFIG = "# UXor PHP tools. Run uxor prepare to enable compiled Symfony wiring.\n";
    private const ACTIVE_CONFIG = <<<'TOML'
# UXor compiled Symfony wiring. Refresh with uxor prepare after application changes.
# Extend this file from the application's root mago.toml.
[extension-hosts.uxor-symfony]
command = ["php", "-d", "display_errors=stderr", "-d", "memory_limit=1G", ".uxor/mago/worker.php"]
working-directory = "."
workers = 1
request-timeout-ms = 30000
shutdown-timeout-ms = 2000
environment = { MAGO_EXTENSION_BACKEND = "php" }

TOML;

    public function __construct(private readonly ProjectInspector $inspector = new ProjectInspector())
    {
    }

    /** Files owned by setup; callers must preserve differing application-owned contents. */
    public static function configurationFiles(string $vendorDirectory = 'vendor'): array
    {
        self::relativePath($vendorDirectory);
        $worker = <<<'PHP'
<?php

declare(strict_types=1);

$root = dirname(__DIR__, 2);
require $root.'/'.__UXOR_VENDOR__.'/autoload.php';

$preparation = new \Xormania\UXor\SymfonyPreparation();
try {
    if (['--check'] === array_slice($argv, 1)) {
        $state = $preparation->status($root);
        echo json_encode([
            'enabled' => $state['enabled'],
            'fresh' => $state['fresh'],
            'preparationId' => $state['preparation_id'],
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
        if ($state['enabled'] && !$state['fresh']) {
            fwrite(STDERR, $state['summary']." Run uxor prepare in the application's PHP environment, then retry.\n");
            exit(3);
        }
        exit(0);
    }
    if (count($argv) !== 1) {
        throw new \InvalidArgumentException('Use worker.php without arguments, or --check.');
    }
    $preparation->assertFresh($root);
    putenv('MAGO_EXTENSION_BACKEND=php');
    (new \Mago\Sdk\Worker(
        \ByteKitsune\MagoSymfonyWiring\SymfonyWiringExtension::fromContainerReference(
            $root,
            \Xormania\UXor\SymfonyPreparation::REFERENCE,
        ),
    ))->run();
} catch (\Throwable $error) {
    fwrite(STDERR, "UXor Symfony wiring is unavailable. Run uxor environment, then uxor prepare in the application's PHP environment.\n");
    exit(3);
}
PHP;
        return [
            self::CONFIG => self::NATIVE_CONFIG,
            self::WORKER => str_replace('__UXOR_VENDOR__', var_export($vendorDirectory, true), $worker)."\n",
            self::DIRECTORY.'/.gitignore' => "/container-reference.dev.json\n/preparation.json\n/.prepare.lock\n/.prepare-*/\n/.tmp-*\n",
        ];
    }

    /** Readiness concerns tracked inputs, not an assertion of runtime health. */
    public function status(string $directory): array
    {
        $root = $this->inspector->root($directory);
        $result = $this->result($root, 'unprepared', false, 'Compiled Symfony wiring has not been prepared.');
        try {
            $config = $this->readFile($root, self::CONFIG, 65536);
            if (self::NATIVE_CONFIG === $config) {
                return $result;
            }
            $result['enabled'] = true;
            if (self::ACTIVE_CONFIG !== $config) {
                return $this->unavailable($result, 'The owned Mago configuration differs from UXor’s configuration. Reconcile it with setup before preparing.');
            }
            $vendor = $this->vendorDirectory($root);
            $this->dependencies($root, $vendor);
            $this->checkWorker($root, $vendor);
            $manifest = $this->readJson($root, self::MANIFEST, 1024 * 1024);
            if (($manifest['schema'] ?? null) !== 1 || ($manifest['state'] ?? null) !== 'ready'
                || ($manifest['enabled'] ?? null) !== true) {
                return $this->stale($result, 'The last Symfony preparation did not complete.');
            }
            if (($manifest['vendor_directory'] ?? null) !== $vendor
                || ($manifest['environment'] ?? null) !== 'dev'
                || !is_string($manifest['preparation_id'] ?? null)
                || !preg_match('/\A[a-f0-9]{32}\z/D', $manifest['preparation_id'])) {
                return $this->stale($result, 'The Symfony preparation does not match this application configuration.');
            }
            $reference = $this->readFile($root, self::REFERENCE, self::MAX_OUTPUT_BYTES);
            if (!hash_equals((string) ($manifest['reference_sha256'] ?? ''), hash('sha256', $reference))) {
                return $this->stale($result, 'The compiled Symfony reference is missing or has changed.');
            }
            $snapshot = $this->snapshot($root, $vendor);
            if (!hash_equals((string) ($manifest['inputs_sha256'] ?? ''), $snapshot['sha256'])) {
                return $this->stale($result, 'Application source, configuration or dependency metadata changed after Symfony preparation.');
            }
            return array_replace($result, [
                'status' => 'completed', 'state' => 'ready', 'enabled' => true, 'fresh' => true,
                'preparation_id' => $manifest['preparation_id'],
                'summary' => 'Compiled Symfony facts match the tracked application inputs.',
                'prepared_at' => $manifest['prepared_at'] ?? null,
                'source_files' => $snapshot['files'], 'next_steps' => [],
            ]);
        } catch (\Throwable) {
            return $this->unavailable($result, 'Symfony preparation is unavailable or its inputs cannot be verified. Run setup, inspect dependencies, then prepare in the application’s PHP environment.');
        }
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
            $this->dependencies($root, $vendor);
            $this->checkWorker($root, $vendor);
            $config = $this->readFile($root, self::CONFIG, 65536);
            $result['enabled'] = self::ACTIVE_CONFIG === $config;
            if (!in_array($config, [self::NATIVE_CONFIG, self::ACTIVE_CONFIG], true)) {
                throw new \RuntimeException('The owned Mago configuration has custom changes. Reconcile it with setup; preparation preserves it.');
            }
            $this->readFile($root, 'bin/console', 1024 * 1024);
            $this->assertOwnedDirectory($root);
            $lockPath = $root.'/'.self::DIRECTORY.'/.prepare.lock';
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
            $this->publish($root, self::MANIFEST, $this->json($attempt), $changes);
            $temporaryPath = self::DIRECTORY.'/.prepare-'.$id;
            if (!mkdir($root.'/'.$temporaryPath, 0700)) {
                throw new \RuntimeException('Cannot create private preparation storage.');
            }
            $temporary = $temporaryPath;

            // The final snapshot includes the config that will be activated on success.
            $before = $this->snapshot($root, $vendor, self::ACTIVE_CONFIG);
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
            $reference = $this->readFile($root, $temporary.'/reference.json', self::MAX_OUTPUT_BYTES);
            // Validate the producer's bounded schema before publishing it to any worker.
            (new ContainerReferenceLoader($root, $temporary.'/reference.json'))->load();
            $after = $this->snapshot($root, $vendor, self::ACTIVE_CONFIG);
            if (!hash_equals($before['sha256'], $after['sha256'])
                || $config !== $this->readFile($root, self::CONFIG, 65536)) {
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
            if ($config !== self::ACTIVE_CONFIG) {
                $this->publish($root, self::CONFIG, self::ACTIVE_CONFIG, $changes);
            }
            $this->publish($root, self::MANIFEST, $this->json($manifest), $changes);
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
                    $this->publish($root, self::MANIFEST, $this->json($attempt), $changes);
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

    /** Composer's configured vendor directory, constrained to the selected project. */
    public function vendorDirectory(string $directory): string
    {
        $root = $this->inspector->root($directory);
        $composer = $this->readJson($root, 'composer.json', 16 * 1024 * 1024);
        $vendor = $composer['config']['vendor-dir'] ?? 'vendor';
        if (!is_string($vendor)) {
            throw new \RuntimeException('Composer config.vendor-dir must name a directory inside the application.');
        }
        if (str_starts_with($vendor, $root.'/')) {
            $vendor = substr($vendor, strlen($root) + 1);
        }
        $vendor = rtrim(str_replace('\\', '/', $vendor), '/');
        self::relativePath($vendor);
        $path = realpath($root.'/'.$vendor);
        if (false === $path || !is_dir($path) || !str_starts_with($path, $root.'/')) {
            throw new \RuntimeException('Install Composer dependencies in the application’s configured vendor directory. External vendor directories are not available to the provider.');
        }
        return substr($path, strlen($root) + 1);
    }

    private function dependencies(string $root, string $vendor): void
    {
        $metadata = $this->readJson($root, $vendor.'/composer/installed.json', 16 * 1024 * 1024);
        $installed = [];
        foreach (($metadata['packages'] ?? $metadata) as $package) {
            if (is_array($package) && is_string($package['name'] ?? null)) {
                $installed[$package['name']] = ltrim((string) ($package['version'] ?? ''), 'v');
            }
        }
        foreach (self::REQUIREMENTS as $name => $version) {
            if (($installed[$name] ?? null) !== $version) {
                throw new \RuntimeException('Symfony wiring requires installed '.$name.':'.$version.'. Run setup with dependency installation or add the exact application dev dependency.');
            }
        }
        foreach ([$vendor.'/autoload.php', $vendor.'/byte-kitsune/mago-symfony-wiring/bin/create-container-reference.php',
            $vendor.'/carthage-software/mago/composer/src/Sdk/Worker.php'] as $path) {
            $this->readFile($root, $path, 1024 * 1024);
        }
    }

    private function checkWorker(string $root, string $vendor): void
    {
        if ($this->readFile($root, self::WORKER, 65536) !== self::configurationFiles($vendor)[self::WORKER]) {
            throw new \RuntimeException('The owned Symfony wiring worker is missing or differs from this package. Reconcile it with setup.');
        }
    }

    private function snapshot(string $root, string $vendor, ?string $configOverride = null): array
    {
        $composer = $this->readJson($root, 'composer.json', 16 * 1024 * 1024);
        $paths = ['composer.json', 'composer.lock', 'bin/console', 'config', 'src', 'tests',
            'mago.toml', self::CONFIG, self::WORKER, $vendor.'/autoload.php',
            $vendor.'/composer', $vendor.'/carthage-software/mago/composer/src',
            $vendor.'/byte-kitsune/mago-symfony-wiring/src',
            $vendor.'/byte-kitsune/mago-symfony-wiring/bin/create-container-reference.php'];
        foreach (['autoload', 'autoload-dev'] as $section) {
            foreach (['psr-4', 'psr-0'] as $kind) {
                foreach (($composer[$section][$kind] ?? []) as $entries) {
                    foreach ((array) $entries as $path) {
                        if (is_string($path)) {
                            $paths[] = rtrim($path, '/');
                        }
                    }
                }
            }
            foreach (['classmap', 'files'] as $kind) {
                foreach (($composer[$section][$kind] ?? []) as $path) {
                    if (is_string($path)) {
                        $paths[] = rtrim($path, '/');
                    }
                }
            }
        }
        $entries = [];
        $bytes = 0;
        $seen = [];
        foreach (array_unique($paths) as $path) {
            if ('' === $path || '.' === $path) {
                $path = '';
            } else {
                self::relativePath($path);
            }
            if (strpbrk($path, '*?[') !== false) {
                $matches = glob($root.'/'.$path, GLOB_NOSORT);
                if (false === $matches) {
                    throw new \RuntimeException('An application autoload path cannot be inspected.');
                }
                sort($matches, SORT_STRING);
                $entries['glob:'.$path] = array_map(static fn (string $match): string => substr($match, strlen($root) + 1), $matches);
                foreach ($matches as $match) {
                    $this->collect($root, substr($match, strlen($root) + 1), $vendor, $entries, $bytes, $seen);
                }
                continue;
            }
            $this->collect($root, $path, $vendor, $entries, $bytes, $seen);
        }
        if (null !== $configOverride) {
            $entries[self::CONFIG] = hash('sha256', $configOverride);
        }
        ksort($entries, SORT_STRING);
        return ['sha256' => hash('sha256', $this->json($entries)), 'files' => count($entries), 'bytes' => $bytes];
    }

    private function collect(string $root, string $relative, string $vendor, array &$entries, int &$bytes, array &$seen): void
    {
        // Apply the exclusion to explicit Composer file entries as well as directory traversal.
        if (self::excludedInput($relative)) {
            return;
        }
        if (count($entries) >= self::MAX_INPUT_FILES) {
            throw new \RuntimeException('Preparation exceeds the supported 20,000 tracked input files.');
        }
        $path = $root.('' === $relative ? '' : '/'.$relative);
        if (!file_exists($path) && !is_link($path)) {
            $entries[$relative] = null;
            return;
        }
        $canonical = realpath($path);
        if (false === $canonical || ($canonical !== $root && !str_starts_with($canonical, $root.'/'))) {
            throw new \RuntimeException('An application input points outside the selected project.');
        }
        if (self::excludedInput(ltrim(substr($canonical, strlen($root)), '/'))) {
            return;
        }
        if (is_link($path)) {
            $entries['link:'.$relative] = substr($canonical, strlen($root) + 1);
        }
        if (is_dir($path)) {
            if (isset($seen[$canonical])) {
                return;
            }
            $seen[$canonical] = true;
            $entries['dir:'.$relative] = true;
            $children = scandir($path);
            if (false === $children) {
                throw new \RuntimeException('An application input directory is unreadable.');
            }
            foreach ($children as $name) {
                if ('.' === $name || '..' === $name) {
                    continue;
                }
                // A root-level autoload path must not absorb generated runtime state.
                if ('' === $relative && (in_array($name, ['.git', '.uxor', '.serena', '.agents', '.claude',
                    'var', 'node_modules', 'public', '.cache'], true) || $name === explode('/', $vendor)[0])) {
                    continue;
                }
                $child = '' === $relative ? $name : $relative.'/'.$name;
                // Environment files can contain credentials. Runtime environment changes require an explicit refresh.
                if (self::excludedInput($child)) {
                    continue;
                }
                $this->collect($root, $child, $vendor, $entries, $bytes, $seen);
            }
            return;
        }
        if (!is_file($path)) {
            throw new \RuntimeException('An application input is not a regular file.');
        }
        $size = filesize($path);
        if (false === $size || $size > 16 * 1024 * 1024 || $bytes + $size > self::MAX_INPUT_BYTES) {
            throw new \RuntimeException('Preparation input size exceeds the supported bound.');
        }
        $hash = hash_file('sha256', $path);
        if (false === $hash) {
            throw new \RuntimeException('An application input is unreadable.');
        }
        $entries[$relative] = $hash;
        $bytes += $size;
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
                if ($bytes > self::MAX_OUTPUT_BYTES || fwrite($output, $chunk) !== strlen($chunk)) {
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

    private function readFile(string $root, string $relative, int $maximum): string
    {
        self::relativePath($relative);
        $path = $root.'/'.$relative;
        $canonical = realpath($path);
        if (false === $canonical || !str_starts_with($canonical, $root.'/') || !is_file($path)
            || is_link($path) || !is_readable($path)) {
            throw new \RuntimeException('A required project file is missing, linked outside the project, or unreadable: '.$relative);
        }
        $size = filesize($path);
        if (false === $size || $size > $maximum) {
            throw new \RuntimeException('A project file exceeds its supported size: '.$relative);
        }
        $value = file_get_contents($path);
        if (false === $value || strlen($value) !== $size) {
            throw new \RuntimeException('A project file changed while it was being read: '.$relative);
        }
        return $value;
    }

    private function readJson(string $root, string $relative, int $maximum): array
    {
        try {
            $value = json_decode($this->readFile($root, $relative, $maximum), true, 128, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new \RuntimeException('Invalid project JSON: '.$relative);
        }
        if (!is_array($value)) {
            throw new \RuntimeException('Project JSON must contain an object or array: '.$relative);
        }
        return $value;
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

    private static function excludedInput(string $relative): bool
    {
        foreach (explode('/', $relative) as $part) {
            if (str_starts_with($part, '.env')) {
                return true;
            }
        }
        return 'config/secrets' === $relative || str_starts_with($relative, 'config/secrets/');
    }

    private static function relativePath(string $path): void
    {
        if ('' === $path || str_starts_with($path, '/') || str_contains($path, '\\')
            || preg_match('~(?:\A|/)\.\.?(?:/|\z)|[\x00-\x1f\x7f]~', $path)) {
            throw new \RuntimeException('Use a project-relative path inside the selected application.');
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

    private function stale(array $result, string $summary): array
    {
        return array_replace($result, ['state' => 'stale', 'summary' => $summary]);
    }

    private function unavailable(array $result, string $summary): array
    {
        return array_replace($result, ['state' => 'unavailable', 'summary' => $summary]);
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

    private function json(array $data): string
    {
        return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
    }
}
