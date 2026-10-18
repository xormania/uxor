<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Reads only the versioned files declared by the shipped reference index. */
final class ReferenceBundle
{
    private ?array $index = null;

    public function __construct(
        private readonly string $directory = __DIR__.'/../resources/uxor',
        private readonly string $workflowDirectory = __DIR__.'/../resources/workflows',
    ) {
    }

    public function metadata(): array
    {
        return $this->index()['source'];
    }

    public function catalog(string $query = '', string $category = '', int $limit = 10, int $offset = 0): array
    {
        $limit = max(1, min(50, $limit));
        $offset = max(0, $offset);
        $items = [];
        foreach ($this->index()['components'] as $name => $component) {
            $summary = (string) ($component['summary'] ?? '');
            $kind = (string) ($component['category'] ?? '');
            if (('' !== $query && !str_contains(strtolower($name.' '.$summary.' '.$kind), strtolower($query)))
                || ('' !== $category && $kind !== $category)) {
                continue;
            }
            $items[] = ['name' => $name, 'summary' => $summary, 'category' => $kind,
                'documentation' => 'uxor://reference/'.$component['documentation']];
        }
        return ['items' => array_slice($items, $offset, $limit), 'total' => count($items),
            'offset' => $offset, 'limit' => $limit, 'truncated' => count($items) > $offset + $limit,
            'next_offset' => count($items) > $offset + $limit ? $offset + $limit : null];
    }

    public function component(string $name): array
    {
        $component = $this->index()['components'][$name] ?? null;
        if (!is_array($component)) {
            throw new \InvalidArgumentException(sprintf('Unknown UXor component "%s". Search the catalog first.', $name));
        }
        return ['name' => $name] + $component + ['reference_uri' => 'uxor://reference/'.$component['documentation']];
    }

    public function document(string $path, int $offset = 0, int $limit = 12000): array
    {
        $document = $this->index()['documents'][$path] ?? null;
        if (!is_array($document)) {
            throw new \InvalidArgumentException('Unknown reference path. Use a document key from the catalog or component detail.');
        }
        return ['path' => $path, 'source_url' => $document['source_url']]
            + $this->readDocument($this->directory, $document['path'], $offset, $limit, $document['sha256']);
    }

    public function workflow(string $name, int $offset = 0, int $limit = 12000): array
    {
        $path = match ($name) {
            'customer-management' => 'customer-management.md',
            default => throw new \InvalidArgumentException('Unknown workflow. Available workflow: customer-management.'),
        };
        return ['name' => $name, 'source' => ['type' => 'uxor-authored', 'package' => 'xormania/uxor',
            'path' => 'packages/uxor/resources/workflows/'.$path]] + $this->readDocument($this->workflowDirectory, $path, $offset, $limit);
    }

    private function readDocument(string $directory, string $relativePath, int $offset, int $limit, ?string $expectedHash = null): array
    {
        $root = realpath($directory);
        $file = realpath($directory.'/'.$relativePath);
        if (false === $root || false === $file || !str_starts_with($file, $root.DIRECTORY_SEPARATOR) || !is_file($file)) {
            throw new \RuntimeException('The packaged document is absent or outside its bundle.');
        }
        $content = file_get_contents($file);
        if (false === $content || (null !== $expectedHash && !hash_equals($expectedHash, hash('sha256', $content)))) {
            throw new \RuntimeException('The packaged reference does not match its index checksum.');
        }
        if (1 !== preg_match('//u', $content)) {
            throw new \RuntimeException('The packaged document is not valid UTF-8.');
        }
        $offset = max(0, $offset);
        $limit = max(1, min(24000, $limit));
        // Byte offsets keep pagination reproducible without mbstring; never split a UTF-8 code point.
        while ($offset < strlen($content) && (ord($content[$offset]) & 0xC0) === 0x80) {
            ++$offset;
        }
        $chunk = substr($content, $offset, $limit);
        while ('' !== $chunk && 1 !== preg_match('//u', $chunk)) {
            $chunk = substr($chunk, 0, -1);
        }
        if ('' === $chunk && $offset < strlen($content)) {
            // A requested one-byte page must still advance over one complete character.
            for ($size = 1; $size <= 4; ++$size) {
                $chunk = substr($content, $offset, $size);
                if (1 === preg_match('//u', $chunk)) {
                    break;
                }
            }
        }
        $next = $offset + strlen($chunk);
        return ['content' => $chunk, 'sha256' => hash('sha256', $content),
            'offset' => $offset, 'limit' => $limit, 'total_bytes' => strlen($content),
            'truncated' => strlen($content) > $next,
            'next_offset' => strlen($content) > $next ? $next : null];
    }

    private function index(): array
    {
        if (null !== $this->index) {
            return $this->index;
        }
        $path = $this->directory.'/index.json';
        if (!is_file($path) || !is_readable($path)) {
            throw new \RuntimeException('The UXor reference bundle is unavailable. Reinstall xormania/uxor.');
        }
        try {
            $index = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \RuntimeException('The UXor reference index is invalid.', 0, $e);
        }
        if (!is_array($index) || 1 !== ($index['schema_version'] ?? null) || !is_array($index['source'] ?? null)
            || !is_array($index['components'] ?? null) || !is_array($index['documents'] ?? null)) {
            throw new \RuntimeException('Unsupported UXor reference index schema.');
        }
        return $this->index = $index;
    }
}
