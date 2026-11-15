<?php

declare(strict_types=1);

namespace Xormania\UXor\Theme;

/** Installed presentation metadata. Template names are opaque references, not files to read. */
final readonly class ThemeDefinition
{
    /** @var list<string> */
    public array $modes;

    /** @var array<string, string> */
    public array $templates;

    /**
     * @param list<string> $modes
     * @param array<string, string> $templates Component name to template reference
     */
    public function __construct(
        public string $id,
        public string $revision,
        array $modes,
        public string $defaultMode,
        array $templates = [],
    ) {
        if ('' === trim($id) || '' === trim($revision)) {
            throw new \InvalidArgumentException('A theme needs a non-empty identity and revision.');
        }
        if (!array_is_list($modes) || [] === $modes) {
            throw new \InvalidArgumentException('Theme modes must be a non-empty list.');
        }
        $seen = [];
        $normalizedModes = [];
        foreach ($modes as $mode) {
            if (!is_string($mode) || '' === trim($mode) || isset($seen[$mode])) {
                throw new \InvalidArgumentException('Theme modes must be distinct non-empty strings.');
            }
            $seen[$mode] = true;
            $normalizedModes[] = $mode;
        }
        if (!in_array($defaultMode, $modes, true)) {
            throw new \InvalidArgumentException('The default mode must be declared by the theme.');
        }
        $normalizedTemplates = [];
        foreach ($templates as $component => $template) {
            if (!is_string($component) || '' === trim($component) || !is_string($template) || '' === trim($template)) {
                throw new \InvalidArgumentException('Theme templates must map component names to non-empty references.');
            }
            $normalizedTemplates[$component] = $template;
        }
        // Copy scalar values individually: readonly arrays otherwise retain caller-owned reference aliases.
        $this->modes = $normalizedModes;
        $this->templates = $normalizedTemplates;
    }
}
