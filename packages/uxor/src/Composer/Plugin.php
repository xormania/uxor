<?php

declare(strict_types=1);

namespace Xormania\UXor\Composer;

use Composer\Composer;
use Composer\EventDispatcher\EventSubscriberInterface;
use Composer\Factory;
use Composer\IO\IOInterface;
use Composer\Json\JsonFile;
use Composer\Package\Locker;
use Composer\Plugin\PluginInterface;
use Composer\Script\Event;
use Composer\Script\ScriptEvents;
use Symfony\AI\Mate\ComposerPlugin\MatePlugin;
use Symfony\Component\Process\Process;
use Xormania\UXor\ApplicationFiles;
use Xormania\UXor\Operations;
use Xormania\UXor\Preparation\ProjectPath;
use Xormania\UXor\ProjectInspector;
use Xormania\UXor\SetupOwnership;

final class Plugin implements PluginInterface, EventSubscriberInterface
{
    private ?DevelopmentRecipes $developmentRecipes = null;
    private bool $mateReady = false;

    public function activate(Composer $composer, IOInterface $io): void
    {
        // --no-autoloader skips POST_AUTOLOAD_DUMP but still sends the post-install/update event.
        // Suppress the upstream hook early if its hardcoded command already belongs to another layout or owner.
        $repo = $composer->getRepositoryManager()->getLocalRepository();
        $file = realpath(Factory::getComposerFile());
        if (false === $file || null === $repo->findPackage('xormania/uxor', '*')) {
            return;
        }
        $root = dirname($file);
        $public = $root.'/vendor/bin/mate';
        $native = $repo->findPackage('symfony/ai-mate', '*');
        if (null === $native || !is_file($public)) {
            return;
        }
        $config = $composer->getConfig();
        $vendor = $config->get('vendor-dir');
        $proxy = new InstalledBinary($io, $config->get('bin-dir'), 'auto', vendorDir: $vendor);
        $source = $composer->getInstallationManager()->getInstallPath($native).'/bin/mate';
        if (realpath($vendor) !== $root.'/vendor' || !$proxy->matches($source, $public)) {
            $this->removeNativeDiscovery($composer);
        }
    }

    public function deactivate(Composer $composer, IOInterface $io): void {}

    public function uninstall(Composer $composer, IOInterface $io): void
    {
        $file = realpath(Factory::getComposerFile());
        if (false !== $file && 'composer.json' === basename($file)) {
            $root = dirname($file);
            $lock = ApplicationFiles::lockProject($root);
            $result = MateVendorLink::detachment($root, true);
            if (null !== $result['note']) {
                $io->writeError('<warning>UXor: '.$result['note'].'</warning>');
            }
        }
    }

    public static function getSubscribedEvents(): array
    {
        return [
            ScriptEvents::POST_AUTOLOAD_DUMP => 'initialize',
            ScriptEvents::POST_INSTALL_CMD => 'discover',
            ScriptEvents::POST_UPDATE_CMD => 'discover',
        ];
    }

    public function initialize(Event $event): void
    {
        $root = $this->applicationRoot($event);
        if (null === $root) {
            return;
        }
        $composer = $event->getComposer();
        if (null === $this->developmentRecipes && null !== $this->developmentRecipes = DevelopmentRecipes::capture($composer, $root)) {
            // Flex has registered its recipe handlers. Append before Composer runs application scripts.
            $dispatcher = $composer->getEventDispatcher();
            $dispatcher->addListener(ScriptEvents::POST_INSTALL_CMD, [$this->developmentRecipes, 'configure']);
            $dispatcher->addListener(ScriptEvents::POST_UPDATE_CMD, [$this->developmentRecipes, 'configure']);
        }
        $this->removeNativeDiscovery($composer);
        $paths = $this->mateDirectories($event, $root);
        if (null === $paths) {
            return;
        }
        [$vendor, $bin] = $paths;
        $ownership = new SetupOwnership(new ApplicationFiles(new ProjectInspector()));
        if (!$ownership->hasRecordedSetup($root)) {
            $result = Operations::create()->run('setup', ['project_root' => $root, 'apply' => true]);
            if ('failed' === $result['status']) {
                throw new \RuntimeException($result['summary']);
            }
            if ('incomplete' === $result['status']) {
                $event->getIO()->writeError('<warning>UXor: review preserved application configuration with the setup command.</warning>');
            }
        }
        if ('vendor' !== $vendor) {
            $problem = MateVendorLink::connect($root, $vendor);
            if (null !== $problem) {
                $event->getIO()->writeError('<warning>UXor: '.$problem.'</warning>');
                if (!MateVendorLink::available($root, $vendor)) {
                    return;
                }
            }
        }
        $native = $composer->getRepositoryManager()->getLocalRepository()->findPackage('symfony/ai-mate', '*');
        if (null === $native) {
            return;
        }
        $proxy = new InstalledBinary($event->getIO(), $root.'/'.$bin, 'auto', vendorDir: $root.'/'.$vendor);
        $matePath = $composer->getInstallationManager()->getInstallPath($native).'/bin/mate';
        $usableNative = $proxy->matches($matePath, $root.'/'.$bin.'/mate');
        if (!$usableNative) {
            $event->getIO()->writeError('<warning>UXor: the public '.$bin.'/mate is missing or belongs to another command. UXor preserved it. Use '.$bin.'/uxor mate for this application.</warning>');
        }
        $this->mateReady = true;
        $manifestFile = new JsonFile($root.'/composer.json');
        $freshConfig = !is_file($root.'/mate/config.php');
        if ($freshConfig || !is_file($root.'/mate/extensions.php')) {
            foreach (['composer.json', 'composer.lock', 'AGENTS.md', 'CLAUDE.md', 'mate/config.php', 'mate/extensions.php',
                'mate/.env', 'mate/.gitignore', 'mate/AGENT_INSTRUCTIONS.md', 'mate/src/.gitignore'] as $path) {
                ProjectPath::writablePath($root, $path);
            }
            $this->runMate($event, $root, $vendor, 'init');
            if ($freshConfig) {
                $this->configureInvocation($root, $bin, $usableNative && 'vendor' === $vendor);
            }
        }
        $manifest = $manifestFile->read();
        $locker = $composer->getLocker();
        if ($locker->isLocked() && isset($manifest['extra']['ai-mate'])) {
            $lockedHash = $locker->getLockData()['content-hash'] ?? null;
            if ($this->onlyMateRegistrationChanged($manifest, $lockedHash)) {
                $locker->updateHash($manifestFile);
            }
        }
        $package = $composer->getPackage();
        $devAutoload = $manifest['autoload-dev'] ?? [];
        if ($package->getDevAutoload() !== $devAutoload) {
            // Mate init can add its project PSR-4 mapping after Composer generated this autoloader.
            $package->setDevAutoload($devAutoload);
            $generator = clone $composer->getAutoloadGenerator();
            $generator->setRunScripts(false);
            $generator->dump($composer->getConfig(), $composer->getRepositoryManager()->getLocalRepository(), $package,
                $composer->getInstallationManager(), 'composer', (bool) ($event->getFlags()['optimize'] ?? false), null, $locker);
        }
    }

    public function discover(Event $event): void
    {
        $root = $this->applicationRoot($event);
        if (null === $root || !is_file($root.'/mate/extensions.php')) {
            return;
        }
        if ($this->mateReady) {
            $vendor = ProjectPath::composerDirectory($root, $event->getComposer()->getConfig()->get('vendor-dir'));
            $this->runMate($event, $root, $vendor, 'discover', '--composer');
        }
    }

    private function removeNativeDiscovery(Composer $composer): void
    {
        // Mate's own hook invokes an app-relative bin/mate. UXor calls the installed package
        // with the configured autoloader, including when Composer preserved a conflicting binary.
        foreach ($composer->getPluginManager()->getPlugins() as $plugin) {
            if (str_starts_with($plugin::class, MatePlugin::class)) {
                $composer->getEventDispatcher()->removeListener([$plugin, 'onPostInstallOrUpdate']);
            }
        }
    }

    /** @return array{string, string}|null */
    private function mateDirectories(Event $event, string $root): ?array
    {
        $composer = $event->getComposer();
        $config = $composer->getConfig();
        try {
            $effective = [
                ProjectPath::composerDirectory($root, $config->get('vendor-dir')),
                ProjectPath::composerDirectory($root, $config->get('bin-dir')),
            ];
            $manifest = (new JsonFile($root.'/composer.json'))->read();
            $declaredVendor = ProjectPath::composerDirectory($root, $manifest['config']['vendor-dir'] ?? 'vendor');
            $declaredBin = ProjectPath::composerDirectory($root, $manifest['config']['bin-dir'] ?? $declaredVendor.'/bin');
            if ($effective !== [$declaredVendor, $declaredBin]) {
                $event->getIO()->writeError('<warning>UXor: Composer’s effective vendor or binary directory differs from the application manifest. Declare the paths in composer.json for automatic onboarding.</warning>');
                return null;
            }
            return $effective;
        } catch (\InvalidArgumentException $error) {
            $event->getIO()->writeError('<warning>UXor: onboarding requires project-local Composer directories. '.$error->getMessage().'</warning>');
            return null;
        }
    }

    /** Set the invocation in the fresh upstream template only. Existing application configuration is never rewritten. */
    private function configureInvocation(string $root, string $bin, bool $native): void
    {
        $command = $bin.'/'.($native ? 'mate' : 'uxor');
        if ($native && 'vendor/bin/mate' === $command) {
            return;
        }
        $files = new ApplicationFiles(new ProjectInspector());
        $config = $files->path($root, 'mate/config.php');
        $content = (string) file_get_contents($config);
        // Mate uses a DDEV prefix for DDEV projects. Keep that prefix when replacing the generated default.
        $quoted = preg_match('~^[a-zA-Z0-9_./-]+$~D', $command) ? $command : escapeshellarg($command);
        if (!$native) {
            $quoted .= ' mate';
        }
        $next = preg_replace_callback("~(->set\('mate\.invocation', )'(ddev exec )?vendor/bin/mate'(\))~",
            static fn (array $match): string => $match[1].var_export(($match[2] ?? '').$quoted, true).$match[3],
            $content, 1, $count);
        if (1 === $count && is_string($next)) {
            $update = $files->apply($root, [['path' => 'mate/config.php', 'action' => 'update', 'sha256' => hash('sha256', $content), 'content' => $next]]);
            if (null !== $update['error']) {
                throw new \RuntimeException($update['error']);
            }
        }
    }

    private function applicationRoot(Event $event): ?string
    {
        if (!$event->isDevMode() || null === $event->getComposer()->getRepositoryManager()->getLocalRepository()->findPackage('xormania/uxor', '*')) {
            return null;
        }
        $file = realpath(Factory::getComposerFile());
        if (false === $file || 'composer.json' !== basename($file)) {
            $event->getIO()->writeError('<warning>UXor: Mate requires an application manifest named composer.json.</warning>');
            return null;
        }
        return dirname($file);
    }

    private function runMate(Event $event, string $root, string $vendor, string ...$arguments): void
    {
        $process = new Process([PHP_BINARY, __DIR__.'/../../resources/composer/run-mate.php', $root.'/'.$vendor.'/autoload.php', ...$arguments, '--no-interaction'], $root);
        $process->mustRun();
        $event->getIO()->write($process->getOutput(), true, 'init' === $arguments[0] ? IOInterface::VERBOSE : IOInterface::NORMAL);
    }

    /** Only Mate's added registration may account for the stale dependency hash. */
    private function onlyMateRegistrationChanged(array $manifest, ?string $lockedHash): bool
    {
        if (null === $lockedHash || $lockedHash === Locker::getContentHash(JsonFile::encode($manifest))) {
            return false;
        }
        unset($manifest['extra']['ai-mate']);
        if ($lockedHash === Locker::getContentHash(JsonFile::encode($manifest))) {
            return true;
        }
        if ([] === $manifest['extra']) {
            unset($manifest['extra']);
            return $lockedHash === Locker::getContentHash(JsonFile::encode($manifest));
        }
        return false;
    }
}
