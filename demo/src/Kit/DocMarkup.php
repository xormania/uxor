<?php

namespace App\Kit;

/**
 * What the gallery does to documentation written for the repository (a recipe's README, INSTALL.md, the guide) before
 * it shows it (RecipeDocs, GuideDocs): its relative links name files in the repository, which the gallery serves under
 * other URLs, and its code blocks and tables can scroll sideways.
 */
final class DocMarkup
{
    /**
     * A code block and a table scroll sideways when they are wider than the page: each can take the focus, so a
     * keyboard reaches what is past its edge (axe: scrollable-region-focusable). CommonMark writes them bare.
     */
    public static function focusableScrolling(string $html): string
    {
        $html = str_replace('<pre>', '<pre tabindex="0">', $html);

        return str_replace(['<table>', '</table>'], ['<div class="recipe-doc-table" tabindex="0"><table>', '</table></div>'], $html);
    }

    /**
     * Each relative link of rendered HTML (`<a href="../spinner/README.md#usage">`), resolved from the repository's
     * root by $url. A supplied repository link prefix also identifies paths from the repository root.
     *
     * @param string                  $dir the directory of the documentation's file in the repository ('' for its root)
     * @param \Closure(string): string $url the URL of a file, given its path from the repository's root
     */
    public static function resolveHtmlLinks(string $html, string $dir, \Closure $url, ?string $repositoryPrefix = null): string
    {
        return preg_replace_callback(
            '#<a href="([^"\#]+)(\#[^"]*)?"#i',
            static function (array $match) use ($dir, $url, $repositoryPrefix): string {
                $path = self::linkPath(html_entity_decode($match[1]), $dir, $repositoryPrefix);

                return null === $path ? $match[0] : \sprintf('<a href="%s%s"', htmlspecialchars($url($path), \ENT_QUOTES), $match[2] ?? '');
            },
            $html,
        ) ?? $html;
    }

    /**
     * The same in Markdown (`](../spinner/README.md#usage)`), outside its code blocks: a link there is an example's.
     *
     * @param \Closure(string): string $url
     */
    public static function resolveMarkdownLinks(string $markdown, string $dir, \Closure $url, ?string $repositoryPrefix = null): string
    {
        $fence = null;
        $lines = [];
        foreach (explode("\n", $markdown) as $line) {
            if (preg_match('/^\h*(`{3,}|~{3,})/', $line, $marker)) {
                if (null === $fence) {
                    $fence = $marker[1];
                } elseif (str_starts_with(ltrim($line), $fence)) {
                    $fence = null;
                }
            } elseif (null === $fence) {
                $line = preg_replace_callback(
                    '/\]\(([^)\s#]+)(#[^)\s]*)?\)/',
                    static function (array $match) use ($dir, $url, $repositoryPrefix): string {
                        $path = self::linkPath($match[1], $dir, $repositoryPrefix);

                        return null === $path ? $match[0] : ']('.$url($path).($match[2] ?? '').')';
                    },
                    $line,
                ) ?? $line;
            }
            $lines[] = $line;
        }

        return implode("\n", $lines);
    }

    private static function linkPath(string $target, string $dir, ?string $repositoryPrefix): ?string
    {
        if (null !== $repositoryPrefix && str_starts_with($target, $repositoryPrefix)) {
            $dir = '';
            $target = substr($target, \strlen($repositoryPrefix));
        } elseif (preg_match('#^(?:[a-z][a-z0-9+.-]*:|/)#i', $target)) {
            return null;
        }

        $path = self::repositoryPath($dir, $target);
        // The Composer guides link to offline copies. The gallery renders or links the originals at its release.
        $bundle = 'packages/uxor/resources/uxor/docs/';

        return str_starts_with($path, $bundle) ? substr($path, \strlen($bundle)) : $path;
    }

    /**
     * A path a file in $dir gives, relative to it, from the repository's root.
     */
    public static function repositoryPath(string $dir, string $relative): string
    {
        $parts = [];
        foreach (explode('/', $dir.'/'.$relative) as $part) {
            if ('..' === $part) {
                array_pop($parts);
            } elseif ('' !== $part && '.' !== $part) {
                $parts[] = $part;
            }
        }

        return implode('/', $parts);
    }
}
