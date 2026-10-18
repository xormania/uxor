<?php

declare(strict_types=1);

namespace Xormania\UXor\Tools;

use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;

/**
 * Maintainer-only export of UXor's catalog, manifests and documentation into the package's bundled references.
 *
 * It reads the canonical inputs from a working tree (by default the repository holding this file), never from Git:
 * the output depends on their bytes only, not on the commit that holds them, so it can be generated before the commit
 * that contains it. The index records the inputs' digest (`source.inputs_sha256`) and the ref its repository links
 * use (`source.ref`), never a commit of the repository holding the bundle.
 */
final class ReferenceGenerator
{
    public const REPOSITORY = 'https://github.com/xormania/uxor';
    public const DEFAULT_REF = 'main';
    public const SCHEMA_VERSION = 2;

    /** The documents copied as they are, besides each recipe's README.md. */
    public const GUIDES = [
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

    /** The repository whose working tree holds this file: packages/uxor/tools/ is two levels below its root. */
    public static function repositoryRoot(): string
    {
        return dirname(__DIR__, 3);
    }

    /** The digest of the inputs: SHA-256 of `sha256sum`'s lines (`<sha256>  <path>\n`) for the sorted input paths. */
    public static function inputsDigest(array $inputs): string
    {
        ksort($inputs, SORT_STRING);
        $lines = '';
        foreach ($inputs as $path => $sha256) {
            $lines .= $sha256.'  '.$path."\n";
        }

        return hash('sha256', $lines);
    }

    /** @return array<string, string> Paths relative to the generated bundle directory, sorted, with their bytes. */
    public function build(string $source, string $ref = self::DEFAULT_REF): array
    {
        if (!preg_match('~^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9._-]+)*$~D', $ref) || str_contains($ref, '..') || strlen($ref) > 100) {
            throw new RuntimeException('Use a branch or tag name of this repository as --ref (default '.self::DEFAULT_REF.').');
        }
        $root = realpath($source);
        if (false === $root || !is_dir($root)) {
            throw new RuntimeException('The source directory does not exist: '.$source);
        }

        /** @var array<string, string> $inputs path => SHA-256 of the bytes read */
        $inputs = [];
        $read = static function (string $path) use ($root, &$inputs): string {
            $absolute = realpath($root.'/'.$path);
            if (false === $absolute || !is_file($absolute) || is_link($root.'/'.$path) || $absolute !== $root.'/'.$path) {
                throw new RuntimeException('Reference input is not a regular file of the source: '.$path);
            }
            $content = file_get_contents($absolute);
            if (false === $content) {
                throw new RuntimeException('Cannot read source file: '.$path);
            }
            $inputs[$path] = hash('sha256', $content);

            return $content;
        };

        $kitSource = $read('manifest.json');
        $kit = json_decode($kitSource, true, 512, JSON_THROW_ON_ERROR);
        if (self::REPOSITORY !== ($kit['homepage'] ?? null)) {
            throw new RuntimeException('The source manifest must identify '.self::REPOSITORY.'.');
        }

        // Match the catalog UXor already maintains, as tools/llms-txt.mjs does.
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
        sort($names, SORT_STRING);
        $listed = array_keys($catalog);
        sort($listed, SORT_STRING);
        if ([] === $names || $names !== $listed) {
            throw new RuntimeException('UXor catalog and recipe manifest directories do not match.');
        }

        $paths = self::GUIDES;
        foreach ($names as $name) {
            $paths[] = $name.'/README.md';
        }
        sort($paths, SORT_STRING);
        $selected = array_fill_keys($paths, true);
        $files = [];
        $documents = [];
        foreach ($paths as $path) {
            $original = $read($path);
            $content = str_ends_with($path, '.md') ? $this->rewriteLinks($original, $path, $root, $ref, $selected) : $original;
            $files['docs/'.$path] = $content;
            $documents[$path] = [
                'path' => 'docs/'.$path,
                'sha256' => hash('sha256', $content),
                'source_sha256' => hash('sha256', $original),
                'source_url' => self::REPOSITORY.'/blob/'.$ref.'/'.$path,
            ];
        }

        $components = [];
        foreach ($names as $name) {
            $manifestSource = $read($name.'/manifest.json');
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
                'source_url' => self::REPOSITORY.'/tree/'.$ref.'/'.$name,
            ];
        }

        $index = [
            'schema_version' => self::SCHEMA_VERSION,
            'source' => [
                'repository' => self::REPOSITORY,
                'ref' => $ref,
                'inputs_sha256' => self::inputsDigest($inputs),
                'manifest_sha256' => $inputs['manifest.json'],
                'license' => $kit['license'],
            ],
            'kit' => $kit,
            'components' => $components,
            'documents' => $documents,
        ];
        $files['index.json'] = json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
        ksort($files, SORT_STRING);

        return $files;
    }

    /**
     * Writes the files into a directory, then removes the files the build no longer makes and any directory left empty.
     *
     * @param array<string, string> $files
     */
    public function write(array $files, string $directory): void
    {
        if (is_link($directory)) {
            throw new RuntimeException('The generated bundle directory must not be a symbolic link.');
        }
        $existing = self::listFiles($directory);
        foreach ($files as $path => $content) {
            $parent = dirname($directory.'/'.$path);
            if (!is_dir($parent) && !mkdir($parent, 0777, true) && !is_dir($parent)) {
                throw new RuntimeException('Cannot create '.$parent);
            }
            if (false === file_put_contents($directory.'/'.$path, $content)) {
                throw new RuntimeException('Cannot write generated reference: '.$path);
            }
        }
        foreach (array_diff(array_keys($existing), array_keys($files)) as $path) {
            if (!unlink($directory.'/'.$path)) {
                throw new RuntimeException('Cannot remove obsolete generated reference: '.$path);
            }
        }
        if (is_dir($directory)) {
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
            foreach ($iterator as $entry) {
                if ($entry->isDir() && !$entry->isLink() && [] === array_diff(scandir($entry->getPathname()) ?: ['?'], ['.', '..'])) {
                    rmdir($entry->getPathname());
                }
            }
        }
    }

    /**
     * The files that differ between two bundle directories, byte for byte, sorted: each with `changed`, `missing` (in
     * $actual) or `unexpected` (only in $actual).
     *
     * @return array<string, string>
     */
    public static function compare(string $expected, string $actual): array
    {
        $want = self::listFiles($expected);
        $have = self::listFiles($actual);
        $stale = [];
        foreach ($want as $path => $file) {
            if (!isset($have[$path])) {
                $stale[$path] = 'missing';
            } elseif (file_get_contents($file) !== file_get_contents($have[$path])) {
                $stale[$path] = 'changed';
            }
        }
        foreach (array_diff_key($have, $want) as $path => $file) {
            $stale[$path] = 'unexpected';
        }
        ksort($stale, SORT_STRING);

        return $stale;
    }

    /** @return array<string, string> relative path => absolute path of every regular file under the directory */
    private static function listFiles(string $directory): array
    {
        if (is_link($directory)) {
            throw new RuntimeException('The generated bundle directory must not be a symbolic link: '.$directory);
        }
        $files = [];
        if (!is_dir($directory)) {
            return $files;
        }
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isLink()) {
                throw new RuntimeException('The generated bundle must not contain symbolic links: '.$file->getPathname());
            }
            if ($file->isFile()) {
                $files[substr($file->getPathname(), strlen($directory) + 1)] = $file->getPathname();
            }
        }
        ksort($files, SORT_STRING);

        return $files;
    }

    /**
     * Links to another copied document stay relative, so they resolve inside the bundle. A relative link to any other
     * file of the repository, and a link to this repository on a moving branch (main, master, dev), point at $ref.
     *
     * @param array<string, bool> $selected
     */
    private function rewriteLinks(string $content, string $path, string $root, string $ref, array $selected): string
    {
        $rewrite = function (string $target, bool $image = false) use ($path, $root, $ref, $selected): string {
            $target = preg_replace('~^(https://(?:raw\.githubusercontent\.com/xormania/uxor/|github\.com/xormania/uxor/(?:blob|tree)/))(?:main|master|dev)/~', '${1}'.$ref.'/', $target);
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
                return 'https://raw.githubusercontent.com/xormania/uxor/'.$ref.'/'.$resolved.$suffix;
            }

            return self::REPOSITORY.'/'.(is_dir($root.'/'.$resolved) ? 'tree' : 'blob').'/'.$ref.'/'.$resolved.$suffix;
        };

        // The copied pages use simple inline links and reference definitions.
        $content = preg_replace_callback('/(!?)\[([^\]\n]*)\]\(([^\s)]+)\)/', static fn (array $match): string => $match[1].'['.$match[2].']('.$rewrite($match[3], '!' === $match[1]).')', $content);
        $content = preg_replace_callback('/^(\s*\[[^\]\n]+\]:\s*)(\S+)/m', static fn (array $match): string => $match[1].$rewrite($match[2]), $content);

        // A raw Markdown autolink (FOR-AGENTS.md's) on a moving branch.
        return preg_replace_callback('~https://(?:raw\.githubusercontent\.com/xormania/uxor/|github\.com/xormania/uxor/(?:blob|tree)/)(?:main|master|dev)/[^\s<>\)]+~', static fn (array $match): string => $rewrite($match[0]), $content);
    }

    private static function plain(string $text): string
    {
        return trim(str_replace(['`', '✦'], '', preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $text)));
    }
}
