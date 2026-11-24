<?php

declare(strict_types=1);

namespace Xormania\UXor\Tests;

use Composer\Factory;
use Composer\IO\NullIO;
use Composer\Package\Locker;
use Composer\Repository\PlatformRepository;
use Composer\Script\ScriptEvents;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\AI\Mate\Encoding\ResponseEncoder;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Filesystem\Filesystem;
use Xormania\UXor\Composer\Plugin;
use Xormania\UXor\Console\Application;
use Xormania\UXor\Operations;
use Xormania\UXor\Preparation\PreparationSnapshot;
use Xormania\UXor\Mate\Capabilities;

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
        file_put_contents($this->project.'/vendor/composer/installed.php', $canary);
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

    public function testSetupConfiguresTheProjectWithoutRunningASecondInstaller(): void
    {
        // Simulate a partially installed app: the package is available but its development tools are absent.
        mkdir($this->project.'/vendor/bin', 0777, true);
        mkdir($this->project.'/mate');
        file_put_contents($this->project.'/mate/config.php', "<?php return [];\n");
        file_put_contents($this->project.'/vendor/bin/mate', file_get_contents($this->project.'/vendor/autoload.php'));
        file_put_contents($this->project.'/composer.lock', "{\"packages\": [], \"packages-dev\": []}\n");
        $manifest = file_get_contents($this->project.'/composer.json');
        $lock = file_get_contents($this->project.'/composer.lock');
        $marker = $this->directory.'/resolver-invoked';
        $composer = $this->directory.'/composer';
        file_put_contents($composer, "#!/bin/sh\ntouch ".escapeshellarg($marker)."\nexit 9\n");
        chmod($composer, 0755);
        $path = getenv('PATH');
        putenv('PATH='.$this->directory.PATH_SEPARATOR.$path);
        try {
            foreach ([['--install' => true], []] as $options) {
                [$code, $result] = $this->invoke('setup', ['--apply' => true, '--trust-project-code' => true] + $options);
                self::assertFileDoesNotExist($marker, 'Only the application Composer install or update resolves the development graph.');
                self::assertSame($manifest, file_get_contents($this->project.'/composer.json'));
                self::assertSame($lock, file_get_contents($this->project.'/composer.lock'));
                self::assertSame(0, $code, json_encode($result));
                self::assertSame('completed', $result['status']);
                self::assertSame([], $result['data']['executions']);
                self::assertFileExists($this->project.'/.uxor/mcp.json');
                self::assertFileDoesNotExist($this->project.'/application-executed');
                $dependencies = array_column($result['data']['dependencies'], null, 'package');
                self::assertFalse($dependencies['symfony/debug-pack']['compatible']);
                self::assertStringNotContainsString('setup --apply --install', implode(' ', $result['data']['next_steps']));
            }
        } finally {
            putenv('PATH='.$path);
        }
    }

    public function testComposerRetriesAnUnfinishedBootstrapAndPreservesAnExplicitDetach(): void
    {
        // A failed install can leave a populated vendor with no project integration.
        mkdir($this->project.'/vendor/xormania/uxor', 0777, true);
        $this->writeInstalledPackages(['xormania/uxor' => '0.3.5']);
        mkdir($this->project.'/vendor/bin');
        file_put_contents($this->project.'/vendor/bin/mate', "<?php exit(0);\n");
        mkdir($this->project.'/mate');
        file_put_contents($this->project.'/mate/config.php', "<?php return [];\n");
        file_put_contents($this->project.'/mate/extensions.php', "<?php return [];\n");
        $composerFile = getenv('COMPOSER');
        putenv('COMPOSER='.$this->project.'/composer.json');
        try {
            $completeInstall = function (): void {
                $composer = (new Factory())->createComposer(new NullIO(), $this->project.'/composer.json', true, null, true, true);
                $dispatcher = $composer->getEventDispatcher();
                $dispatcher->addSubscriber(new Plugin());
                // A second Composer process has no package install or update to dispatch.
                $dispatcher->dispatchScript(ScriptEvents::POST_AUTOLOAD_DUMP, true);
                $dispatcher->dispatchScript(ScriptEvents::POST_INSTALL_CMD, true);
            };
            $completeInstall();
            self::assertFileExists($this->project.'/.uxor/browser.mjs');
            self::assertFileExists($this->project.'/mago.toml');
            [$code, $result] = $this->invoke('detach', ['--apply' => true]);
            self::assertSame(0, $code, json_encode($result));
            $detached = $this->snapshot($this->project);
            $completeInstall();
            self::assertSame($detached, $this->snapshot($this->project));
        } finally {
            putenv(false === $composerFile ? 'COMPOSER' : 'COMPOSER='.$composerFile);
        }
    }

    public function testToolCompatibilityUsesThePackageComposerConstraints(): void
    {
        $this->writeInstalledPackages(['symfony/maker-bundle' => 'v1.0.0', 'symfony/ai-monolog-mate-extension' => 'v1.1.0']);
        [, $environment] = $this->invoke('environment');
        $rows = array_column($environment['data']['dependencies'], null, 'package');
        $manifest = json_decode(file_get_contents(dirname(__DIR__, 3).'/composer.json'), true, flags: JSON_THROW_ON_ERROR);
        $declared = array_filter($manifest['require'], static fn (string $name): bool => !PlatformRepository::isPlatformPackage($name), ARRAY_FILTER_USE_KEY);
        $reported = array_filter($rows, static fn (array $row): bool => $row['install_requested']);
        self::assertEqualsCanonicalizing(array_keys($declared), array_keys($reported));
        foreach ($declared as $name => $constraint) {
            self::assertSame($constraint, $reported[$name]['constraint'], $name);
        }
        self::assertFalse($rows['symfony/maker-bundle']['compatible']);
        self::assertTrue($rows['symfony/ai-monolog-mate-extension']['compatible']);
    }

    public static function debuggingPackages(): iterable
    {
        $profiler = ['symfony/web-profiler-bundle' => 'v8.1.3', 'symfony/stopwatch' => 'v7.4.2'];
        $debug = ['symfony/debug-bundle' => 'v8.1.1', 'symfony/monolog-bundle' => 'v4.0.0'];

        yield 'fresh application' => [[], null, null];
        yield 'both named packs remain installed' => [
            ['symfony/debug-pack' => 'v1.1.0', 'symfony/profiler-pack' => 'v1.0.6'] + $debug + $profiler,
            'installed_package', 'installed_package',
        ];
        yield 'fully unpacked nested packs' => [$debug + $profiler, 'installed_components', 'installed_components'];
        yield 'only the outer pack was unpacked' => [
            $debug + ['symfony/profiler-pack' => 'v1.0.6'] + $profiler, 'installed_components', 'installed_package',
        ];
        yield 'profiler independently available' => [$profiler, null, 'installed_components'];
        yield 'both debugging bundles without a profiler' => [$debug, null, null];
        yield 'DebugBundle does not supply Stopwatch' => [$debug + ['symfony/web-profiler-bundle' => 'v8.1.3'], null, null];
        yield 'Stopwatch without WebProfilerBundle' => [$debug + ['symfony/stopwatch' => 'v7.4.2'], null, null];
        yield 'incompatible MonologBundle with a working profiler' => [
            ['symfony/monolog-bundle' => 'v2.12.1'] + $debug + $profiler, null, 'installed_components',
        ];
        yield 'supported MonologBundle 3.x' => [
            ['symfony/monolog-bundle' => 'v3.11.1'] + $debug + $profiler, 'installed_components', 'installed_components',
        ];
    }

    #[DataProvider('debuggingPackages')]
    public function testSetupAndEnvironmentDistinguishNamedPackagesFromInstalledComponents(
        array $installed, ?string $debugSource, ?string $profilerSource,
    ): void
    {
        if ([] !== $installed) {
            $installed['symfony/ai-monolog-mate-extension'] = '1.0.0-BETA1';
        }
        $installed += [
            'symfony/framework-bundle' => 'v8.1.0',
            'symfony/maker-bundle' => 'v1.0.0',
            'carthage-software/mago' => '1.60.2',
            'byte-kitsune/mago-symfony-wiring' => '1.3.0',
        ];
        $this->writeInstalledPackages($installed);
        [, $plan] = $this->invoke('setup');
        [$code, $applied] = $this->invoke('setup', ['--apply' => true]);
        self::assertSame(0, $code, $applied['summary']);
        [, $environment] = $this->invoke('environment');
        self::assertSame($plan['data']['dependencies'], $applied['data']['dependencies']);
        self::assertSame($plan['data']['dependencies'], $environment['data']['dependencies']);

        $dependencies = array_column($plan['data']['dependencies'], null, 'package');
        foreach (['symfony/debug-pack' => $debugSource, 'symfony/profiler-pack' => $profilerSource] as $name => $source) {
            self::assertArrayHasKey($name, $dependencies);
            self::assertSame($installed[$name] ?? null, $dependencies[$name]['installed_version']);
            self::assertSame($source, $dependencies[$name]['satisfied_by']);
            self::assertSame(null !== $source, $dependencies[$name]['compatible']);
        }
        self::assertTrue($dependencies['symfony/debug-pack']['install_requested']);
        self::assertFalse($dependencies['symfony/profiler-pack']['install_requested']);
        self::assertTrue($dependencies['symfony/ai-monolog-mate-extension']['install_requested']);
        self::assertSame(isset($installed['symfony/ai-monolog-mate-extension']), $dependencies['symfony/ai-monolog-mate-extension']['compatible']);
        self::assertSame(null !== $profilerSource, $environment['data']['capabilities']['profiler']['installed']);
        self::assertSame(isset($installed['symfony/debug-bundle']), $environment['data']['capabilities']['debug']['installed']);

        $debugComponents = array_column($dependencies['symfony/debug-pack']['components'], null, 'package');
        $profilerComponents = array_column($dependencies['symfony/profiler-pack']['components'], null, 'package');
        self::assertEqualsCanonicalizing(['symfony/debug-bundle', 'symfony/monolog-bundle', 'symfony/profiler-pack'], array_keys($debugComponents));
        self::assertEqualsCanonicalizing(['symfony/web-profiler-bundle', 'symfony/stopwatch'], array_keys($profilerComponents));
        foreach ($debugComponents + $profilerComponents as $package => $component) {
            self::assertSame($installed[$package] ?? null, $component['installed_version'], $package);
        }
        self::assertSame(null !== $profilerSource, $debugComponents['symfony/profiler-pack']['compatible']);
        self::assertSame(isset($installed['symfony/monolog-bundle']) && 'v2.12.1' !== $installed['symfony/monolog-bundle'],
            $debugComponents['symfony/monolog-bundle']['compatible']);

        [$repeatCode, $repeated] = $this->invoke('setup', ['--apply' => true]);
        self::assertSame($code, $repeatCode);
        self::assertSame([], $repeated['changes']);
    }

    public static function monologProviders(): iterable
    {
        yield 'installed fork replacing its own 4.1 release' => ['replace', '4.1.0', 'self.version', true, true];
        yield 'fork replacing its own incompatible major' => ['replace', '2.7.0', 'self.version', true, false];
        yield 'provided range overlaps the requested Monolog 3 or 4' => ['provide', '1.0.0', '>=2.5 <3.1', true, true];
        yield 'provided range is disjoint' => ['provide', '1.0.0', '>=5 <6', true, false];
        yield 'locked fork absent from the installation' => ['replace', '4.1.0', 'self.version', false, false];
    }

    #[DataProvider('monologProviders')]
    public function testDebugPackUsesInstalledComposerLinks(string $link, string $version, string $constraint, bool $installed, bool $compatible): void
    {
        $provider = ['name' => 'example/monolog-bundle', 'version' => $version, $link => ['symfony/monolog-bundle' => $constraint]];
        $this->writeInstalledPackages(['symfony/debug-bundle' => 'v8.1.1', 'symfony/profiler-pack' => 'v1.0.6'], $installed ? [$provider] : []);
        file_put_contents($this->project.'/composer.lock', json_encode(['packages' => [], 'packages-dev' => [$provider]], JSON_THROW_ON_ERROR));

        [, $plan] = $this->invoke('setup');
        $rows = array_column($plan['data']['dependencies'], null, 'package');
        $debug = $rows['symfony/debug-pack'];
        $monolog = array_column($debug['components'], null, 'package')['symfony/monolog-bundle'];
        self::assertSame($compatible, $monolog['compatible']);
        self::assertNull($monolog['installed_version']);
        self::assertSame($compatible ? 'installed_components' : null, $debug['satisfied_by']);
        if ($compatible) {
            self::assertSame('provide' === $link ? 'installed_provider' : 'installed_replacement', $monolog['satisfied_by']);
            self::assertEquals(['package' => 'example/monolog-bundle', 'installed_version' => $version, 'link' => $link, 'constraint' => $constraint], $monolog['provider']);
        } else {
            self::assertNull($monolog['provider'] ?? null);
        }
    }

    public function testDebugPackAcceptsTheInstalledForkThroughItsComposerAlias(): void
    {
        $fork = ['name' => 'example/monolog-fork', 'version' => 'dev-main', 'replace' => ['symfony/monolog-bundle' => 'self.version']];
        $this->writeInstalledPackages(['symfony/debug-bundle' => 'v8.1.1', 'symfony/profiler-pack' => 'v1.0.6'], [$fork]);
        $alias = ['package' => $fork['name'], 'version' => 'dev-main', 'alias' => '4.0.0', 'alias_normalized' => '4.0.0.0'];
        file_put_contents($this->project.'/composer.lock', json_encode(['packages' => [], 'packages-dev' => [$fork], 'aliases' => [$alias]], JSON_THROW_ON_ERROR));

        [, $result] = $this->invoke('environment');
        $debug = array_column($result['data']['dependencies'], null, 'package')['symfony/debug-pack'];
        $monolog = array_column($debug['components'], null, 'package')['symfony/monolog-bundle'];
        self::assertSame('installed_components', $debug['satisfied_by']);
        self::assertNull($monolog['installed_version']);
        self::assertSame('installed_replacement', $monolog['satisfied_by']);
        self::assertSame($fork['name'], $monolog['provider']['package']);
        self::assertSame('dev-main', $monolog['provider']['installed_version']);
        self::assertSame('4.0.0', $monolog['provider']['matched_alias']);
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public static function rootMonologLinks(): iterable
    {
        yield 'the resolved application supplies MonologBundle' => ['replace', true, true];
        yield 'the resolved application provides a compatible version range' => ['provide', true, true];
        yield 'the declaration was added after the lock was written' => ['replace', false, true];
        yield 'the application has a lock but no installation' => ['replace', true, false];
    }

    #[DataProvider('rootMonologLinks')]
    public function testDebugPackRequiresResolvedApplicationLinks(string $link, bool $synchronized, bool $installed): void
    {
        $manifestPath = $this->project.'/composer.json';
        $original = file_get_contents($manifestPath);
        $manifest = json_decode($original, true, flags: JSON_THROW_ON_ERROR);
        $constraint = 'replace' === $link ? '4.1.0' : '^4.1';
        $manifest[$link]['symfony/monolog-bundle'] = $constraint;
        $current = json_encode($manifest, JSON_THROW_ON_ERROR);
        file_put_contents($manifestPath, $current);
        $this->writeInstalledPackages(['symfony/debug-bundle' => 'v8.1.1', 'symfony/profiler-pack' => 'v1.0.6']);
        $installedPath = $this->project.'/vendor/composer/installed.json';
        $lock = [
            'content-hash' => Locker::getContentHash($synchronized ? $current : $original),
            'packages' => [],
            'packages-dev' => json_decode(file_get_contents($installedPath), true, flags: JSON_THROW_ON_ERROR)['packages'],
        ];
        file_put_contents($this->project.'/composer.lock', json_encode($lock, JSON_THROW_ON_ERROR));
        if (!$installed) {
            unlink($installedPath);
        }

        [, $result] = $this->invoke('setup');
        self::assertNotSame('failed', $result['status'], $result['summary']);
        $debug = array_column($result['data']['dependencies'], null, 'package')['symfony/debug-pack'];
        $monolog = array_column($debug['components'], null, 'package')['symfony/monolog-bundle'];
        $compatible = $installed && $synchronized;
        self::assertSame($compatible, $debug['compatible']);
        self::assertSame($compatible, $monolog['compatible']);
        self::assertNull($monolog['installed_version']);
        if ($compatible) {
            self::assertSame('application_root', $monolog['provider']['source']);
            self::assertSame($manifest['name'], $monolog['provider']['package']);
            self::assertNull($monolog['provider']['installed_version']);
            self::assertSame($link, $monolog['provider']['link']);
            self::assertSame($constraint, $monolog['provider']['constraint']);
        }
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testProvidersOfWholePacksDoNotEstablishAnInstalledDebugCommand(): void
    {
        $this->writeInstalledPackages([], [[
            'name' => 'example/debug-tools', 'version' => 'v1.1.0',
            'provide' => ['symfony/debug-pack' => 'self.version'], 'replace' => ['symfony/profiler-pack' => 'v1.0.6'],
        ]]);
        [, $environment] = $this->invoke('environment');
        $rows = array_column($environment['data']['dependencies'], null, 'package');
        foreach (['symfony/debug-pack' => 'installed_provider', 'symfony/profiler-pack' => 'installed_replacement'] as $name => $source) {
            self::assertNull($rows[$name]['installed_version']);
            self::assertSame($source, $rows[$name]['satisfied_by']);
            self::assertSame('example/debug-tools', $rows[$name]['provider']['package']);
        }
        $debug = $environment['data']['capabilities']['debug'];
        self::assertFalse($debug['installed']);
        self::assertFalse($debug['compatible']);
        self::assertSame('not_probed', $debug['observed']);
    }

    public function testSymfonyAggregateReplacementsCompleteBothPacksWithoutInventingBundleInstallations(): void
    {
        $components = ['symfony/debug-bundle', 'symfony/web-profiler-bundle', 'symfony/stopwatch'];
        $this->writeInstalledPackages(['symfony/monolog-bundle' => 'v4.1.0'], [
            ['name' => 'symfony/symfony', 'version' => 'v8.1.0', 'replace' => array_fill_keys($components, 'self.version')],
        ]);
        [, $environment] = $this->invoke('environment');
        $rows = array_column($environment['data']['dependencies'], null, 'package');
        foreach (['symfony/debug-pack', 'symfony/profiler-pack'] as $pack) {
            self::assertSame('installed_components', $rows[$pack]['satisfied_by']);
            self::assertNull($rows[$pack]['installed_version']);
        }
        $evidence = array_column([...$rows['symfony/debug-pack']['components'], ...$rows['symfony/profiler-pack']['components']], null, 'package');
        foreach ($components as $name) {
            self::assertNull($evidence[$name]['installed_version']);
            self::assertSame('symfony/symfony', $evidence[$name]['provider']['package']);
            self::assertSame('v8.1.0', $evidence[$name]['provider']['installed_version']);
        }
        $debug = $environment['data']['capabilities']['debug'];
        self::assertFalse($debug['installed']);
        self::assertTrue($debug['compatible']);
        self::assertSame('not_probed', $debug['observed']);
    }

    public static function monologAliases(): iterable
    {
        $installed = ['name' => 'symfony/monolog-bundle', 'version' => 'dev-main', 'version_normalized' => 'dev-main'];
        $alias = ['package' => 'symfony/monolog-bundle', 'version' => 'dev-main', 'alias' => '4.0.0', 'alias_normalized' => '4.0.0.0'];

        yield 'installed branch matches the lock alias' => [$installed, [$alias], '4.0.0'];
        yield 'an unrelated invalid lock alias does not hide the matching alias' => [$installed, [
            ['package' => 'example/absent', 'version' => 'invalid version'] + $alias, $alias,
        ], '4.0.0'];
        yield 'lock alias for a different branch' => [$installed, [['version' => 'dev-older'] + $alias], null];
        yield 'lock alias for an incompatible major' => [$installed, [['alias' => '2.0.0', 'alias_normalized' => '2.0.0.0'] + $alias], null];
        yield 'lock entry without an installed package' => [null, [$alias], null];
        yield 'installed package declares its own branch alias' => [
            $installed + ['extra' => ['branch-alias' => ['dev-main' => '4.x-dev']]], [], '4.x-dev',
        ];
        yield 'package declares an alias for another branch' => [
            $installed + ['extra' => ['branch-alias' => ['dev-older' => '4.x-dev']]], [], null,
        ];
        yield 'comparable branch cannot alias a different major' => [
            ['name' => 'symfony/monolog-bundle', 'version' => '2.x-dev', 'extra' => ['branch-alias' => ['2.x-dev' => '4.x-dev']]], [], null,
        ];
    }

    #[DataProvider('monologAliases')]
    public function testDebugPackUsesOnlyAliasesOfTheInstalledMonologBundle(?array $monolog, array $aliases, ?string $expectedAlias): void
    {
        $this->writeInstalledPackages(['symfony/debug-bundle' => 'v8.1.1', 'symfony/profiler-pack' => 'v1.0.6'], null === $monolog ? [] : [$monolog]);
        file_put_contents($this->project.'/composer.lock', json_encode(['packages' => [], 'packages-dev' => [], 'aliases' => $aliases], JSON_THROW_ON_ERROR));
        [, $setup] = $this->invoke('setup');
        self::assertNotSame('failed', $setup['status'], $setup['summary']);
        $dependencies = array_column($setup['data']['dependencies'], null, 'package');
        $debug = $dependencies['symfony/debug-pack'];
        $component = array_column($debug['components'], null, 'package')['symfony/monolog-bundle'];

        self::assertSame($monolog['version'] ?? null, $component['installed_version']);
        self::assertSame($expectedAlias, $component['matched_alias'] ?? null);
        self::assertSame(null !== $expectedAlias, $component['compatible']);
        self::assertSame($component['compatible'], $debug['compatible']);
    }

    public function testPreparedProviderAndComposerInstallUseTheSameToolVersions(): void
    {
        $manifest = json_decode(file_get_contents(dirname(__DIR__, 3).'/composer.json'), true, flags: JSON_THROW_ON_ERROR);
        $provider = PreparationSnapshot::REQUIREMENTS;
        self::assertEqualsCanonicalizing(['carthage-software/mago', 'byte-kitsune/mago-symfony-wiring'], array_keys($provider));
        foreach ($provider as $package => $version) {
            self::assertSame($manifest['require'][$package], $version, $package);
        }
    }

    public function testNativeToolPinsRequireTheInstalledReleaseString(): void
    {
        $this->writeInstalledPackages(['carthage-software/mago' => '1.60.2.0', 'byte-kitsune/mago-symfony-wiring' => 'dev-main']);
        $alias = ['package' => 'byte-kitsune/mago-symfony-wiring', 'version' => 'dev-main', 'alias' => '1.3.0', 'alias_normalized' => '1.3.0.0'];
        file_put_contents($this->project.'/composer.lock', json_encode(['packages' => [], 'packages-dev' => [], 'aliases' => [$alias]], JSON_THROW_ON_ERROR));
        [, $environment] = $this->invoke('environment');
        $rows = array_column($environment['data']['dependencies'], null, 'package');
        self::assertFalse($rows['carthage-software/mago']['compatible']);
        self::assertFalse($rows['byte-kitsune/mago-symfony-wiring']['compatible']);

        $pins = ['carthage-software/mago' => '1.60.2', 'byte-kitsune/mago-symfony-wiring' => '1.3.0'];
        $this->writeInstalledPackages([], [['name' => 'example/dev-tools', 'version' => '1.0.0', 'provide' => $pins]]);
        [, $environment] = $this->invoke('environment');
        $rows = array_column($environment['data']['dependencies'], null, 'package');
        foreach (array_keys($pins) as $package) {
            self::assertNull($rows[$package]['installed_version']);
            self::assertFalse($rows[$package]['compatible']);
        }
    }

    public function testDebugBundleInstallationAndTheNativeCommandAreIndependentObservations(): void
    {
        $console = $this->project.'/bin/console';
        $calls = $this->project.'/bin/debug-probe.json';
        file_put_contents($console, <<<'PHP'
            <?php
            if (['help', 'server:dump'] === array_slice($argv, 1, 2)) {
                file_put_contents(__DIR__.'/debug-probe.json', json_encode(array_slice($argv, 1)));
                exit((int) file_get_contents(__DIR__.'/debug-exit'));
            }
            echo '{"commands":[]}';
            PHP);
        file_put_contents($this->project.'/bin/debug-exit', '0');
        $trusted = ['--probe' => true, '--trust-project-code' => true];

        [, $absent] = $this->invoke('environment', $trusted);
        self::assertArrayNotHasKey('debug', $absent['data']['probes']);
        self::assertFileDoesNotExist($calls);

        $this->writeInstalledPackages(['symfony/debug-bundle' => 'v8.1.1']);
        [, $static] = $this->invoke('environment');
        self::assertArrayHasKey('debug', $static['data']['capabilities']);
        self::assertTrue($static['data']['capabilities']['debug']['installed']);
        self::assertSame('not_probed', $static['data']['capabilities']['debug']['observed']);
        self::assertFileDoesNotExist($calls);

        [, $available] = $this->invoke('environment', $trusted);
        self::assertSame('command_available', $available['data']['capabilities']['debug']['observed']);
        self::assertSame(0, $available['data']['probes']['debug']['exit_code']);
        $arguments = json_decode(file_get_contents($calls), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(['help', 'server:dump'], array_slice($arguments, 0, 2));

        file_put_contents($this->project.'/bin/debug-exit', '7');
        [, $failed] = $this->invoke('environment', $trusted);
        self::assertTrue($failed['data']['capabilities']['debug']['installed']);
        self::assertSame('probe_failed', $failed['data']['capabilities']['debug']['observed']);
        self::assertSame(7, $failed['data']['probes']['debug']['exit_code']);
        unlink($console);
        [, $missing] = $this->invoke('environment', $trusted);
        self::assertSame('probe_failed', $missing['data']['capabilities']['debug']['observed']);
    }

    private function writeInstalledPackages(array $versions, array $packages = []): void
    {
        foreach ($versions as $name => $version) {
            $packages[] = ['name' => $name, 'version' => $version];
        }
        file_put_contents($this->project.'/vendor/composer/installed.json', json_encode(['packages' => $packages], JSON_THROW_ON_ERROR));
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
            'config/packages/dev/uxor.php', '.uxor/browser.mjs', '.uxor/README.md', '.uxor/mcp.json'] as $path) {
            self::assertFileExists($this->project.'/'.$path, $path);
        }
        self::assertStringContainsString('.uxor/mago/config.toml', file_get_contents($this->project.'/mago.toml'));
        self::assertStringNotContainsString('[extension-hosts.', file_get_contents($this->project.'/.uxor/mago/config.toml'));
        $configuration = json_decode(file_get_contents($this->project.'/.uxor/mcp.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(['--project-root', $this->project, 'serena'], $configuration['mcpServers']['uxor-mago']['args']);
        self::assertFalse($result['data']['mcp_binding']['requested_saved_project_trust']);
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
        file_put_contents($this->project.'/.mcp.json', <<<'JSON'
            {
                "application_setting": "keep",
                "modelBudget": 123456789012345678901,
                "mcpServers": {
                    "existing": {"command": "consumer-owned-command", "args": ["keep-this"], "env": {}, "extraArgs": []}
                }
            }
            JSON);
        [$code, $result] = $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        self::assertContains($code, [0, 2], json_encode($result));
        self::assertSame($mago, file_get_contents($this->project.'/mago.toml'));
        $source = file_get_contents($this->project.'/.mcp.json');
        $client = json_decode($source, true, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        self::assertSame('keep', $client['application_setting']);
        self::assertMatchesRegularExpression('/"modelBudget"\s*:\s*123456789012345678901(?=\s*[,}])/', $source);
        $neighbor = json_decode($source, flags: JSON_THROW_ON_ERROR)->mcpServers->existing;
        self::assertSame($server['command'], $neighbor->command);
        self::assertSame($server['args'], $neighbor->args);
        self::assertEquals(new \stdClass(), $neighbor->env);
        self::assertSame([], $neighbor->extraArgs);
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

    public function testDetachPreviewsThenRemovesOnlyTheSetupBindingFromEachNativeClient(): void
    {
        $other = ['command' => 'independent-mcp', 'args' => ['project']];
        $claude = $this->project.'/.mcp.json';
        file_put_contents($claude, json_encode(['mcpServers' => ['other' => $other]], JSON_THROW_ON_ERROR));
        mkdir($this->project.'/.codex');
        $codex = $this->project.'/.codex/config.toml';
        $prefix = "# Local preferences\n[mcp_servers.other]\ncommand = \"independent-mcp\"\n";
        $suffix = "\n[profiles.local]\nmodel = \"personal\"\n";
        file_put_contents($codex, $prefix);
        foreach (['claude', 'codex'] as $client) {
            $this->invoke('setup', ['--apply' => true, '--client' => $client]);
        }
        self::assertArrayHasKey('uxor-mago', json_decode(file_get_contents($claude), true)['mcpServers']);
        self::assertStringContainsString('[mcp_servers.uxor-mago]', file_get_contents($codex));
        file_put_contents($codex, $suffix, FILE_APPEND);
        $before = $this->snapshot($this->directory);

        [, $plan] = $this->invoke('detach');
        self::assertSame([], $plan['changes']);
        self::assertSame($before, $this->snapshot($this->directory));
        [$code, $result] = $this->invoke('detach', ['--apply' => true]);
        self::assertSame(0, $code, json_encode($result));
        self::assertSame(['mcpServers' => ['other' => $other]], json_decode(file_get_contents($claude), true));
        self::assertStringContainsString($prefix, file_get_contents($codex));
        self::assertStringContainsString($suffix, file_get_contents($codex));
        self::assertStringNotContainsString('uxor-mago', file_get_contents($codex));
        self::assertFileDoesNotExist($this->project.'/application-executed');

        $after = $this->snapshot($this->directory);
        [$code, $again] = $this->invoke('detach', ['--apply' => true]);
        self::assertSame(0, $code, json_encode($again));
        self::assertSame([], $again['changes']);
        self::assertSame($after, $this->snapshot($this->directory));
    }

    public function testSetupAfterDetachRestoresWorkingIntegrationsAndKeepsApplicationConfiguration(): void
    {
        $other = ['mcpServers' => ['own' => ['command' => 'my-project-server']]];
        $client = $this->project.'/.mcp.json';
        file_put_contents($client, json_encode($other, JSON_THROW_ON_ERROR));
        $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        $paths = ['mago.toml', '.uxor/browser.mjs', '.uxor/mcp.json'];
        $original = [];
        foreach ($paths as $path) {
            $original[$path] = file_get_contents($this->project.'/'.$path);
        }
        [$code, $detached] = $this->invoke('detach', ['--apply' => true]);
        self::assertSame(0, $code, json_encode($detached));
        foreach ($paths as $path) {
            self::assertNotSame($original[$path], file_get_contents($this->project.'/'.$path), $path);
        }
        self::assertSame($other, json_decode(file_get_contents($client), true));
        $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        foreach ($paths as $path) {
            self::assertSame($original[$path], file_get_contents($this->project.'/'.$path), $path);
        }
        $servers = json_decode(file_get_contents($client), true)['mcpServers'];
        self::assertArrayHasKey('uxor-mago', $servers);
        self::assertSame($other['mcpServers']['own'], $servers['own']);
    }

    public function testProfilerUsesFlexConfigurationDirectoryAndPreservesApplicationOwnership(): void
    {
        $manifest = json_decode(file_get_contents($this->project.'/composer.json'), true, flags: JSON_THROW_ON_ERROR);
        $manifest['extra'] = ['symfony' => ['root-dir' => 'app'], 'config-dir' => 'settings'];
        file_put_contents($this->project.'/composer.json', json_encode($manifest, JSON_THROW_ON_ERROR));
        $dev = $this->project.'/app/settings/packages/dev';

        [$code, $result] = $this->invoke('setup', ['--apply' => true]);
        self::assertSame(0, $code, json_encode($result));
        self::assertFileExists($dev.'/uxor.php');
        self::assertFileDoesNotExist($this->project.'/config/packages/dev/uxor.php');
        [$code, $report] = $this->invoke('environment');
        self::assertTrue($report['data']['capabilities']['profiler']['configured']);

        $applicationPolicy = "<?php // Native Symfony policy owned by the application.\n";
        file_put_contents($dev.'/uxor.php', $applicationPolicy);
        $this->invoke('setup', ['--apply' => true]);
        $this->invoke('detach', ['--apply' => true]);
        self::assertSame($applicationPolicy, file_get_contents($dev.'/uxor.php'));

        unlink($dev.'/uxor.php');
        $legacy = "# Local development diagnostics; never loaded in production.\nframework:\n    profiler:\n        collect: true\n";
        file_put_contents($dev.'/uxor.yaml', $legacy);
        [, $report] = $this->invoke('environment');
        self::assertTrue($report['data']['capabilities']['profiler']['configured']);
        [, $plan] = $this->invoke('setup');
        self::assertStringContainsString('app/settings/packages/dev/uxor.yaml', implode("\n", $plan['data']['next_steps']));
        self::assertSame($legacy, file_get_contents($dev.'/uxor.yaml'));
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testEnvironmentTracksConfiguredSerenaAndBrowserDiagnosticsAcrossDetachAndSetup(): void
    {
        foreach ([['setup', true], ['detach', false], ['setup', true]] as [$operation, $configured]) {
            [$code, $result] = $this->invoke($operation, ['--apply' => true]);
            self::assertContains($code, 'setup' === $operation ? [0, 2] : [0], json_encode($result));
            [$code, $report] = $this->invoke('environment');
            self::assertSame(0, $code, json_encode($report));
            $capabilities = $report['data']['capabilities'];
            self::assertSame(
                [$configured, $configured],
                [$capabilities['serena']['configured'], $capabilities['browser']['configured']],
                'Environment after '.$operation,
            );
            self::assertFalse($report['data']['project_code_executed']);
        }
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testEnvironmentLeavesCustomIntegrationReadinessUnknownWithoutLoadingTheWrapper(): void
    {
        $this->invoke('setup', ['--apply' => true]);
        $client = ['mcpServers' => ['uxor-mago' => ['command' => './project-specific-serena']]];
        file_put_contents($this->project.'/.uxor/mcp.json', json_encode($client, JSON_THROW_ON_ERROR));
        file_put_contents($this->project.'/.uxor/browser.mjs', <<<'JS'
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../browser-loaded', import.meta.url), 'loaded');
export const { test, expect } = await import('@playwright/test');
JS);
        [$code, $report] = $this->invoke('environment');
        self::assertSame(0, $code, json_encode($report));
        $capabilities = $report['data']['capabilities'];
        self::assertSame([null, null], [$capabilities['serena']['configured'], $capabilities['browser']['configured']]);
        self::assertFalse($report['data']['project_code_executed']);
        self::assertFileDoesNotExist($this->project.'/browser-loaded');
    }

    public function testDetachIdentifiesAnEditedWrapperAndBindingAndKeepsTheirContents(): void
    {
        $this->invoke('setup', ['--apply' => true, '--client' => 'claude']);
        $wrapper = $this->project.'/.uxor/browser.mjs';
        file_put_contents($wrapper, "\nexport const projectFeature = 'retained';\n", FILE_APPEND);
        $wrapperBytes = file_get_contents($wrapper);
        $client = $this->project.'/.mcp.json';
        $binding = json_decode(file_get_contents($client), true);
        $binding['mcpServers']['uxor-mago']['args'][] = '--custom-app-argument';
        file_put_contents($client, json_encode($binding, JSON_THROW_ON_ERROR));
        [$code, $result] = $this->invoke('detach', ['--apply' => true]);
        self::assertSame(2, $code, json_encode($result));
        $guidance = json_encode($result['data'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        foreach (['.uxor/browser.mjs', '.mcp.json'] as $affected) {
            self::assertStringContainsString($affected, $guidance);
        }
        self::assertSame($wrapperBytes, file_get_contents($wrapper));
        self::assertSame($binding, json_decode(file_get_contents($client), true));
    }

    public function testDetachOfLegacyBindingsWithoutOwnershipEvidencePreservesTheApplication(): void
    {
        mkdir($this->project.'/.uxor');
        $legacy = "import { recordBrowserDiagnostics } from '../vendor/xormania/uxor/packages/uxor/resources/browser/diagnostics.mjs';\n";
        file_put_contents($this->project.'/.uxor/browser.mjs', $legacy);
        $binding = ['command' => $this->project.'/vendor/bin/uxor-mago', 'args' => ['--project-root', $this->project, 'serena']];
        file_put_contents($this->project.'/.mcp.json', json_encode(['mcpServers' => ['uxor-mago' => $binding]], JSON_THROW_ON_ERROR));
        $snapshot = $this->snapshot($this->directory);
        [$code, $result] = $this->invoke('detach', ['--apply' => true]);
        self::assertSame(2, $code, json_encode($result));
        $guidance = json_encode($result['data'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        self::assertStringContainsString('.uxor/browser.mjs', $guidance);
        self::assertStringContainsString('.mcp.json', $guidance);
        self::assertSame($snapshot, $this->snapshot($this->directory));
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

    public function testOnlyExplicitSavedTrustIsWrittenWithoutExecutingTheApplication(): void
    {
        $host = '/host/projects/trusted consumer';
        $manifest = json_decode(file_get_contents($this->project.'/composer.json'), true, 512, JSON_THROW_ON_ERROR);
        $manifest['config']['bin-dir'] = 'tools/bin';
        file_put_contents($this->project.'/composer.json', json_encode($manifest, JSON_THROW_ON_ERROR));
        $before = $this->snapshot($this->directory);
        foreach (['none', 'claude', 'codex'] as $client) {
            [$code, $result] = $this->invoke('setup', [
                '--client' => $client, '--host-project-root' => $host, '--save-project-trust' => true,
            ]);
            self::assertSame(0, $code, json_encode($result));
            self::assertSame('plan', $result['data']['mode']);
            self::assertTrue($result['data']['mcp_binding']['requested_saved_project_trust']);
            self::assertFalse($result['data']['mcp_binding']['verified']);
            self::assertSame([], $result['changes']);
            self::assertSame([], $result['data']['executions']);
            self::assertSame($before, $this->snapshot($this->directory));
        }
        foreach (['none', 'claude', 'codex'] as $client) {
            [$code, $result] = $this->invoke('setup', [
                '--apply' => true, '--client' => $client, '--host-project-root' => $host,
                '--save-project-trust' => true,
            ]);
            self::assertContains($code, [0, 2], json_encode($result));
            self::assertNotSame('failed', $result['status']);
            self::assertTrue($result['data']['mcp_binding']['requested_saved_project_trust']);
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

    public function testRequestingSavedTrustPreservesPreviouslyUntrustedBindingsAndReportsReconciliation(): void
    {
        $this->assertPreservedTrustTransition(false);
    }

    public function testOmittingSavedTrustPreservesPreviouslyTrustedBindingsAndReportsReconciliation(): void
    {
        $this->assertPreservedTrustTransition(true);
    }

    private function assertPreservedTrustTransition(bool $initialTrust): void
    {
        foreach (['claude', 'codex'] as $client) {
            $options = ['--apply' => true, '--client' => $client];
            if ($initialTrust) {
                $options['--save-project-trust'] = true;
            }
            [$code, $result] = $this->invoke('setup', $options);
            self::assertSame(0, $code, json_encode($result));
            self::assertSame('completed', $result['status']);
            self::assertSame($initialTrust, $result['data']['mcp_binding']['requested_saved_project_trust']);
        }
        $before = $this->snapshot($this->directory);
        foreach (['claude', 'codex'] as $client) {
            $options = ['--apply' => true, '--client' => $client];
            if ($initialTrust) {
                $options['--save-project-trust'] = true;
            }
            [$code, $result] = $this->invoke('setup', $options);
            self::assertSame(0, $code, json_encode($result));
            self::assertSame([], $result['changes']);
            self::assertSame($before, $this->snapshot($this->directory));
        }
        foreach (['claude', 'codex'] as $client) {
            $options = ['--apply' => true, '--client' => $client];
            if (!$initialTrust) {
                $options['--save-project-trust'] = true;
            }
            [$code, $result] = $this->invoke('setup', $options);
            self::assertSame(2, $code, json_encode($result));
            self::assertSame('incomplete', $result['status']);
            self::assertSame(!$initialTrust, $result['data']['mcp_binding']['requested_saved_project_trust']);
            self::assertFalse($result['data']['mcp_binding']['verified']);
            self::assertSame([], $result['changes']);
            self::assertSame([], $result['data']['executions']);
            $nextSteps = implode("\n", $result['data']['next_steps']);
            self::assertMatchesRegularExpression('/preserved.*execution permission/i', $nextSteps);
            self::assertStringContainsString('--trust-project-code', $nextSteps);
            self::assertMatchesRegularExpression('/remove.*flag/i', $nextSteps);
            self::assertSame($before, $this->snapshot($this->directory));
        }
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testOperationsOnlySavesTrustForTheLiteralBooleanTrue(): void
    {
        $operations = Operations::create();
        foreach ([false, null, 0, 1, '', 'false', 'true', true] as $savedTrust) {
            $result = $operations->run('setup', [
                'project_root' => $this->project, 'apply' => true,
                'trust_project_code' => true, 'save_project_trust' => $savedTrust,
            ]);
            self::assertNotSame('failed', $result['status'], json_encode($result));
            self::assertSame(true === $savedTrust, $result['data']['mcp_binding']['requested_saved_project_trust']);
            $configuration = json_decode(file_get_contents($this->project.'/.uxor/mcp.json'), true, 512, JSON_THROW_ON_ERROR);
            $arguments = $configuration['mcpServers']['uxor-mago']['args'];
            self::assertSame(true === $savedTrust, in_array('--trust-project-code', $arguments, true));
            self::assertNotContains('--write', $arguments);
            self::assertSame([], $result['data']['executions']);
            self::assertFileDoesNotExist($this->project.'/application-executed');
            // Each case must create a new binding, not preserve an earlier choice.
            unlink($this->project.'/.uxor/mcp.json');
        }
    }

    public function testMateSeparatesCurrentExecutionFromSavedProjectTrust(): void
    {
        $mate = new Capabilities(Operations::create(), $this->project);
        $before = $this->snapshot($this->directory);
        foreach ([
            [[], false],
            [['trustProjectCode' => true], false],
            [['saveProjectTrust' => true], true],
            [['trustProjectCode' => true, 'saveProjectTrust' => true], true],
        ] as [$arguments, $savedTrust]) {
            $result = ResponseEncoder::decode($mate->setup(...$arguments))['untrusted_data'];
            self::assertSame('setup', $result['operation']);
            self::assertSame('plan', $result['data']['mode']);
            self::assertSame($savedTrust, $result['data']['mcp_binding']['requested_saved_project_trust']);
            self::assertFalse($result['data']['mcp_binding']['verified']);
            self::assertSame([], $result['changes']);
            self::assertSame([], $result['data']['executions']);
            self::assertSame($before, $this->snapshot($this->directory));
        }
        $preview = ResponseEncoder::decode($mate->setup(install: true, saveProjectTrust: true))['untrusted_data'];
        self::assertSame('plan', $preview['data']['mode']);
        self::assertSame([], $preview['data']['executions']);
        self::assertSame($before, $this->snapshot($this->directory));

        $result = ResponseEncoder::decode($mate->setup(apply: true, trustProjectCode: true))['untrusted_data'];
        self::assertNotSame('failed', $result['status'], json_encode($result));
        $configuration = json_decode(file_get_contents($this->project.'/.uxor/mcp.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertNotContains('--trust-project-code', $configuration['mcpServers']['uxor-mago']['args']);
        self::assertSame([], $result['data']['executions']);
        unlink($this->project.'/.uxor/mcp.json');

        $result = ResponseEncoder::decode($mate->setup(apply: true, saveProjectTrust: true))['untrusted_data'];
        self::assertNotSame('failed', $result['status'], json_encode($result));
        $configuration = json_decode(file_get_contents($this->project.'/.uxor/mcp.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(['--project-root', $this->project, '--trust-project-code', 'serena'], $configuration['mcpServers']['uxor-mago']['args']);
        self::assertSame([], $result['data']['executions']);
        self::assertFileDoesNotExist($this->project.'/application-executed');
    }

    public function testEnvironmentProbesAndRuntimePreparationRequireExecutionConsent(): void
    {
        $before = $this->snapshot($this->directory);
        foreach ([
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
