<?php

declare(strict_types=1);

namespace Xormania\UXor\Theme;

/** Presentation decisions and their provenance; no template has been rendered or inspected. */
final readonly class ResolvedTheme
{
    /**
     * @param array<string, string> $templates
     * @param array<string, array{source: string, theme: ?string, revision: ?string}> $templateOrigins
     * @param list<string> $fallbacks Stable reason codes for unavailable requested preferences
     */
    public function __construct(
        public string $themeId,
        public string $revision,
        public string $mode,
        public array $templates,
        public array $templateOrigins,
        public array $fallbacks,
    ) {
    }
}
