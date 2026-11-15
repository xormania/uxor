<?php

namespace UXor\Pilot\Asset;

/**
 * Facts captured by an adapter, or supplied directly by a caller without a filesystem.
 *
 * Paths are canonical identities, not instructions for the validator to read files.
 * A snapshot describes one observation; capture again after changing installed files.
 *
 * @phpstan-type PackageSnapshot array{owner: string, version: ?string, reference: ?string, metadataSha256: string, metadata: array<string, mixed>, localPaths: array<string, ?string>}
 * @phpstan-import-type Selection from FrontendContractValidator
 */
final readonly class FrontendSnapshot
{
    public array $packages;
    public array $selections;
    public array $errors;

    /**
     * @param list<PackageSnapshot> $packages
     * @param array<string, Selection> $selections
     * @param list<string> $errors Failed observations must not be represented as absent packages.
     */
    public function __construct(array $packages, array $selections, array $errors = [])
    {
        $this->packages = self::detach($packages);
        $this->selections = self::detach($selections);
        $this->errors = self::detach($errors);
    }

    /** Copy values individually so nested PHP references cannot mutate captured observations. */
    private static function detach(array $values, array $ancestors = []): array
    {
        $copy = [];
        foreach ($values as $key => $value) {
            if (is_array($value)) {
                $reference = \ReflectionReference::fromArrayElement($values, $key)?->getId();
                if (null !== $reference && isset($ancestors[$reference])) {
                    throw new \InvalidArgumentException('Frontend snapshot facts cannot contain cyclic references.');
                }
                $branch = $ancestors;
                if (null !== $reference) {
                    $branch[$reference] = true;
                }
                $copy[$key] = self::detach($value, $branch);
            } elseif (is_object($value) || is_resource($value)) {
                throw new \InvalidArgumentException('Frontend snapshot facts must contain arrays and scalar values only.');
            } else {
                $copy[$key] = $value;
            }
        }

        return $copy;
    }
}
