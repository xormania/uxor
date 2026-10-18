<?php

declare(strict_types=1);

namespace Xormania\UXor;

final class ProjectInspector
{
    private const PACKAGES = ['symfony/framework-bundle', 'symfony/twig-bundle', 'symfony/ux-toolkit',
        'symfony/ux-twig-component', 'symfony/ux-live-component', 'symfony/ux-turbo',
        'symfony/stimulus-bundle', 'symfony/asset-mapper', 'symfony/maker-bundle',
        'symfony/ai-mate', 'symfony/ai-symfony-mate-extension', 'xormania/uxor'];

    public function inspect(string $directory): array
    {
        $root = $this->root($directory);
        $composer = $this->readJson($root.'/composer.json');
        $installedPath = $root.'/vendor/composer/installed.json';
        $installed = is_file($installedPath) ? $this->readJson($installedPath) : null;
        $installedPackages = null === $installed ? [] : ($installed['packages'] ?? $installed);
        $locked = is_file($root.'/composer.lock') ? $this->readJson($root.'/composer.lock') : [];
        $packages = [];
        foreach (self::PACKAGES as $name) {
            $placement = isset($composer['require'][$name]) ? 'require' : (isset($composer['require-dev'][$name]) ? 'require-dev' : null);
            $packages[$name] = ['declared_in' => $placement,
                'constraint' => null === $placement ? null : $composer[$placement][$name],
                'installed_version' => $this->version($installedPackages, $name),
                'locked_version' => $this->version(array_merge($locked['packages'] ?? [], $locked['packages-dev'] ?? []), $name)];
        }
        $configuration = [];
        foreach (['bin/console', 'config/bundles.php', 'config/services.yaml', 'config/services.php',
            'config/packages/twig_component.yaml', 'config/packages/ux_turbo.yaml', 'importmap.php',
            'assets/bootstrap.js', 'assets/controllers.json', 'assets/styles/app.css', 'mate/config.php',
            'mate/extensions.php', 'vendor/bin/mate'] as $path) {
            $configuration[$path] = is_file($root.'/'.$path);
        }
        $files = [];
        foreach (['templates/components', 'templates/uxor', 'src/UXor', 'assets/controllers', 'assets/lib'] as $path) {
            $this->collectFiles($root, $path, $files);
        }
        return ['root' => $root, 'php_binary' => PHP_BINARY, 'php_version' => PHP_VERSION,
            'packages' => $packages, 'installed_metadata_available' => null !== $installed,
            'configuration' => $configuration,
            'component_evidence' => ['files' => array_slice($files, 0, 80), 'truncated' => count($files) > 80,
                'provenance' => 'unknown', 'note' => 'Paths establish file presence only. They do not establish UXor origin, version, customization, or runtime behavior.'],
            'limitations' => ['No application code was booted.', 'Configuration presence does not establish registration or successful execution.',
                'Locked versions describe dependency resolution; installed versions describe vendor metadata.']];
    }

    public function root(string $directory): string
    {
        $root = realpath($directory);
        if (false === $root || !is_dir($root) || !is_file($root.'/composer.json')) {
            throw new \InvalidArgumentException('Select an existing application root containing composer.json with --project-root (or Mate root configuration).');
        }
        return $root;
    }

    private function readJson(string $file): array
    {
        if (!is_readable($file) || filesize($file) > 16 * 1024 * 1024) {
            throw new \RuntimeException('Project JSON file is unreadable or exceeds 16 MiB: '.$file);
        }
        try {
            $value = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \RuntimeException('Invalid project JSON: '.$file, 0, $e);
        }
        if (!is_array($value)) {
            throw new \RuntimeException('Expected JSON object or package list: '.$file);
        }
        return $value;
    }

    private function version(array $packages, string $name): ?string
    {
        foreach ($packages as $package) {
            if (is_array($package) && ($package['name'] ?? null) === $name) {
                return isset($package['version']) ? (string) $package['version'] : null;
            }
        }
        return null;
    }

    private function collectFiles(string $root, string $relative, array &$files): void
    {
        $directory = $root.'/'.$relative;
        if (!is_dir($directory) || is_link($directory) || count($files) > 80) {
            return;
        }
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && !$file->isLink()) {
                $files[] = substr($file->getPathname(), strlen($root) + 1);
                if (count($files) > 80) {
                    break;
                }
            }
        }
        sort($files);
    }
}
