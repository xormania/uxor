<?php

declare(strict_types=1);

namespace Xormania\UXor\Tools;

use RuntimeException;

/** Maintainer-only export of UXor's existing catalog, manifests and documentation. */
final class ReferenceGenerator
{
    public const REPOSITORY = 'https://github.com/xormania/uxor';

    private const GUIDES = [
        'README.md',
        'FOR-AGENTS.md',
        'INSTALL.md',
        'docs/GUIDE.md',
        'docs/RECIPES.md',
        'docs/PROJECT-AGENTS-SNIPPET.md',
        'docs/TESTING.md',
        'LICENSE',
        'NOTICE',
    ];

    /** @return array<string, string> Paths relative to the generated bundle directory. */
    public function build(string $source, string $revision): array
    {
        if (!preg_match('/^[a-f0-9]{40}$/D', $revision)) {
            throw new RuntimeException('Use the full, lowercase UXor Git commit SHA as --revision.');
        }

        $root = realpath($source);
        if (false === $root || !is_dir($root)) {
            throw new RuntimeException('UXor source directory does not exist.');
        }
        if ($root !== $this->git($root, ['rev-parse', '--show-toplevel'])) {
            throw new RuntimeException('The source must be the root of a UXor Git checkout.');
        }
        if ($revision !== $this->git($root, ['rev-parse', 'HEAD'])) {
            throw new RuntimeException('The source checkout HEAD does not match --revision.');
        }
        if ('' !== $this->git($root, ['status', '--porcelain', '--untracked-files=all'])) {
            throw new RuntimeException('The source checkout must be clean, including untracked files.');
        }

        $tracked = array_fill_keys(explode("\0", $this->git($root, ['ls-files', '-z'], false)), true);
        $read = static function (string $path) use ($root, $tracked): string {
            $absolute = realpath($root.'/'.$path);
            if (!isset($tracked[$path]) || false === $absolute || !is_file($absolute)
                || !str_starts_with($absolute, $root.'/') || is_link($root.'/'.$path)) {
                throw new RuntimeException('Reference input is not a tracked regular source file: '.$path);
            }

            $content = file_get_contents($absolute);
            if (false === $content) {
                throw new RuntimeException('Cannot read source file: '.$path);
            }

            return $content;
        };

        $kit = json_decode($read('manifest.json'), true, 512, JSON_THROW_ON_ERROR);
        if (self::REPOSITORY !== ($kit['homepage'] ?? null)) {
            throw new RuntimeException('The source manifest must identify '.self::REPOSITORY.'.');
        }

        // Match the catalog UXor already maintains, as tools/llms-txt.mjs does upstream.
        $catalog = [];
        $category = null;
        foreach (explode("\n", $read('docs/RECIPES.md')) as $line) {
            if (preg_match('/^## (.+)$/', $line, $match)) {
                $category = self::plain($match[1]);
            } elseif (preg_match('/^\| \[`([a-z0-9-]+)`\]\((?:\.\.\/)?\1\/README\.md\)[^|]*\| (.+) \|$/', $line, $match)) {
                if (null === $category || isset($catalog[$match[1]])) {
                    throw new RuntimeException('Missing category or duplicate catalog recipe: '.$match[1]);
                }
                $catalog[$match[1]] = ['summary' => self::plain($match[2]), 'category' => $category];
            }
        }

        $names = [];
        foreach (glob($root.'/*/manifest.json') ?: [] as $path) {
            $name = basename(dirname($path));
            if (!preg_match('/^[a-z0-9][a-z0-9-]*$/D', $name)) {
                throw new RuntimeException('Unsupported recipe directory: '.$name);
            }
            $names[] = $name;
        }
        sort($names);
        $listed = array_keys($catalog);
        sort($listed);
        if ([] === $names || $names !== $listed) {
            throw new RuntimeException('UXor catalog and recipe manifest directories do not match.');
        }

        $paths = self::GUIDES;
        foreach ($names as $name) {
            $paths[] = $name.'/README.md';
        }
        sort($paths);
        $selected = array_fill_keys($paths, true);
        $files = [];
        $documents = [];
        foreach ($paths as $path) {
            $original = $read($path);
            $content = str_ends_with($path, '.md')
                ? $this->rewriteLinks($original, $path, $root, $revision, $selected)
                : $original;
            $files['docs/'.$path] = $content;
            $documents[$path] = [
                'path' => 'docs/'.$path,
                'sha256' => hash('sha256', $content),
                'source_sha256' => hash('sha256', $original),
                'source_url' => self::REPOSITORY.'/blob/'.$revision.'/'.$path,
            ];
        }

        $components = [];
        foreach ($names as $name) {
            $manifestPath = $name.'/manifest.json';
            $manifestSource = $read($manifestPath);
            $manifest = json_decode($manifestSource, true, 512, JSON_THROW_ON_ERROR);
            foreach ($manifest['dependencies']['recipe'] ?? [] as $dependency) {
                if (!isset($catalog[$dependency])) {
                    throw new RuntimeException($name.' depends on missing recipe '.$dependency.'.');
                }
            }
            $components[$name] = [
                ...$catalog[$name],
                'manifest' => $manifest,
                'manifest_sha256' => hash('sha256', $manifestSource),
                'documentation' => $name.'/README.md',
                'source_url' => self::REPOSITORY.'/tree/'.$revision.'/'.$name,
            ];
        }

        $index = [
            'schema_version' => 1,
            'source' => ['repository' => self::REPOSITORY, 'revision' => $revision, 'license' => $kit['license']],
            'kit' => $kit,
            'components' => $components,
            'documents' => $documents,
        ];
        $files['index.json'] = json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
        ksort($files);

        return $files;
    }

    /** @param array<string, bool> $selected */
    private function rewriteLinks(string $content, string $path, string $root, string $revision, array $selected): string
    {
        $rewrite = function (string $target, bool $image = false) use ($path, $root, $revision, $selected): string {
            // Pin moving links to this kit without changing historical commit links or install commands.
            $target = preg_replace('~^(https://(?:raw\.githubusercontent\.com/xormania/uxor/|github\.com/xormania/uxor/(?:blob|tree)/))(?:main|master|dev)/~', '${1}'.$revision.'/', $target);
            if ('' === $target || preg_match('~^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|/|#)~', $target)) {
                return $target;
            }

            [$relative, $suffix] = preg_split('/(?=[?#])/', $target, 2) + [1 => ''];
            $parts = [];
            foreach (explode('/', ('.' === dirname($path) ? '' : dirname($path).'/').rawurldecode($relative)) as $part) {
                if ('' === $part || '.' === $part) {
                    continue;
                }
                if ('..' === $part) {
                    if ([] === $parts) {
                        throw new RuntimeException('Source documentation link escapes the kit: '.$path.' -> '.$target);
                    }
                    array_pop($parts);
                } else {
                    $parts[] = $part;
                }
            }
            $resolved = implode('/', $parts);
            if (isset($selected[$resolved])) {
                return $target;
            }
            if (!file_exists($root.'/'.$resolved)) {
                throw new RuntimeException('Source documentation link target is missing: '.$path.' -> '.$target);
            }

            if ($image && is_file($root.'/'.$resolved)) {
                return 'https://raw.githubusercontent.com/xormania/uxor/'.$revision.'/'.$resolved.$suffix;
            }

            return self::REPOSITORY.'/'.(is_dir($root.'/'.$resolved) ? 'tree' : 'blob').'/'.$revision.'/'.$resolved.$suffix;
        };

        // The selected upstream pages use simple inline links and reference definitions.
        $content = preg_replace_callback('/(!?)\[([^\]\n]*)\]\(([^\s)]+)\)/', static fn (array $match): string => $match[1].'['.$match[2].']('.$rewrite($match[3], '!' === $match[1]).')', $content);
        $content = preg_replace_callback('/^(\s*\[[^\]\n]+\]:\s*)(\S+)/m', static fn (array $match): string => $match[1].$rewrite($match[2]), $content);

        // A raw Markdown autolink in FOR-AGENTS.md otherwise still points at main.
        return preg_replace_callback('~https://(?:raw\.githubusercontent\.com/xormania/uxor/|github\.com/xormania/uxor/(?:blob|tree)/)(?:main|master|dev)/[^\s<>\)]+~', static fn (array $match): string => $rewrite($match[0]), $content);
    }

    private static function plain(string $text): string
    {
        return trim(str_replace(['`', '✦'], '', preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $text)));
    }

    /** @param list<string> $arguments */
    private function git(string $source, array $arguments, bool $trim = true): string
    {
        $process = proc_open(['git', '-C', $source, ...$arguments], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) {
            throw new RuntimeException('Cannot start Git.');
        }
        $output = stream_get_contents($pipes[1]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (0 !== proc_close($process)) {
            throw new RuntimeException('Git failed: '.trim($error));
        }

        return $trim ? trim($output) : $output;
    }
}
