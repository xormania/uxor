<?php

declare(strict_types=1);

namespace Xormania\UXor;

use Composer\Package\AliasPackage;
use Composer\Package\CompleteAliasPackage;
use Composer\Package\Loader\ArrayLoader;
use Composer\Package\Locker;
use Composer\Package\PackageInterface;
use Composer\Package\RootPackage;
use Composer\Package\RootPackageInterface;
use Composer\Package\Version\VersionParser;
use Composer\Repository\InstalledArrayRepository;
use Composer\Repository\InstalledRepository;

/** Composer's installed repository, built from the selected application's JSON without loading its PHP. */
final class InstalledPackages
{
    private array $records = [];
    private array $actual = [];
    private ?InstalledRepository $repository = null;
    private bool $aliasesLoaded = false;
    private ?array $lock = null;

    public function __construct(array $records, private readonly ?\Closure $readLock = null, private readonly ?array $root = null)
    {
        foreach ($records as $row) {
            if (is_string($row['name'] ?? null) && is_string($row['version'] ?? null)) {
                $this->records[strtolower($row['name'])] = $row;
            }
        }
    }

    public function versions(): array
    {
        return array_column($this->records, 'version', 'name');
    }

    public function version(string $name): ?string
    {
        return $this->records[$name]['version'] ?? null;
    }

    /** Return the installed package, alias or declared link that satisfies a Composer requirement. */
    public function match(string $name, string $constraint = ''): ?array
    {
        $repository = $this->repository ??= $this->buildRepository();
        $parser = new VersionParser();
        $required = $parser->parseConstraints('' === $constraint ? '*' : $constraint);
        $matches = $repository->findPackagesWithReplacersAndProviders($name, $required);
        // A root inline alias can extend the version range of a present package or its self.version links.
        $needsAlias = [] === $matches || (isset($this->actual[$name]) && !array_any($matches, static fn ($package): bool => $package->getName() === $name));
        if ($needsAlias && !$this->aliasesLoaded && [] !== $repository->findPackagesWithReplacersAndProviders($name)) {
            $this->loadLockAliases($repository, $parser);
            $matches = $repository->findPackagesWithReplacersAndProviders($name, $required);
        }
        // When Composer accepts multiple candidates, prefer the actual named package for reporting.
        $rank = static fn (PackageInterface $package): int => ($package->getName() === $name ? 0 : 2) + (int) ($package instanceof AliasPackage);
        usort($matches, static fn (PackageInterface $a, PackageInterface $b): int => $rank($a) <=> $rank($b));
        foreach ($matches as $package) {
            $actual = $package instanceof AliasPackage ? $package->getAliasOf() : $package;
            $alias = $package === $actual ? [] : ['matched_alias' => $package->getPrettyVersion()];
            if ($name === $package->getName()) {
                if ($actual instanceof RootPackageInterface) {
                    continue;
                }
                return ['satisfied_by' => 'installed_package'] + $alias;
            }
            foreach (['replace' => $package->getReplaces(), 'provide' => $package->getProvides()] as $type => $links) {
                foreach ($links as $link) {
                    if ($name === $link->getTarget() && $required->matches($link->getConstraint())) {
                        $declared = 'replace' === $type ? $actual->getReplaces() : $actual->getProvides();
                        $provider = ['package' => $actual->getName(), 'installed_version' => $actual->getPrettyVersion(),
                            'link' => $type, 'constraint' => $declared[$name]->getPrettyConstraint()];
                        if ($actual instanceof RootPackageInterface) {
                            $provider['source'] = 'application_root';
                            $provider['installed_version'] = $this->root['version'] ?? null;
                        }
                        return ['satisfied_by' => 'replace' === $type ? 'installed_replacement' : 'installed_provider', 'provider' => $provider + $alias];
                    }
                }
            }
        }
        return null;
    }

    private function buildRepository(): InstalledRepository
    {
        $installed = new InstalledArrayRepository();
        $loader = new ArrayLoader();
        foreach ($this->records as $row) {
            // Descriptions, scripts, autoload rules and unrelated dependency links play no part in this lookup.
            $metadata = array_intersect_key($row, array_flip(['name', 'version', 'version_normalized', 'default-branch', 'provide', 'replace']));
            $branches = $row['extra']['branch-alias'] ?? [];
            $metadata['extra']['branch-alias'] = is_array($branches) ? array_filter($branches, 'is_string') : [];
            try {
                $package = $loader->load($metadata);
            } catch (\UnexpectedValueException | \InvalidArgumentException | \TypeError) {
                // A malformed package is no evidence for resolving requirements of the other installed packages.
                continue;
            }
            $installed->addPackage($package);
            $this->actual[$package->getName()] = $package instanceof AliasPackage ? $package->getAliasOf() : $package;
        }
        // The root's installed-package links live in composer.json, outside vendor/composer/installed.json.
        if (!empty($this->root['provide']) || !empty($this->root['replace'])) {
            $hash = Locker::getContentHash(json_encode($this->root, JSON_THROW_ON_ERROR));
            if (($this->lock()['content-hash'] ?? null) === $hash) {
                $root = array_intersect_key($this->root, array_flip(['name', 'version', 'provide', 'replace', 'extra']));
                if (!isset($root['version'])) {
                    // A root's VCS-derived version is absent from JSON; only explicit links are known.
                    foreach (['provide', 'replace'] as $type) {
                        $root[$type] = array_filter($root[$type] ?? [], static fn ($constraint): bool => 'self.version' !== $constraint);
                    }
                }
                $root += ['name' => '__root__', 'version' => RootPackage::DEFAULT_PRETTY_VERSION];
                $installed->addPackage($loader->load($root, RootPackage::class));
            }
        }
        return new InstalledRepository([$installed]);
    }

    private function lock(): array
    {
        return $this->lock ??= null === $this->readLock ? [] : ($this->readLock)();
    }

    private function loadLockAliases(InstalledRepository $repository, VersionParser $parser): void
    {
        $this->aliasesLoaded = true;
        $installed = $repository->getRepositories()[0];
        $aliases = $this->lock()['aliases'] ?? [];
        foreach (is_array($aliases) ? $aliases : [] as $alias) {
            if (!is_string($alias['package'] ?? null) || !is_string($alias['version'] ?? null)
                || !is_string($alias['alias'] ?? null) || !is_string($alias['alias_normalized'] ?? null)) {
                continue;
            }
            $base = $this->actual[$alias['package']] ?? null;
            if (null === $base || $base->getVersion() !== $alias['version']) {
                continue;
            }
            try {
                if ($parser->normalize($alias['alias']) !== $alias['alias_normalized']) {
                    continue;
                }
            } catch (\UnexpectedValueException) {
                continue;
            }
            $package = new CompleteAliasPackage($base, $alias['alias_normalized'], $alias['alias']);
            $package->setRootPackageAlias(true);
            $installed->addPackage($package);
        }
    }
}
