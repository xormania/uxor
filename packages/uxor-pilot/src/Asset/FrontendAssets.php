<?php

namespace UXor\Pilot\Asset;

use Symfony\Component\AssetMapper\AssetMapperRepository;
use Symfony\Component\AssetMapper\ImportMap\ImportMapConfigReader;

/** Checks current selections without resolving packages or compiling mapped assets. */
final class FrontendAssets
{
    public function __construct(
        private readonly InstalledFrontendPackages $packages,
        private readonly ImportMapConfigReader $importMap,
        private readonly AssetMapperRepository $assets,
        private readonly FrontendContractValidator $validator,
    ) {
    }

    /** @return array{format: int, packages: list<array<string, mixed>>, imports: list<array<string, mixed>>} */
    public function validate(): array
    {
        // AssetMapper caches this reader's root map. Commands/builds use a fresh process;
        // same-process rewrites of importmap.php are outside this validation lifecycle.
        $selections = [];
        try {
            $entries = $this->importMap->getEntries();
        } catch (\InvalidArgumentException|\TypeError $error) {
            throw new \RuntimeException('Invalid import-map configuration: '.$error->getMessage(), 0, $error);
        }
        foreach ($entries as $entry) {
            $selection = ['type' => $entry->type->value, 'entrypoint' => $entry->isEntrypoint];
            if ($entry->isRemotePackage()) {
                $selection['version'] = $entry->version;
                $selection['package_specifier'] = $entry->packageModuleSpecifier;
            } else {
                $path = $this->assets->find($entry->path);
                if (null === $path) {
                    $filesystemPath = $this->importMap->convertPathToFilesystemPath($entry->path);
                    $canonical = realpath($filesystemPath);
                    if (false !== $canonical && null !== $this->assets->findLogicalPath($canonical)) {
                        $path = $canonical;
                    }
                }
                $selection['path'] = $path;
                $selection['raw_path'] = $entry->path;
            }
            $selections[$entry->importName] = $selection;
        }

        return $this->validator->validate($this->packages->read(), $selections);
    }
}
