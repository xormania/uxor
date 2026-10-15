<?php

namespace UXor\Pilot\Asset;

/**
 * Read-only validation of selected frontend dependencies; this is not a resolver.
 *
 * @phpstan-type Selection array{version?: string, package_specifier?: string, type: string, path?: ?string, raw_path?: string, entrypoint: bool}
 * @phpstan-type PackageDescriptor array{owner: string, version: ?string, reference: ?string, packagePath: string, metadataPath: string, metadata: array<string, mixed>}
 * @phpstan-type FrontendReport array{format: int, packages: list<array<string, mixed>>, imports: list<array<string, mixed>>}
 * @phpstan-type Requirement array{owner: string, field: string, raw: mixed, kind: string, specifier: ?string, package: ?string, range: ?string, path: ?string, entrypoint: bool}
 * @phpstan-type Peer array{owner: string, field: string, raw: string, package: string, range: string, optional: bool}
 */
final class FrontendContractValidator
{
    public function __construct(private readonly StableNpmRange $ranges)
    {
    }

    /**
     * @param list<PackageDescriptor> $packages
     * @param array<string, Selection> $selections
     * @return FrontendReport
     */
    public function validate(array $packages, array $selections): array
    {
        /** @var list<string> $errors */
        $errors = [];
        /** @var array<string, list<Requirement>> $requirements */
        $requirements = [];
        /** @var list<Peer> $peers */
        $peers = [];
        $provenance = [];
        $owners = [];
        foreach ($packages as $package) {
            $owner = $package['owner'];
            if (isset($owners[$owner])) {
                $errors[] = 'duplicate-owner: '.$this->quote($owner);
            }
            $owners[$owner] = true;
            $packagePath = realpath($package['packagePath']);
            $metadataPath = realpath($package['metadataPath']);
            if (false === $packagePath || !is_dir($packagePath) || false === $metadataPath || !is_file($metadataPath)
                || !str_starts_with($metadataPath, $packagePath.DIRECTORY_SEPARATOR)) {
                $errors[] = 'invalid-package-metadata: '.$this->quote($owner).' must identify a file inside its installed package';
                continue;
            }
            $hash = hash_file('sha256', $metadataPath);
            if (false === $hash) {
                $errors[] = 'invalid-package-metadata: cannot hash '.$this->quote($owner);
                continue;
            }
            $provenance[] = ['owner' => $owner, 'version' => $package['version'], 'reference' => $package['reference'], 'metadataSha256' => $hash];
            $metadata = $package['metadata'];
            $symfony = $this->map(array_key_exists('symfony', $metadata) ? $metadata['symfony'] : [], $owner.' symfony', $errors);
            $imports = null === $symfony ? null : $this->map(array_key_exists('importmap', $symfony) ? $symfony['importmap'] : [], $owner.' symfony.importmap', $errors);
            foreach ($imports ?? [] as $name => $raw) {
                $requirement = $this->importRequirement($owner, $name, $raw, $packagePath, $metadataPath, $errors);
                if (null !== $requirement) {
                    $requirements[$name][] = $requirement;
                }
            }
            $peerMap = $this->map(array_key_exists('peerDependencies', $metadata) ? $metadata['peerDependencies'] : [], $owner.' peerDependencies', $errors);
            $peerMeta = $this->map(array_key_exists('peerDependenciesMeta', $metadata) ? $metadata['peerDependenciesMeta'] : [], $owner.' peerDependenciesMeta', $errors);
            $optionalPeers = [];
            foreach ($peerMeta ?? [] as $name => $rawFlags) {
                $flags = $this->map($rawFlags, $owner.' peerDependenciesMeta.'.$name, $errors);
                if ($this->identity($name) !== $name || null === $flags || array_diff(array_keys($flags), ['optional'])
                    || (array_key_exists('optional', $flags) && !is_bool($flags['optional']))) {
                    $errors[] = 'unsupported-declaration: '.$this->quote($owner).' peerDependenciesMeta.'.$name.' accepts an npm package and boolean optional flag';
                    continue;
                }
                $optionalPeers[$name] = $flags['optional'] ?? false;
            }
            foreach ($peerMap ?? [] as $name => $range) {
                $field = 'peerDependencies.'.$name;
                $identity = $this->identity($name);
                if (null === $identity || $identity !== $name || !is_string($range)) {
                    $errors[] = 'unsupported-declaration: '.$this->quote($owner).' '.$field.' must name an npm package and string range';
                    continue;
                }
                if ($this->supportedRange($range, $owner, $field, $errors)) {
                    $peers[] = ['owner' => $owner, 'field' => $field, 'raw' => $range, 'package' => $name, 'range' => $range, 'optional' => $optionalPeers[$name] ?? false];
                }
            }
        }

        // Peers address the underlying npm package, including aliases and CSS/module subpaths.
        // A local override with a matching name is present, but its npm compatibility is unknown.
        foreach ($peers as $peer) {
            $names = [];
            foreach ($requirements as $name => $entries) {
                foreach ($entries as $entry) {
                    if ($entry['package'] === $peer['package']) {
                        $names[$name] = true;
                    }
                }
            }
            foreach ($selections as $name => $selection) {
                $identity = $this->identity($selection['package_specifier'] ?? $name);
                if ($identity === $peer['package']) {
                    $names[$name] = true;
                }
            }
            if ([] === $names) {
                if (!$peer['optional']) {
                    $errors[] = 'requires-resolution: missing npm peer '.$this->quote($peer['package']).'; '.$this->origin($peer['owner'], $peer['field'], $peer['raw']);
                }
                continue;
            }
            foreach (array_keys($names) as $name) {
                $requirements[$name][] = [
                    'owner' => $peer['owner'], 'field' => $peer['field'], 'raw' => $peer['raw'], 'kind' => 'registry',
                    'specifier' => null, 'package' => $peer['package'], 'range' => $peer['range'], 'path' => null, 'entrypoint' => false,
                ];
            }
        }

        ksort($requirements, SORT_STRING);
        $imports = [];
        /** @var array<string, array<string, list<string>>> $versions */
        $versions = [];
        /** @var array<string, true> $relevantPackages */
        $relevantPackages = [];
        /** @var array<string, list<string>> $packageOrigins */
        $packageOrigins = [];
        foreach ($requirements as $name => $entries) {
            usort($entries, $this->compareRequirements(...));
            $origins = implode('; ', array_map(fn (array $entry): string => $this->origin($entry['owner'], $entry['field'], $entry['raw']), $entries));
            $kinds = array_values(array_unique(array_column($entries, 'kind')));
            $paths = array_values(array_unique(array_filter(array_column($entries, 'path'), static fn (?string $path): bool => null !== $path)));
            $specifiers = array_values(array_unique(array_filter(array_column($entries, 'specifier'), static fn (?string $specifier): bool => null !== $specifier)));
            if (in_array('local', $kinds, true) && in_array('registry', $kinds, true) && [] === $specifiers) {
                $errors[] = 'unknown-compatibility: npm peer requirements for package-owned local import '.$this->quote($name).' need explicit version evidence; '.$origins;
                $kinds = ['local'];
            }
            if (1 !== count($kinds) || count($paths) > 1 || count($specifiers) > 1) {
                $errors[] = 'declaration-collision: '.$this->quote($name).'; '.$origins;
                continue;
            }
            foreach ($entries as $entry) {
                if (null !== $entry['package']) {
                    $relevantPackages[$entry['package']] = true;
                    $packageOrigins[$entry['package']][] = $this->origin($entry['owner'], $entry['field'], $entry['raw']);
                }
            }
            if (!array_key_exists($name, $selections)) {
                $errors[] = 'requires-resolution: missing import '.$this->quote($name).'; '.$origins;
                continue;
            }
            $selection = $selections[$name];
            if (!in_array($selection['type'], ['js', 'css'], true)) {
                $errors[] = 'unsupported-selection: '.$this->quote($name).' has unknown asset type; '.$origins;
                continue;
            }
            if ('local' === $kinds[0]) {
                $actual = $selection['path'] ?? null;
                if (isset($selection['version']) || null === $actual || !is_file($actual) || realpath($actual) !== $paths[0]) {
                    $errors[] = 'requires-resolution: '.$this->quote($name).' must select its declared package-owned file; '.$origins;
                }
                foreach ($entries as $entry) {
                    if ($entry['entrypoint'] && !$selection['entrypoint']) {
                        $errors[] = 'requires-resolution: '.$this->quote($name).' must remain an entrypoint; '.$this->origin($entry['owner'], $entry['field'], $entry['raw']);
                    }
                }
            } elseif (!isset($selection['version'])) {
                $errors[] = 'unknown-compatibility: local override for registry import '.$this->quote($name).'; '.$origins;
            } else {
                if ($selection['entrypoint']) {
                    $errors[] = 'unsupported-selection: remote import '.$this->quote($name).' cannot be an entrypoint; '.$origins;
                }
                $specifier = $selection['package_specifier'] ?? $name;
                $identity = $this->identity($specifier);
                foreach ($entries as $entry) {
                    if (null === $identity || $identity !== $entry['package'] || (null !== $entry['specifier'] && $specifier !== $entry['specifier'])) {
                        $errors[] = 'requires-resolution: '.$this->quote($name).' selects a different npm package or subpath; '.$this->origin($entry['owner'], $entry['field'], $entry['raw']);
                        continue;
                    }
                    try {
                        if (!$this->ranges->matches($selection['version'], $entry['range'] ?? '')) {
                            $errors[] = 'requires-resolution: '.$this->quote($name).' selected '.$this->quote($selection['version']).' does not satisfy '.$this->origin($entry['owner'], $entry['field'], $entry['raw']).'; all declarations: '.$origins;
                        }
                    } catch (\InvalidArgumentException $error) {
                        $errors[] = 'unsupported-selection: '.$this->quote($name).'; '.$this->origin($entry['owner'], $entry['field'], $entry['raw']).'; '.$error->getMessage();
                    }
                }
            }
            $imports[] = ['name' => $name, 'kind' => $kinds[0], 'selection' => $this->canonical($selection), 'requirements' => $entries];
        }

        // One shared registry package must not acquire different versions under another alias or subpath.
        foreach ($selections as $name => $selection) {
            $identity = $this->identity(isset($selection['version']) ? ($selection['package_specifier'] ?? $name) : $name);
            if (null === $identity || !isset($relevantPackages[$identity])) {
                continue;
            }
            if (!isset($selection['version'])) {
                $alreadyChecked = false;
                foreach ($requirements[$name] ?? [] as $entry) {
                    if ('registry' === $entry['kind']) {
                        $alreadyChecked = true;
                    }
                }
                if (!$alreadyChecked) {
                    $origins = array_values(array_unique($packageOrigins[$identity]));
                    sort($origins, SORT_STRING);
                    $errors[] = 'unknown-compatibility: local import '.$this->quote($name).' is named under managed registry package '.$this->quote($identity).'; all declarations: '.implode('; ', $origins);
                }
                continue;
            }
            try {
                $this->ranges->matches($selection['version'], '*');
                $versions[$identity][$selection['version']][] = $name;
            } catch (\InvalidArgumentException $error) {
                $errors[] = 'unsupported-selection: '.$this->quote($name).'; '.$error->getMessage();
            }
        }
        ksort($versions, SORT_STRING);
        foreach ($versions as $package => $selectedVersions) {
            if (count($selectedVersions) > 1) {
                ksort($selectedVersions, SORT_STRING);
                foreach ($selectedVersions as &$names) {
                    sort($names, SORT_STRING);
                }
                unset($names);
                $origins = array_values(array_unique($packageOrigins[$package]));
                sort($origins, SORT_STRING);
                $errors[] = 'requires-resolution: shared npm package '.$this->quote($package).' has inconsistent selected versions '.$this->quote($selectedVersions).'; all declarations: '.implode('; ', $origins);
            }
        }
        if ([] !== $errors) {
            $errors = array_values(array_unique($errors));
            sort($errors, SORT_STRING);
            throw new \RuntimeException("Frontend dependency validation failed:\n- ".implode("\n- ", $errors));
        }
        usort($provenance, static fn (array $a, array $b): int => $a['owner'] <=> $b['owner']);

        return ['format' => 1, 'packages' => $provenance, 'imports' => $imports];
    }

    /**
     * @param list<string> $errors
     * @return array<string, mixed>|null
     */
    private function map(mixed $value, string $context, array &$errors): ?array
    {
        if (!is_array($value) || ([] !== $value && array_is_list($value))) {
            $errors[] = 'unsupported-declaration: '.$this->quote($context).' must be an object';

            return null;
        }
        foreach (array_keys($value) as $key) {
            if (!is_string($key) || '' === $key || preg_match('/[\x00-\x20\x7f]/', $key)) {
                $errors[] = 'unsupported-declaration: '.$this->quote($context).' has an invalid key';

                return null;
            }
        }

        return $value;
    }

    /**
     * @param list<string> $errors
     * @return Requirement|null
     */
    private function importRequirement(string $owner, string $name, mixed $raw, string $packagePath, string $metadataPath, array &$errors): ?array
    {
        $field = 'symfony.importmap.'.$name;
        $specifier = $name;
        $entrypoint = false;
        if (is_string($raw)) {
            $range = $raw;
        } else {
            $config = $this->map($raw, $owner.' '.$field, $errors);
            if (null === $config || array_diff(array_keys($config), ['version', 'package', 'entrypoint']) || !isset($config['version']) || !is_string($config['version'])
                || (array_key_exists('package', $config) && !is_string($config['package']))
                || (array_key_exists('entrypoint', $config) && !is_bool($config['entrypoint']))) {
                $errors[] = 'unsupported-declaration: '.$this->origin($owner, $field, $raw).' must use version, optional package and boolean entrypoint';

                return null;
            }
            $range = $config['version'];
            $specifier = $config['package'] ?? $name;
            $entrypoint = $config['entrypoint'] ?? false;
        }
        if (str_starts_with($range, 'entrypoint:')) {
            $entrypoint = true;
            $range = 'path:'.substr($range, strlen('entrypoint:'));
        }
        $record = ['owner' => $owner, 'field' => $field, 'raw' => $this->canonical($raw), 'kind' => 'registry', 'specifier' => $specifier, 'package' => null, 'range' => null, 'path' => null, 'entrypoint' => $entrypoint];
        if (str_starts_with($range, 'path:')) {
            if (!str_starts_with($range, 'path:%PACKAGE%/') || str_contains($range, '\\') || preg_match('/[\x00-\x1f\x7f]/', $range)) {
                $errors[] = 'unsupported-declaration: package-owned paths must start with path:%PACKAGE%/; '.$this->origin($owner, $field, $raw);

                return null;
            }
            $path = realpath(dirname($metadataPath).substr($range, strlen('path:%PACKAGE%')));
            if (false === $path || !is_file($path) || !str_starts_with($path, $packagePath.DIRECTORY_SEPARATOR)) {
                $errors[] = 'invalid-package-path: file is missing or escapes its installed package; '.$this->origin($owner, $field, $raw);

                return null;
            }
            return [...$record, 'kind' => 'local', 'specifier' => null, 'path' => $path];
        }
        $identity = $this->identity($specifier);
        if (null === $identity || $entrypoint) {
            $errors[] = 'unsupported-declaration: registry imports require an npm package/subpath and cannot be entrypoints; '.$this->origin($owner, $field, $raw);

            return null;
        }
        if (!$this->supportedRange($range, $owner, $field, $errors)) {
            return null;
        }

        return [...$record, 'package' => $identity, 'range' => $range];
    }

    /** @param list<string> $errors */
    private function supportedRange(string $range, string $owner, string $field, array &$errors): bool
    {
        try {
            // Parsing checks every branch even when the version is not a match.
            $this->ranges->matches('0.0.0', $range);

            return true;
        } catch (\InvalidArgumentException $error) {
            $errors[] = 'unsupported-declaration: '.$this->origin($owner, $field, $range).'; '.$error->getMessage();

            return false;
        }
    }

    private function identity(string $specifier): ?string
    {
        if (!preg_match('{\A(?<package>(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*)(?<path>(?:/[A-Za-z0-9._-]+)*)\z}', $specifier, $matches)) {
            return null;
        }
        foreach (explode('/', $matches['path']) as $segment) {
            if ('.' === $segment || '..' === $segment) {
                return null;
            }
        }

        return $matches['package'];
    }

    /** @param Requirement $record */
    private function recordKey(array $record): string
    {
        return $this->quote([$record['owner'], $record['field'], $record['raw']]);
    }

    /**
     * @param Requirement $a
     * @param Requirement $b
     */
    private function compareRequirements(array $a, array $b): int
    {
        return $this->recordKey($a) <=> $this->recordKey($b);
    }

    private function origin(string $owner, string $field, mixed $raw): string
    {
        return $this->quote($owner).' '.$field.' declares '.$this->quote($raw);
    }

    private function quote(mixed $value): string
    {
        return json_encode($this->canonical($value), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }

    private function canonical(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            ksort($value, SORT_STRING);
        }

        return array_map($this->canonical(...), $value);
    }
}
