<?php

declare(strict_types=1);

namespace Xormania\UXor\Theme;

/** Resolves explicit preferences and overrides without HTTP, Twig, or filesystem state. */
final readonly class ThemeResolver
{
    public function __construct(private ThemeCatalog $catalog, private string $defaultThemeId)
    {
    }

    /** @param array<string, string> $applicationTemplates Trusted application configuration */
    public function resolve(ThemeContext $context, array $applicationTemplates = []): ResolvedTheme
    {
        $default = $this->catalog->get($this->defaultThemeId);
        if (null === $default) {
            throw new \LogicException(sprintf('The default theme is not installed: %s.', $this->defaultThemeId));
        }
        $fallbacks = [];
        $selected = $default;
        if (null !== $context->themeId && $context->themeId !== $default->id) {
            $requested = $this->catalog->get($context->themeId);
            if (null === $requested) {
                $fallbacks[] = 'theme_unavailable';
            } else {
                $selected = $requested;
            }
        }
        $mode = $selected->defaultMode;
        if (null !== $context->mode) {
            if (in_array($context->mode, $selected->modes, true)) {
                $mode = $context->mode;
            } else {
                $fallbacks[] = 'mode_unavailable';
            }
        }

        $templates = $default->templates;
        $origins = array_fill_keys(array_keys($templates), [
            'source' => 'default', 'theme' => $default->id, 'revision' => $default->revision,
        ]);
        if ($selected->id !== $default->id) {
            foreach ($selected->templates as $component => $template) {
                $templates[$component] = $template;
                $origins[$component] = ['source' => 'theme', 'theme' => $selected->id, 'revision' => $selected->revision];
            }
        }
        foreach ($applicationTemplates as $component => $template) {
            if (!is_string($component) || '' === trim($component) || !is_string($template) || '' === trim($template)) {
                throw new \InvalidArgumentException('Application templates must map component names to non-empty references.');
            }
            $templates[$component] = $template;
            $origins[$component] = ['source' => 'application', 'theme' => null, 'revision' => null];
        }
        ksort($templates, SORT_STRING);
        ksort($origins, SORT_STRING);

        return new ResolvedTheme($selected->id, $selected->revision, $mode, $templates, $origins, $fallbacks);
    }
}
