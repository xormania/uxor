<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Records only setup's writes that need to be disconnected when Composer removes the package. */
final class SetupOwnership
{
    private const RECEIPT = '.uxor/setup-ownership.json';
    private const INHERIT = 'extends = "'.SymfonyPreparation::CONFIG.'"';
    private const NATIVE_BROWSER = "export { test, expect } from '@playwright/test';\n";

    public function __construct(private readonly ApplicationFiles $files)
    {
    }

    /** Preserved files/bindings never acquire ownership, even when identical to what setup would generate. */
    public function record(string $root, array $proposals, array $servers): array
    {
        [$owned, $detached] = $this->readReceipt($root);
        $previous = $owned;
        foreach ($proposals as $file) {
            $path = $file['path'];
            if ('preserve' === $file['action'] || null === SetupIntegration::tryFrom($path)) {
                continue;
            }
            $content = $file['content'];
            if (in_array($path, [SetupIntegration::LocalMcp->value, SetupIntegration::Claude->value], true)) {
                $content = ApplicationFiles::encode($servers['uxor-mago']);
            } elseif (SetupIntegration::Codex->value === $path) {
                // Setup appends exactly one table. Record that table, never other client settings.
                $content = $this->codexTable($content);
                if (null === $content) {
                    throw new \RuntimeException('Cannot identify the proposed Codex server table.');
                }
            }
            $owned[$path] = hash('sha256', $content);
            unset($detached[$path]);
        }
        if ($owned !== $previous) {
            $content = $this->receiptContent($owned, $detached);
            $receipt = $this->files->proposal($root, self::RECEIPT, $content);
            if ('preserve' === $receipt['action']) {
                $receipt['action'] = 'update';
                $receipt['content'] = $content;
            }
            // The receipt is published after the writes it describes. Unreceipted partial installs
            // are treated as application-owned by detach, including after an interrupted first setup.
            $proposals[] = $receipt;
        }
        return $proposals;
    }

    /** Record the bytes preparation publishes while preserving the original setup ownership boundary. */
    public function recordPreparedConfiguration(string $root, string $content): void
    {
        $lock = ApplicationFiles::lockProject($root);
        [$owned, $detached] = $this->readReceipt($root);
        if (isset($detached[SymfonyPreparation::CONFIG])) {
            throw new \RuntimeException('Run setup to reconnect the detached Mago configuration before preparing.');
        }
        if (!isset($owned[SymfonyPreparation::CONFIG])) {
            return;
        }
        $owned[SymfonyPreparation::CONFIG] = hash('sha256', $content);
        $receipt = $this->files->proposal($root, self::RECEIPT, '');
        $receipt['action'] = 'update';
        $receipt['content'] = $this->receiptContent($owned, $detached);
        $result = $this->files->apply($root, [$receipt]);
        if (null !== $result['error']) {
            throw new \RuntimeException($result['error']);
        }
    }

    public function detach(string $root, bool $apply): array
    {
        $lock = $apply ? ApplicationFiles::lockProject($root) : null;
        [$owned, $detached] = $this->readReceipt($root);
        $proposals = [];
        $review = [];
        foreach (SetupIntegration::cases() as $integration) {
            $path = $integration->value;
            $absolute = $this->files->path($root, $path);
            if (!file_exists($absolute)) {
                continue;
            }
            if (!is_file($absolute) || !is_readable($absolute) || filesize($absolute) > 1024 * 1024) {
                throw new \InvalidArgumentException('Inspect the expected regular configuration file under 1 MiB: '.$path);
            }
            $content = file_get_contents($absolute);
            if (false === $content) {
                throw new \RuntimeException('Cannot read '.$path);
            }
            $digest = hash('sha256', $content);
            $recorded = $owned[$path] ?? null;
            $next = $content;
            if (in_array($path, [SetupIntegration::LocalMcp->value, SetupIntegration::Claude->value], true)) {
                $next = $this->detachJson($content, $recorded, $path, $review);
            } elseif (SetupIntegration::Codex->value === $path) {
                $next = $this->detachCodex($content, $recorded, $path, $review);
            } elseif (SetupIntegration::Mago->value === $path && str_contains($content, SymfonyPreparation::DIRECTORY)) {
                if ($digest === $recorded && str_contains($content, self::INHERIT."\n")) {
                    $next = str_replace(self::INHERIT."\n", '', $content);
                } else {
                    $review[$path] = 'Remove UXor from Mago’s extends chain while keeping application configuration.';
                }
            } elseif (SetupIntegration::Browser->value === $path && str_contains($content, 'xormania/uxor')) {
                if ($digest === $recorded) {
                    $next = self::NATIVE_BROWSER;
                } else {
                    $review[$path] = 'Replace the UXor recorder import and fixture with the application’s Playwright fixtures; preserve other extensions.';
                }
            } elseif (SymfonyPreparation::CONFIG === $path) {
                $native = SymfonyPreparation::configurationFiles()[SymfonyPreparation::CONFIG];
                if (null !== $recorded && ($digest === $recorded || $native === $content)) {
                    // Other Mago profiles can extend this path indirectly. Keep it loadable without the worker.
                    $next = $native;
                    $detached[$path] = hash('sha256', $next);
                } elseif (str_contains($content, 'uxor-symfony') || str_contains($content, 'worker.php')) {
                    $review[$path] = 'Remove the UXor extension-host table and references to its worker from this configuration.';
                }
            } elseif (SymfonyPreparation::WORKER === $path) {
                if ($digest === $recorded) {
                    $next = null;
                } elseif (str_contains($content, 'Xormania\\UXor') || str_contains($content, 'xormania/uxor')) {
                    $review[$path] = 'Retire this UXor worker after disconnecting its Mago extension host.';
                }
            } elseif (SetupIntegration::Guide->value === $path && $digest === $recorded) {
                $next = null;
            }
            // Recover the same receipt after an interrupted detach that wrote a neutral file
            // before publishing the final receipt. Only recognize the exact supported output.
            if (null !== $recorded && null !== $next) {
                $neutral = match ($integration) {
                    SetupIntegration::Browser => self::NATIVE_BROWSER === $next,
                    SetupIntegration::LocalMcp => $this->emptyLocalBinding($next),
                    SetupIntegration::Mago => hash('sha256', str_replace("\n\n[source]", "\n".self::INHERIT."\n\n[source]", $next)) === $recorded,
                    default => false,
                };
                if ($neutral) {
                    $detached[$path] = hash('sha256', $next);
                }
            }
            if ($next !== $content) {
                $proposals[] = ['path' => $path, 'action' => null === $next ? 'remove' : 'update',
                    'sha256' => $digest, 'content' => $next];
            }
        }
        $receipt = $this->files->path($root, self::RECEIPT);
        if ($owned) {
            $proposals[] = ['path' => self::RECEIPT, 'action' => $detached ? 'update' : 'remove',
                'sha256' => hash_file('sha256', $receipt), 'content' => $this->receiptContent([], $detached)];
        }
        $steps = [
            'Stop running UXor providers. Check application tests and scripts for direct UXor imports, recorder-specific fixtures and custom MCP bindings. Replace those with the application’s native tools.',
        ];
        foreach ($review as $path => $message) {
            $steps[] = $path.': '.$message;
        }
        $changes = [];
        $status = [] === $review ? 'completed' : 'incomplete';
        $summary = $review ? 'Application-owned integrations require manual reconciliation before removal.' : 'Detachment plan ready.';
        if ($apply && !$review) {
            // Preparation can activate the worker independently of setup; share its publication lock.
            if ($proposals && is_dir($this->files->path($root, SymfonyPreparation::DIRECTORY))) {
                $lockPath = $this->files->path($root, SymfonyPreparation::DIRECTORY.'/.prepare.lock');
                $prepareLock = fopen($lockPath, file_exists($lockPath) ? 'rb' : 'x+b');
                if (false === $prepareLock || !flock($prepareLock, LOCK_EX | LOCK_NB)) {
                    throw new \RuntimeException('Symfony preparation is running. Retry detachment after it completes.');
                }
            }
            $result = $this->files->apply($root, $proposals);
            $changes = $result['changes'];
            $status = null === $result['error'] ? 'completed' : 'failed';
            $summary = $result['error'] ?? 'Managed integrations detached.';
        }
        $steps[] = 'completed' === $status && $apply ? 'Run composer remove --dev xormania/uxor and verify the application’s development tools.'
            : 'Review the plan, reconcile any listed application-owned integration, then run uxor detach --apply before Composer removal.';
        return ['status' => $status, 'summary' => $summary, 'root' => $root, 'mode' => $apply ? 'apply' : 'plan',
            'files' => array_map(static fn (array $file): array => ['path' => $file['path'], 'action' => $file['action']], $proposals),
            'review' => array_keys($review), 'changes' => $changes, 'next_steps' => $steps];
    }

    public function hasRecordedSetup(string $root): bool
    {
        [$owned, $detached] = $this->readReceipt($root);
        return [] !== $owned || [] !== $detached;
    }

    /** A neutral file can be reconnected only if detach left these exact bytes for this project. */
    public function reconnectableFiles(string $root): array
    {
        return $this->readReceipt($root)[1];
    }

    /** Verify a present local client file without executing the project or guessing what an unknown wrapper does. */
    public function verifyClientConfiguration(string $root, SetupIntegration $integration): ?bool
    {
        try {
            $path = $this->files->path($root, $integration->value);
            if (!is_file($path) || !is_readable($path) || filesize($path) > 1024 * 1024) {
                return null;
            }
            [$owned] = $this->readReceipt($root);
            $recorded = $owned[$integration->value] ?? null;
            if (SetupIntegration::Browser === $integration) {
                $digest = hash_file('sha256', $path);
                if (hash('sha256', self::NATIVE_BROWSER) === $digest) {
                    return false;
                }
                return $recorded === $digest ? true : null;
            }
            $json = $this->files->readJson($path);
            $config = json_decode($json, flags: JSON_THROW_ON_ERROR);
            if (!$config instanceof \stdClass) {
                return null;
            }
            $map = JsonObjectMembers::span($json, 'mcpServers', strspn($json, " \t\r\n"));
            if (null === $map || ($config->mcpServers instanceof \stdClass && [] === (array) $config->mcpServers)) {
                return false;
            }
            if ($config->mcpServers instanceof \stdClass && null !== JsonObjectMembers::span($json, 'uxor-mago', $map[1])) {
                $server = $config->mcpServers->{'uxor-mago'};
                if ($server instanceof \stdClass && self::serverDigest($server) === $recorded) {
                    return true;
                }
            }
        } catch (\JsonException|\InvalidArgumentException) {
            // An ambiguous client or ownership record cannot establish readiness.
        }
        return null;
    }

    private static function serverDigest(\stdClass $server): string
    {
        return hash('sha256', ApplicationFiles::encode((array) $server));
    }

    private function emptyLocalBinding(string $source): bool
    {
        $data = json_decode($source, true, 512, JSON_THROW_ON_ERROR);
        return ['mcpServers' => []] === $data;
    }

    private function receiptContent(array $owned, array $detached): string
    {
        return ApplicationFiles::encode(['schema' => 1, 'integrations' => $owned, 'detached' => $detached]);
    }

    private function readReceipt(string $root): array
    {
        $path = $this->files->path($root, self::RECEIPT);
        if (!file_exists($path)) {
            return [[], []];
        }
        $data = $this->files->json($path);
        if (1 !== ($data['schema'] ?? null) || !is_array($data['integrations'] ?? null) || !is_array($data['detached'] ?? [])) {
            throw new \InvalidArgumentException('Unrecognized UXor setup ownership record: '.self::RECEIPT);
        }
        foreach (array_merge($data['integrations'], $data['detached'] ?? []) as $name => $digest) {
            if (!is_string($name) || null === SetupIntegration::tryFrom($name) || !is_string($digest) || !preg_match('/^[a-f0-9]{64}$/D', $digest)) {
                throw new \InvalidArgumentException('Invalid integration in '.self::RECEIPT);
            }
        }
        return [$data['integrations'], $data['detached'] ?? []];
    }

    private function detachJson(string $content, ?string $recorded, string $path, array &$review): string
    {
        $config = json_decode($content, false, 512, JSON_THROW_ON_ERROR);
        if (!$config instanceof \stdClass || (property_exists($config, 'mcpServers') && !$config->mcpServers instanceof \stdClass)) {
            throw new \InvalidArgumentException('Expected an MCP client configuration object in '.$path);
        }
        $map = JsonObjectMembers::span($content, 'mcpServers', strspn($content, " \t\r\n"));
        if (null === $map) {
            return $content;
        }
        $member = JsonObjectMembers::span($content, 'uxor-mago', $map[1]);
        $next = $content;
        foreach ($config->mcpServers as $name => $server) {
            if ('uxor-mago' === $name && null !== $member) {
                if ($server instanceof \stdClass && self::serverDigest($server) === $recorded) {
                    [$start, , $end] = $member;
                    $separator = $end + strspn($content, " \t\r\n", $end);
                    if (',' === $content[$separator]) {
                        $end = $separator + 1;
                    } else {
                        $preceding = strlen(rtrim(substr($content, 0, $start)));
                        if (',' === $content[$preceding - 1]) {
                            $start = $preceding - 1;
                        }
                    }
                    $next = substr_replace($content, '', $start, $end - $start);
                    continue;
                }
            }
            if ($server instanceof \stdClass && $this->usesLauncher($server)) {
                $review[$path] = 'Server '.$name.' still launches uxor-mago. Replace or remove that server before removing the package.';
            }
        }
        return $next;
    }

    private function usesLauncher(\stdClass $server): bool
    {
        $command = $server->command ?? '';
        if (is_string($command) && 'uxor-mago' === basename(str_replace('\\', '/', $command))) {
            return true;
        }
        foreach ((array) ($server->args ?? []) as $argument) {
            if (is_string($argument) && preg_match('~(?:^|[/\\\\\s])uxor-mago(?:$|\s)~', $argument)) {
                return true;
            }
        }
        return false;
    }

    /** Match the complete generated table, including its trailing newline, never neighboring application values. */
    private function codexTable(string $content): ?string
    {
        $pattern = '~^\[mcp_servers\.uxor-mago\]\ncommand = [^\n]*\nargs = [^\n]*\ncwd = [^\n]*\n~m';
        return 1 === preg_match_all($pattern, $content, $matches) ? $matches[0][0] : null;
    }

    private function detachCodex(string $content, ?string $recorded, string $path, array &$review): string
    {
        if (!str_contains($content, 'uxor-mago')) {
            return $content;
        }
        $table = $this->codexTable($content);
        if (null !== $table && hash('sha256', $table) === $recorded
            && !str_contains($content, '"""') && !str_contains($content, "'''")) {
            [$before, $after] = explode($table, $content, 2);
            // Only comments and whitespace may intervene before the next table. An extra key
            // belongs to the edited UXor table and must not silently become a neighboring key.
            if (preg_match('~\A(?:\h*(?:\#[^\n]*)?\n)*\h*(?:\[|\z)~', $after)
                && !str_contains($before.$after, 'uxor-mago')) {
                return $before.$after;
            }
        }
        $review[$path] = 'Review and remove or replace the customized uxor-mago server table, including its nested settings.';
        return $content;
    }
}
