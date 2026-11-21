<?php

declare(strict_types=1);

/**
 * Provider-owned reader for SymfonyPreparation schema 1.
 *
 * Keep the config/worker templates and input fingerprint algorithm compatible with
 * packages/uxor/src/SymfonyPreparation.php. Never include, require or autoload project PHP.
 * Matching hashes establish snapshot consistency, not authenticity of application code.
 */
final class ProviderPreparationVerifier
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

    /** Hash data only: this process must never load or execute application PHP. */
    public function verify(string $directory): array
    {
        $root = realpath($directory);
        if (false === $root || !is_dir($root)) {
            throw new \RuntimeException('The selected project is unavailable.');
        }
        $disabled = ['enabled' => false, 'fresh' => false, 'generation' => null];
        $lock = null;
        try {
            // Cooperate with preparation's exclusive lock without creating any project state.
            $lockPath = $root.'/'.self::DIRECTORY.'/.prepare.lock';
            if (file_exists($lockPath) || is_link($lockPath)) {
                $this->readFile($root, self::DIRECTORY.'/.prepare.lock', 1024);
                $lock = fopen($lockPath, 'rb');
                if (false === $lock || !flock($lock, LOCK_SH | LOCK_NB)) {
                    throw new \RuntimeException('Symfony preparation is in progress.');
                }
            }
            $configPath = $root.'/'.self::CONFIG;
            if (!file_exists($configPath) && !is_link($configPath)) {
                foreach ([self::WORKER, self::MANIFEST, self::REFERENCE] as $relative) {
                    if (file_exists($root.'/'.$relative) || is_link($root.'/'.$relative)) {
                        throw new \RuntimeException('Symfony preparation is incomplete.');
                    }
                }
                return $disabled;
            }
            $config = $this->readFile($root, self::CONFIG, 65536);
            if (self::NATIVE_CONFIG === $config) {
                return $disabled;
            }
            if (self::ACTIVE_CONFIG !== $config) {
                throw new \RuntimeException('The owned Mago configuration has changed.');
            }
            $vendor = $this->vendorDirectory($root);
            $this->dependencies($root, $vendor);
            $this->checkWorker($root, $vendor);
            $manifestBytes = $this->readFile($root, self::MANIFEST, 1024 * 1024);
            $manifest = json_decode($manifestBytes, true, 128, JSON_THROW_ON_ERROR);
            if (!is_array($manifest)
                || ($manifest['schema'] ?? null) !== 1
                || ($manifest['state'] ?? null) !== 'ready'
                || ($manifest['enabled'] ?? null) !== true
                || ($manifest['vendor_directory'] ?? null) !== $vendor
                || ($manifest['environment'] ?? null) !== 'dev'
                || !is_string($manifest['preparation_id'] ?? null)
                || !preg_match('/\A[a-f0-9]{32}\z/D', $manifest['preparation_id'])) {
                throw new \RuntimeException('The Symfony preparation manifest is invalid or incomplete.');
            }
            foreach (['reference_sha256', 'inputs_sha256'] as $key) {
                if (!is_string($manifest[$key] ?? null) || !preg_match('/\A[a-f0-9]{64}\z/D', $manifest[$key])) {
                    throw new \RuntimeException('The Symfony preparation manifest has invalid hashes.');
                }
            }
            $referenceHash = hash('sha256', $this->readFile($root, self::REFERENCE, self::MAX_OUTPUT_BYTES));
            if (!hash_equals($manifest['reference_sha256'], $referenceHash)) {
                throw new \RuntimeException('The compiled Symfony reference is missing or has changed.');
            }
            $snapshot = $this->snapshot($root, $vendor);
            if (!hash_equals($manifest['inputs_sha256'], $snapshot['sha256'])) {
                throw new \RuntimeException('Tracked application inputs changed after preparation.');
            }
            // Atomic publication is per file. Reject a generation that moved while it was checked.
            if ($manifestBytes !== $this->readFile($root, self::MANIFEST, 1024 * 1024)
                || $config !== $this->readFile($root, self::CONFIG, 65536)
                || !hash_equals($referenceHash, hash('sha256', $this->readFile($root, self::REFERENCE, self::MAX_OUTPUT_BYTES)))) {
                throw new \RuntimeException('Symfony preparation changed during verification.');
            }
            // A reused manifest ID must not keep an older language-server reference alive.
            return ['enabled' => true, 'fresh' => true,
                'generation' => hash('sha256', $manifestBytes."\0".$referenceHash."\0".$snapshot['sha256'])];
        } finally {
            if (is_resource($lock)) {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
        }
    }

    /** Expected setup bytes only. The worker source below is never executed by this verifier. */
    private static function configurationFiles(string $vendorDirectory = 'vendor'): array
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

    /** Composer's configured vendor directory, constrained to the selected project. */
    private function vendorDirectory(string $directory): string
    {
        $root = $directory;
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

    private function json(array $data): string
    {
        return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
    }
}

try {
    if (count($argv) !== 2) {
        throw new \InvalidArgumentException('Supply the selected application directory.');
    }
    echo json_encode((new ProviderPreparationVerifier())->verify($argv[1]), JSON_THROW_ON_ERROR)."\n";
} catch (\Throwable) {
    fwrite(STDERR, "Symfony preparation is stale, incomplete or unavailable. Prepare again in the application runtime.\n");
    exit(3);
}
