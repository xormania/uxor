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

    public function activate(Composer $composer, IOInterface $io): void {}

    public function deactivate(Composer $composer, IOInterface $io): void {}

    public function uninstall(Composer $composer, IOInterface $io): void {}

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
        if (!$this->mateUsesApplicationRoot($composer, $root)) {
            // Upstream Mate discovers from root/vendor and derives its root from the autoloader's parent.
            $event->getIO()->writeError('<warning>UXor: Mate cannot discover extensions in this vendor directory. Its CLI expects vendor/ directly under the application root.</warning>');
            return;
        }
        $manifestFile = new JsonFile($root.'/composer.json');
        if (!is_file($root.'/mate/config.php') || !is_file($root.'/mate/extensions.php')) {
            foreach (['composer.json', 'composer.lock', 'AGENTS.md', 'CLAUDE.md', 'mate/config.php', 'mate/extensions.php',
                'mate/.env', 'mate/.gitignore', 'mate/AGENT_INSTRUCTIONS.md', 'mate/src/.gitignore'] as $path) {
                ProjectPath::writablePath($root, $path);
            }
            $this->runMate($event, $root, 'init');
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
        $composer = $event->getComposer();
        if (!$this->mateUsesApplicationRoot($composer, $root)) {
            return;
        }
        // Symfony's plugin already discovers after install/update using the default binary path.
        // Composer can suffix the active class name when it reloads a plugin being upgraded.
        if (is_file($root.'/vendor/bin/mate') && array_any($composer->getPluginManager()->getPlugins(),
            static fn (PluginInterface $plugin): bool => str_starts_with($plugin::class, MatePlugin::class))) {
            return;
        }
        $this->runMate($event, $root, 'discover', '--composer');
    }

    private function mateUsesApplicationRoot(Composer $composer, string $root): bool
    {
        $vendor = realpath($composer->getConfig()->get('vendor-dir'));
        return false !== $vendor && dirname($vendor) === $root && $vendor === realpath($root.'/vendor');
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

    private function runMate(Event $event, string $root, string ...$arguments): void
    {
        $bin = $event->getComposer()->getConfig()->get('bin-dir').'/mate';
        $process = new Process([PHP_BINARY, $bin, ...$arguments, '--no-interaction'], $root);
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
