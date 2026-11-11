<?php

namespace UXor\Pilot\Asset;

use Composer\Autoload\ClassLoader;
use Composer\InstalledVersions;
use Symfony\Component\Filesystem\Path;

/** Reads installed package metadata without assuming Composer's vendor directory layout. */
final class InstalledFrontendPackages
{
    /** @return list<array{owner: string, version: ?string, reference: ?string, packagePath: string, metadataPath: string, metadata: array<string, mixed>}> */
    public function read(): array
    {
        $packages = [];
        foreach ($this->installedMetadata() as $owner => $record) {
            $installedPath = InstalledVersions::getInstallPath($owner);
            // Provided/replaced packages and metapackages have no installed source tree.
            if (null === $installedPath) {
                continue;
            }
            $packagePath = realpath($installedPath);
            if (false === $packagePath || !is_dir($packagePath)) {
                throw new \RuntimeException(sprintf('Installed Composer package "%s" has no readable package directory.', $owner));
            }
            // Match Flex's precedence, including its oldest supported asset location.
            $metadataPath = null;
            foreach (['assets', 'Resources/assets', 'src/Resources/assets'] as $directory) {
                $candidate = $packagePath.'/'.$directory.'/package.json';
                if (!file_exists($candidate) && !is_link($candidate)) {
                    continue;
                }
                $metadataPath = realpath($candidate);
                if (false === $metadataPath || !is_file($metadataPath)
                    || !str_starts_with($metadataPath, $packagePath.\DIRECTORY_SEPARATOR)) {
                    throw new \RuntimeException(sprintf('UX metadata for "%s" must be a file inside its installed package.', $owner));
                }
                break;
            }
            // A UX package can contain only PHP/templates and declare no frontend metadata.
            if (null === $metadataPath) {
                continue;
            }
            $packages[] = [
                'owner' => $owner,
                'version' => InstalledVersions::getPrettyVersion($owner),
                'reference' => InstalledVersions::getReference($owner),
                'packagePath' => $packagePath,
                'metadataPath' => $metadataPath,
                'metadata' => $this->readObject($metadataPath, $owner, true),
            ];
        }

        return $packages;
    }

    /** @return array<string, array<string, mixed>> */
    private function installedMetadata(): array
    {
        $packages = [];
        foreach (array_keys(ClassLoader::getRegisteredLoaders()) as $vendorPath) {
            $path = $vendorPath.'/composer/installed.json';
            if (!is_file($path)) {
                if (is_file($vendorPath.'/composer/installed.php')) {
                    throw new \RuntimeException(sprintf('Composer metadata registry "%s" is missing.', $path));
                }
                continue;
            }
            $installed = $this->readObject($path, 'Composer installed registry');
            $records = $installed['packages'] ?? null;
            if (!is_array($records) || !array_is_list($records)) {
                throw new \RuntimeException(sprintf('Composer registry "%s" must contain a packages list.', $path));
            }
            foreach ($records as $record) {
                if (!is_array($record) || !isset($record['name']) || !is_string($record['name'])) {
                    throw new \RuntimeException(sprintf('Composer registry "%s" contains an invalid package record.', $path));
                }
                $owner = $record['name'];
                $keywords = $record['keywords'] ?? [];
                if (!is_array($keywords) || !array_is_list($keywords)
                    || array_filter($keywords, static fn (mixed $keyword): bool => !is_string($keyword))) {
                    throw new \RuntimeException(sprintf('Composer keywords for "%s" must be a list of strings.', $owner));
                }
                if (!in_array('symfony-ux', $keywords, true) || !InstalledVersions::isInstalled($owner)) {
                    continue;
                }
                $activePath = InstalledVersions::getInstallPath($owner);
                if (null === $activePath) {
                    continue;
                }
                $recordPath = $record['install-path'] ?? null;
                if (!is_string($recordPath) || '' === $recordPath) {
                    throw new \RuntimeException(sprintf('Composer registry for "%s" has no install-path.', $owner));
                }
                $recordPath = realpath(Path::makeAbsolute($recordPath, dirname($path)));
                $activePath = realpath($activePath);
                if (false === $activePath) {
                    throw new \RuntimeException(sprintf('Installed Composer package "%s" has no readable package directory.', $owner));
                }
                // Multiple application autoloaders may expose different copies of a package.
                // Only metadata belonging to Composer's active copy participates.
                if ($activePath !== $recordPath) {
                    continue;
                }
                $packages[$owner] = $record;
            }
        }
        ksort($packages, SORT_STRING);

        return $packages;
    }

    /** @return array<string, mixed> */
    private function readObject(string $path, string $owner, bool $frontendMetadata = false): array
    {
        if (!is_file($path) || !is_readable($path) || false === $json = file_get_contents($path)) {
            throw new \RuntimeException(sprintf('Cannot read metadata "%s" for installed package "%s".', $path, $owner));
        }
        try {
            $object = json_decode($json, flags: \JSON_THROW_ON_ERROR);
            if (!$object instanceof \stdClass) {
                throw new \RuntimeException(sprintf('Metadata "%s" for "%s" must contain a JSON object.', $path, $owner));
            }
            if ($frontendMetadata) {
                $this->validateObjectShapes($object, $owner);
            } else {
                if (!property_exists($object, 'packages') || !is_array($object->packages)) {
                    throw new \RuntimeException(sprintf('Composer registry "%s" must contain a packages list.', $path));
                }
                foreach ($object->packages as $record) {
                    if (!$record instanceof \stdClass) {
                        throw new \RuntimeException(sprintf('Composer registry "%s" contains an invalid package record.', $path));
                    }
                    if (property_exists($record, 'keywords') && (!is_array($record->keywords)
                        || array_filter($record->keywords, static fn (mixed $keyword): bool => !is_string($keyword)))) {
                        throw new \RuntimeException(sprintf('Composer registry "%s" has package keywords that are not a list of strings.', $path));
                    }
                }
            }

            /** @var array<string, mixed> $decoded The object shape was checked above. */
            $decoded = json_decode($json, true, flags: \JSON_THROW_ON_ERROR);

            return $decoded;
        } catch (\JsonException $error) {
            throw new \RuntimeException(sprintf('Invalid JSON metadata "%s" for "%s": %s', $path, $owner, $error->getMessage()), 0, $error);
        }
    }

    private function validateObjectShapes(\stdClass $metadata, string $owner): void
    {
        foreach (['symfony', 'peerDependencies', 'peerDependenciesMeta'] as $field) {
            if (property_exists($metadata, $field) && !$metadata->{$field} instanceof \stdClass) {
                throw new \RuntimeException(sprintf('Frontend metadata "%s" for "%s" must be a JSON object.', $field, $owner));
            }
        }
        $symfony = $metadata->symfony ?? null;
        if ($symfony instanceof \stdClass && property_exists($symfony, 'importmap')) {
            if (!$symfony->importmap instanceof \stdClass) {
                throw new \RuntimeException(sprintf('Frontend metadata "symfony.importmap" for "%s" must be a JSON object.', $owner));
            }
            foreach (get_object_vars($symfony->importmap) as $name => $declaration) {
                if (!is_string($declaration) && !$declaration instanceof \stdClass) {
                    throw new \RuntimeException(sprintf('Importmap declaration "%s" for "%s" must be a string or JSON object.', $name, $owner));
                }
            }
        }
        $peerMetadata = $metadata->peerDependenciesMeta ?? new \stdClass();
        if (!$peerMetadata instanceof \stdClass) {
            throw new \RuntimeException(sprintf('Peer metadata for "%s" must be a JSON object.', $owner));
        }
        foreach (get_object_vars($peerMetadata) as $name => $declaration) {
            if (!$declaration instanceof \stdClass) {
                throw new \RuntimeException(sprintf('Peer metadata "%s" for "%s" must be a JSON object.', $name, $owner));
            }
        }
    }
}
