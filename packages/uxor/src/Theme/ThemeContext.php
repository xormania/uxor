<?php

declare(strict_types=1);

namespace Xormania\UXor\Theme;

/** Requested preferences, supplied explicitly by the calling application. */
final readonly class ThemeContext
{
    public function __construct(
        public ?string $themeId = null,
        public ?string $mode = null,
    ) {
    }
}
