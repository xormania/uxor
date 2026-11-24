<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Reads project-local evidence recorded by the browser launcher or Playwright fixture. */
final class BrowserDiagnostics
{
    private const FILENAME = 'browser-diagnostics.json';
    private const MAX_BYTES = 1024 * 1024;
    private const REQUEST_FIELDS = ['requestId' => 'request ID', 'method' => 'string', 'url' => 'string', 'turboFrame' => 'nullable string'];

    public function __construct(private readonly ProjectInspector $inspector)
    {
    }

    public function read(string $directory, string $path): array
    {
        $root = $this->inspector->root($directory);
        $file = $this->artifact($root, $path);
        $json = file_get_contents($file, false, null, 0, self::MAX_BYTES + 1);
        if (false === $json || strlen($json) > self::MAX_BYTES) {
            throw new \RuntimeException('The browser diagnostics artifact is unreadable or exceeds 1 MiB.');
        }
        try {
            $document = json_decode($json, depth: 8, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \InvalidArgumentException('The browser diagnostics artifact is not valid JSON.', 0, $e);
        }
        if (!$document instanceof \stdClass || 1 !== ($document->version ?? null)) {
            throw new \InvalidArgumentException('The browser diagnostics artifact must use version 1.');
        }

        $responses = $this->rows($document, 'responses', self::REQUEST_FIELDS + ['token' => 'token', 'status' => 'status']);
        foreach ($responses as &$response) {
            $response['profileUri'] = 'symfony-profiler://profile/'.$response['token'];
        }
        unset($response);
        $requestFailures = $this->rows($document, 'requestFailures', self::REQUEST_FIELDS + ['error' => 'string']);
        $pageErrors = $this->rows($document, 'pageErrors', ['name' => 'string', 'message' => 'string', 'stack' => 'nullable string']);

        $result = [
            'summary' => sprintf('Read %d profiled responses, %d failed requests, and %d page errors.', count($responses), count($requestFailures), count($pageErrors)),
            'artifact' => $path,
            'version' => 1,
            'responses' => $responses,
            'requestFailures' => $requestFailures,
            'pageErrors' => $pageErrors,
        ];

        if (property_exists($document, 'dropped')) {
            $result['dropped'] = $this->droppedCounts($document->dropped);
        }

        if (property_exists($document, 'visit')) {
            $visit = $this->entry($document->visit, 'visit', ['url' => 'string', 'status' => 'nullable status', 'error' => 'nullable string']);
            $result['visit'] = $visit;
            if (null !== $visit['status']) {
                $result['summary'] .= sprintf(' The visit returned HTTP %d.', $visit['status']);
            }
            if (null !== $visit['error']) {
                $result['summary'] .= ' The browser reported a visit error.';
            }
        }

        return $result;
    }

    private function droppedCounts(mixed $dropped): array
    {
        if (!$dropped instanceof \stdClass) {
            throw new \InvalidArgumentException('The browser diagnostics dropped counts must be an object.');
        }
        $counts = [];
        foreach (['responses', 'requestFailures', 'pageErrors'] as $section) {
            $count = $dropped->$section ?? null;
            if (!is_int($count) || $count < 0) {
                throw new \InvalidArgumentException(sprintf('Invalid browser diagnostics dropped count for %s.', $section));
            }
            $counts[$section] = $count;
        }

        return $counts;
    }

    private function artifact(string $root, string $path): string
    {
        if (str_starts_with($path, '/') || strpbrk($path, "\\:\0") !== false
            || in_array('..', explode('/', $path), true) || self::FILENAME !== basename($path)) {
            throw new \InvalidArgumentException('Select a project-relative browser-diagnostics.json artifact path.');
        }
        $candidate = $root.'/'.$path;
        $file = realpath($candidate);
        if (false === $file || !str_starts_with($file, rtrim($root, '/\\').DIRECTORY_SEPARATOR)
            || is_link($candidate) || !is_file($file) || !is_readable($file)) {
            throw new \InvalidArgumentException('The browser diagnostics artifact must be a readable file in the selected project.');
        }

        return $file;
    }

    private function rows(\stdClass $document, string $section, array $fields): array
    {
        $entries = $document->$section ?? null;
        if (!is_array($entries)) {
            throw new \InvalidArgumentException(sprintf('The browser diagnostics artifact requires a %s list.', $section));
        }
        $rows = [];
        foreach ($entries as $index => $entry) {
            $rows[] = $this->entry($entry, sprintf('%s entry %d', $section, $index), $fields);
        }

        return $rows;
    }

    private function entry(mixed $entry, string $label, array $fields): array
    {
        if (!$entry instanceof \stdClass) {
            throw new \InvalidArgumentException(sprintf('Invalid browser diagnostics %s.', $label));
        }
        $row = [];
        foreach ($fields as $key => $type) {
            if (!property_exists($entry, $key) || !$this->isValid($entry->$key, $type)) {
                throw new \InvalidArgumentException(sprintf('Invalid browser diagnostics %s field %s.', $label, $key));
            }
            $row[$key] = $entry->$key;
        }

        return $row;
    }

    private function isValid(mixed $value, string $type): bool
    {
        return match ($type) {
            'string' => is_string($value),
            'nullable string' => null === $value || is_string($value),
            'request ID' => is_int($value) && $value >= 0,
            'status' => is_int($value) && $value >= 100 && $value <= 599,
            'nullable status' => null === $value || $this->isValid($value, 'status'),
            'token' => is_string($value) && 1 === preg_match('/\A[A-Za-z0-9_-]{1,128}\z/', $value),
        };
    }
}
