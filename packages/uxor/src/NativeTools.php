<?php

declare(strict_types=1);

namespace Xormania\UXor;

use Symfony\Component\Process\Process;

/** Native metadata discovery boots project PHP and requires caller acknowledgement. */
final class NativeTools
{
    public function __construct(private readonly ProjectInspector $inspector)
    {
    }

    public function discover(string $directory, string $kind = 'maker', string $name = '', int $limit = 20, bool $trustProjectCode = false): array
    {
        $root = $this->inspector->root($directory);
        if (!in_array($kind, ['maker', 'mate'], true)) {
            throw new \InvalidArgumentException('Tool kind must be maker or mate.');
        }
        if ('' !== $name && !preg_match('/\A[A-Za-z0-9_.:-]{1,128}\z/D', $name)) {
            throw new \InvalidArgumentException('Use an exact installed tool name containing letters, numbers, _, ., :, or -.');
        }
        if ('maker' === $kind && '' !== $name && !str_starts_with($name, 'make:')) {
            throw new \InvalidArgumentException('Maker detail requires an exact make: command name.');
        }
        if (!$trustProjectCode) {
            return ['status' => 'incomplete', 'summary' => 'Native metadata discovery is blocked until the caller acknowledges execution of this project’s PHP code.',
                'root' => $root, 'kind' => $kind, 'project_code_executed' => false,
                'suggested_action' => 'For a checkout already trusted and authorized for execution, set --trust-project-code on the CLI or trustProjectCode=true in Mate. Otherwise establish trust before running project code.'];
        }
        $script = 'mate' === $kind ? 'vendor/bin/mate' : 'bin/console';
        if (!is_file($root.'/'.$script)) {
            return ['status' => 'incomplete', 'summary' => 'The selected native tool entry point is missing.',
                'root' => $root, 'kind' => $kind, 'entry_point' => $script,
                'suggested_action' => 'Install/configure the native tool in this application and invoke UXor in the same PHP environment.'];
        }
        $arguments = 'mate' === $kind
            ? ('' === $name ? ['tools:list', '--format=json'] : ['tools:inspect', $name, '--format=json'])
            : ('' === $name ? ['list', 'make', '--format=json', '--no-interaction'] : ['help', $name, '--format=json', '--no-interaction']);
        $argv = [PHP_BINARY, $root.'/'.$script, ...$arguments];
        $process = new Process($argv, $root, timeout: 30);
        $process->disableOutput();
        $stdout = '';
        $overflow = false;
        $process->run(static function (string $type, string $data) use (&$stdout, &$overflow): void {
            if (Process::OUT !== $type) {
                return;
            }
            $remaining = 1024 * 1024 - strlen($stdout);
            if (strlen($data) > $remaining) {
                $overflow = true;
            }
            $stdout .= substr($data, 0, max(0, $remaining));
        });
        // Native command output may contain project data; avoid relaying raw failures or environment secrets.
        $evidence = ['argv' => $argv, 'exit_code' => $process->getExitCode(), 'output_truncated' => $overflow,
            'trust_project_code' => true, 'project_code_executed' => true];
        if (!$process->isSuccessful() || $overflow) {
            return ['status' => 'incomplete', 'summary' => 'Native metadata discovery failed or exceeded its output bound.',
                'kind' => $kind, 'evidence' => $evidence,
                'suggested_action' => 'Run the recorded native metadata command in the project environment and diagnose it there.'];
        }
        try {
            $decoded = json_decode($stdout, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return ['status' => 'incomplete', 'summary' => 'Native metadata was not valid JSON.', 'kind' => $kind, 'evidence' => $evidence];
        }
        if (!is_array($decoded)) {
            throw new \RuntimeException('Native metadata must be a JSON object.');
        }
        if ('' !== $name) {
            return ['status' => 'completed', 'kind' => $kind, 'name' => $name, 'definition' => $decoded, 'evidence' => $evidence];
        }
        $items = [];
        foreach (($decoded['tools'] ?? $decoded['commands'] ?? []) as $key => $tool) {
            if (!is_array($tool)) {
                continue;
            }
            $toolName = $tool['name'] ?? (is_string($key) ? $key : '');
            if ('maker' === $kind && !str_starts_with($toolName, 'make:')) {
                continue;
            }
            $items[] = ['name' => $toolName, 'description' => substr((string) ($tool['description'] ?? ''), 0, 500),
                'extension' => $tool['extension'] ?? null];
        }
        $limit = max(1, min(50, $limit));
        return ['status' => 'completed', 'kind' => $kind, 'items' => array_slice($items, 0, $limit),
            'total' => count($items), 'truncated' => count($items) > $limit, 'evidence' => $evidence,
            'suggested_action' => 'Request detail with the exact name to inspect native named arguments/options before execution.'];
    }
}
