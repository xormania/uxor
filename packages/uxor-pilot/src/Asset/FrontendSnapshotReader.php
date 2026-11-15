<?php

namespace UXor\Pilot\Asset;

/** Captures filesystem evidence; declaration and compatibility decisions stay in the validator. */
final class FrontendSnapshotReader
{
    /**
     * @param list<array{owner: string, version: ?string, reference: ?string, packagePath: string, metadataPath: string, metadata: array<string, mixed>}> $packages
     * @param array<string, array<string, mixed>> $selections
     */
    public function read(array $packages, array $selections): FrontendSnapshot
    {
        $observed = [];
        $errors = [];
        foreach ($packages as $package) {
            $owner = json_encode($package['owner'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            $packagePath = realpath($package['packagePath']);
            $metadataPath = realpath($package['metadataPath']);
            if (false === $packagePath || !is_dir($packagePath) || false === $metadataPath || !is_file($metadataPath)
                || !str_starts_with($metadataPath, $packagePath.DIRECTORY_SEPARATOR)) {
                $errors[] = 'invalid-package-metadata: '.$owner.' must identify a file inside its installed package';
                continue;
            }
            // Suppress a racing filesystem warning; retain an owner-specific failure in the snapshot.
            $hash = @hash_file('sha256', $metadataPath);
            if (false === $hash) {
                $errors[] = 'invalid-package-metadata: cannot hash '.$owner;
                continue;
            }
            $observed[] = [
                'owner' => $package['owner'], 'version' => $package['version'], 'reference' => $package['reference'],
                'metadataSha256' => $hash, 'metadata' => $package['metadata'],
                'localPaths' => $this->localPaths($package['metadata'], $packagePath, $metadataPath),
            ];
        }
        $observedSelections = [];
        foreach ($selections as $name => $input) {
            // A plain array copy retains referenced entries. Copy each value before changing the path.
            $selection = [];
            foreach ($input as $key => $value) {
                $selection[$key] = $value;
            }
            if (!isset($selection['version'])) {
                $path = $selection['path'] ?? null;
                $canonical = is_string($path) ? realpath($path) : false;
                $selection['path'] = false !== $canonical && is_file($canonical) ? $canonical : null;
            }
            $observedSelections[$name] = $selection;
        }

        return new FrontendSnapshot($observed, $observedSelections, $errors);
    }

    /** @return array<string, ?string> */
    private function localPaths(array $metadata, string $packagePath, string $metadataPath): array
    {
        $symfony = $metadata['symfony'] ?? null;
        $imports = is_array($symfony) ? ($symfony['importmap'] ?? null) : null;
        $paths = [];
        foreach (is_array($imports) ? $imports : [] as $raw) {
            // Only gather recognizable file references. Malformed declarations are preserved for the policy.
            $range = is_array($raw) ? ($raw['version'] ?? null) : $raw;
            if (!is_string($range)) {
                continue;
            }
            if (str_starts_with($range, 'entrypoint:')) {
                $range = 'path:'.substr($range, strlen('entrypoint:'));
            }
            if (!str_starts_with($range, 'path:%PACKAGE%/') || str_contains($range, '\\') || preg_match('/[\x00-\x1f\x7f]/', $range)) {
                continue;
            }
            $path = realpath(dirname($metadataPath).substr($range, strlen('path:%PACKAGE%')));
            $paths[$range] = false !== $path && is_file($path) && str_starts_with($path, $packagePath.DIRECTORY_SEPARATOR) ? $path : null;
        }

        return $paths;
    }
}
