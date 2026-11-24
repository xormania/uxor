<?php

declare(strict_types=1);

namespace Xormania\UXor\Composer;

use Composer\Composer;
use Composer\Repository\RepositoryUtils;
use Composer\Script\Event;
use Symfony\Component\Yaml\Yaml;
use Symfony\Flex\Flex;
use Symfony\Flex\Lock;
use Symfony\Flex\SymfonyBundle;
use Xormania\UXor\ApplicationFiles;
use Xormania\UXor\Preparation\ProjectPath;
use Xormania\UXor\ProjectInspector;

/** Keep newly applied Flex defaults usable when Composer omits development packages. */
final class DevelopmentRecipes
{
    private const ALL = "['all' => true]";
    private const DEV = "['dev' => true, 'test' => true]";

    private function __construct(
        private readonly Lock $lock,
        private readonly string $root,
        private readonly string $config,
        private readonly array $existingRecipes,
        private readonly array $existingFiles,
        private readonly string $existingBundles,
    ) {}

    public static function capture(Composer $composer, string $project): ?self
    {
        // Composer may rename active plugin classes during an update.
        $flex = array_find($composer->getPluginManager()->getPlugins(),
            static fn ($plugin) => $plugin instanceof Flex || str_starts_with($plugin::class, Flex::class.'_composer_tmp'));
        if (null === $flex) {
            return null;
        }
        ['root' => $root, 'config' => $config] = ApplicationFiles::symfonyConfig($project, $composer->getPackage()->getExtra());
        $packages = ProjectPath::writablePath($root, $config.'/packages');
        $bundles = ProjectPath::writablePath($root, $config.'/bundles.php');
        $lock = $flex->getLock();
        return new self($lock, $root, $config, $lock->all(), array_flip(is_dir($packages) ? scandir($packages) : []),
            is_file($bundles) ? (string) file_get_contents($bundles) : '');
    }

    public function configure(Event $event): void
    {
        $composer = $event->getComposer();
        $repo = $composer->getRepositoryManager()->getLocalRepository();
        $uxor = $repo->findPackage('xormania/uxor', '*');
        if (null === $uxor || !$composer->getLocker()->isLocked()) {
            return;
        }
        $dev = array_column($composer->getLocker()->getLockData()['packages-dev'], null, 'name');
        $files = new ApplicationFiles(new ProjectInspector());
        $bundlesPath = $this->config.'/bundles.php';
        $absolute = $files->path($this->root, $bundlesPath);
        if (!is_file($absolute)) {
            return;
        }
        $bundles = $original = (string) file_get_contents($absolute);
        $changes = $receipts = [];
        foreach (RepositoryUtils::filterRequiredPackages($repo->getPackages(), $uxor) as $package) {
            $name = $package->getName();
            $entry = $this->lock->get($name);
            if (!isset($entry['recipe'])) {
                continue;
            }
            $development = isset($dev[$name]);
            $new = !isset($this->existingRecipes[$name]) && $development;
            $classes = 'symfony-bundle' === $package->getType() ? (new SymfonyBundle($composer, $package, 'install'))->getClassNames() : [];
            foreach ($classes as $class) {
                $line = '    '.$class.'::class => ';
                if ($new && !str_contains($this->existingBundles, $class) && str_contains($bundles, $line.self::ALL.",\n")) {
                    $entry['uxor-dev-bundles'][] = $class;
                }
                if (in_array($class, $entry['uxor-dev-bundles'] ?? [], true)) {
                    $bundles = str_replace($line.($development ? self::ALL : self::DEV).",\n",
                        $line.($development ? self::DEV : self::ALL).",\n", $bundles);
                }
            }
            foreach ($entry['files'] ?? [] as $path) {
                if (!$new || dirname($path) !== $this->config.'/packages' || !str_ends_with($path, '.yaml')) {
                    continue;
                }
                $source = $files->path($this->root, $path);
                if (isset($this->existingFiles[basename($path)])) {
                    // Flex records the destination even when it skipped an existing application file.
                    $entry['files'] = array_values(array_diff($entry['files'], [$path]));
                    continue;
                }
                $yaml = is_file($source) ? (string) file_get_contents($source) : '';
                if (!array_diff(array_keys(Yaml::parse($yaml, Yaml::PARSE_CUSTOM_TAGS) ?? []), ['when@dev', 'when@test'])) {
                    continue;
                }
                $base = $this->availableName($path, ['.dist', '.uxor.php']);
                $dist = $files->proposal($this->root, $base.'.dist', $yaml);
                $loader = $files->proposal($this->root, $base.'.uxor.php', self::importer($dist['path'], $name, $classes));
                array_push($changes, $dist, $loader, ['action' => 'remove', 'path' => $path, 'sha256' => hash('sha256', $yaml)]);
                $entry['files'] = array_values(array_diff($entry['files'], [$path]));
                array_push($entry['files'], $dist['path'], $loader['path']);
            }
            if ('symfony/ux-twig-component' === $name && isset($dev['symfony/property-access'])
                && !isset($entry['uxor-property-access']) && isset($entry['files'])) {
                // FrameworkBundle disables optional components installed only for development.
                $default = $this->availableName($this->config.'/packages/00_uxor_property_access', ['.php']).'.php';
                $changes[] = $files->proposal($this->root, $default,
                    (string) file_get_contents(__DIR__.'/../../resources/composer/twig-property-access.php'));
                $entry['files'][] = $entry['uxor-property-access'] = $default;
            }
            $receipts[$name] = $entry;
        }
        if ($bundles !== $original) {
            $changes[] = ['action' => 'update', 'path' => $bundlesPath, 'sha256' => hash('sha256', $original), 'content' => $bundles];
        }
        $result = $files->apply($this->root, $changes);
        if (null !== $result['error']) {
            throw new \RuntimeException($result['error']);
        }
        foreach ($receipts as $name => $entry) {
            $this->lock->set($name, $entry);
        }
        $this->lock->write();
    }

    private function availableName(string $base, array $extensions): string
    {
        $name = $base;
        for ($n = 2; array_any($extensions, fn (string $ext) => file_exists($this->root.'/'.$name.$ext) || is_link($this->root.'/'.$name.$ext)); ++$n) {
            $name = $base.'.'.$n;
        }
        return $name;
    }

    private static function importer(string $path, string $package, array $classes): string
    {
        $names = implode(', ', array_map(static fn (string $class) => var_export($class, true), $classes));
        $guard = [] === $classes
            ? '\\Composer\\InstalledVersions::isInstalled('.var_export($package, true).", in_array(\$config->env(), ['dev', 'test'], true))"
            : "array_intersect([{$names}], \$container->getParameter('kernel.bundles'))";
        $source = var_export(basename($path), true);
        return <<<PHP
<?php

use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

return static function (ContainerConfigurator \$config, ContainerBuilder \$container): void {
    if ({$guard}) {
        \$config->import({$source}, 'yaml');
    }
};

PHP;
    }
}
