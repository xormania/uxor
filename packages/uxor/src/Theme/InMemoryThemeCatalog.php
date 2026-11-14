<?php

declare(strict_types=1);

namespace Xormania\UXor\Theme;

/** An immutable catalog suitable for explicit application configuration and tests. */
final readonly class InMemoryThemeCatalog implements ThemeCatalog
{
    /** @var array<string, ThemeDefinition> */
    private array $definitions;

    /** @param iterable<ThemeDefinition> $definitions */
    public function __construct(iterable $definitions)
    {
        $indexed = [];
        foreach ($definitions as $definition) {
            if (!$definition instanceof ThemeDefinition) {
                throw new \InvalidArgumentException('A theme catalog accepts ThemeDefinition values only.');
            }
            if (isset($indexed[$definition->id])) {
                throw new \InvalidArgumentException(sprintf('Duplicate theme identity: %s.', $definition->id));
            }
            $indexed[$definition->id] = $definition;
        }
        $this->definitions = $indexed;
    }

    public function get(string $id): ?ThemeDefinition
    {
        return $this->definitions[$id] ?? null;
    }
}
