<?php

declare(strict_types=1);

namespace Xormania\UXor\Theme;

/** The resolver's boundary to installed definitions; a missing identity returns null. */
interface ThemeCatalog
{
    public function get(string $id): ?ThemeDefinition;
}
