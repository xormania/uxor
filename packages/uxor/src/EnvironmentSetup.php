<?php

declare(strict_types=1);

namespace Xormania\UXor;

use Composer\Package\Locker;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;

/** Configures a consumer through its existing Composer and Symfony tooling. */
final class EnvironmentSetup
{
    public const PROFILER_CONFIG = 'config/packages/dev/uxor.php';

    private readonly ApplicationFiles $files;
    private readonly SetupOwnership $ownership;

    public function __construct(
        private readonly ProjectInspector $inspector,
        private readonly SymfonyPreparation $preparation,
    ) {
        $this->files = new ApplicationFiles($inspector);
        $this->ownership = new SetupOwnership($this->files);
    }

    public function setup(string $directory, bool $apply = false, bool $install = false, bool $trustProjectCode = false, string $client = 'none', string $hostProjectRoot = '', bool $saveProjectTrust = false): array
    {
        if (!in_array($client, ['none', 'claude', 'codex'], true)) {
            throw new \InvalidArgumentException('Choose client none, claude, or codex.');
        }
        // Keep overlapping setup and detach applications from interleaving their ownership records.
        $lock = $apply ? ApplicationFiles::lockProject($this->inspector->root($directory)) : null;
        $project = $this->files->project($directory);
        $root = $project['root'];
        if ($install && (!$apply || !$trustProjectCode)) {
            return ['status' => 'incomplete', 'summary' => 'Installing development dependencies requires --apply and --trust-project-code.',
                'root' => $root, 'changes' => [], 'next_steps' => ['Authorize Composer scripts and application PHP for this setup operation in the selected runtime. --save-project-trust does not authorize installation.']];
        }
        // Preflight the complete file plan before Composer or any application write.
        $plan = $this->plan($project, $client, $hostProjectRoot, $saveProjectTrust);
        if (!$apply) {
            return $this->result($project, $plan, 'plan', [], []);
        }
        $changes = [];
        $executions = [];
        if ($install) {
            $this->files->path($root, 'mate/.env');
            $nativePaths = ['composer.json', 'composer.lock', 'mate/config.php', 'mate/extensions.php',
                'mate/.gitignore', 'mate/AGENT_INSTRUCTIONS.md', 'mate/src/.gitignore', 'AGENTS.md', 'CLAUDE.md'];
            $before = $this->hashes($root, $nativePaths);
            $composer = (new ExecutableFinder())->find('composer');
            if (null === $composer) {
                return ['status' => 'incomplete', 'summary' => 'Composer is not available in this PHP environment.',
                    'root' => $root, 'changes' => [], 'next_steps' => ['Run setup in the application environment where Composer and its PHP extensions are installed.']];
            }
            $mate = $root.'/'.$project['bin'].'/mate';
            $missing = [];
            foreach (DevelopmentDependencies::missingRequests($this->dependencies($project)) as $dependency) {
                $missing[] = $dependency['package'].('' === $dependency['constraint'] ? '' : ':'.$dependency['constraint']);
            }
            // Mate is a dependency of UXor. Its first initialization changes the root manifest; resolve once afterwards.
            $require = [] === $missing ? [] : [[$composer, 'require', '--dev', '--no-interaction', '--no-progress', '--with-all-dependencies', ...$missing]];
            $init = is_file($root.'/mate/config.php') ? [] : [[PHP_BINARY, $mate, 'init', '--no-interaction']];
            // An incomplete vendor installation can recover the missing Mate binary during Composer require.
            $commands = is_file($mate) ? [...$init, ...$require] : [...$require, ...$init];
            foreach ($commands as $argv) {
                if ($argv[0] !== $composer && !is_file($mate)) {
                    break;
                }
                $execution = $this->execute($argv, $root, $argv[0] === $composer ? 300 : 120);
                $executions[] = $execution;
                if (0 !== $execution['exit_code']) {
                    return ['status' => $argv[0] === $composer ? 'failed' : 'incomplete',
                        'summary' => $argv[0] === $composer ? 'Composer could not resolve or install the requested development dependencies.' : 'The application’s Mate initialization needs attention.',
                        'root' => $root, 'changes' => $this->changed($root, $before), 'executions' => $executions,
                        'next_steps' => ['Run the recorded failed command in the application environment, then repeat setup.']];
                }
            }
            if (is_file($root.'/mate/config.php') && $this->onlyMateMetadataIsUnlocked($root)) {
                $execution = $this->execute([$composer, 'update', '--lock', '--no-install', '--no-scripts', '--no-interaction', '--no-progress'], $root, 300);
                $executions[] = $execution;
                if (0 !== $execution['exit_code']) {
                    return ['status' => 'incomplete', 'summary' => 'Composer could not refresh the lock after Mate initialization.',
                        'root' => $root, 'changes' => $this->changed($root, $before), 'executions' => $executions,
                        'next_steps' => ['Repeat trusted setup to retry the recorded Composer command in the application environment.']];
                }
            }
            $changes = $this->changed($root, $before);
            $project = $this->files->project($root);
            // Flex may have created configuration; inspect the actual post-install state.
            $plan = $this->plan($project, $client, $hostProjectRoot, $saveProjectTrust);
        }
        $application = $this->files->apply($root, $plan['files']);
        $changes = [...$changes, ...$application['changes']];
        if (null !== $application['error']) {
            return ['status' => 'failed', 'summary' => 'Setup could not finish writing configuration. Review the reported changes and filesystem permissions before retrying.',
                'root' => $root, 'changes' => $changes, 'executions' => $executions,
                'next_steps' => ['Run setup again to inspect the current state. Successfully created files are preserved.']];
        }
        if ($install) {
            $mate = $root.'/'.$project['bin'].'/mate';
            if (!is_file($mate)) {
                return ['status' => 'incomplete', 'summary' => 'Project configuration was written, but the installed Mate entry point is missing.',
                    'root' => $root, 'changes' => $changes, 'executions' => $executions, 'next_steps' => ['Install the application’s declared Mate development dependencies and run setup again.']];
            }
            $commands = [[$composer, 'dump-autoload', '--no-interaction'], [PHP_BINARY, $mate, 'discover', '--no-interaction']];
            foreach ($commands as $argv) {
                $execution = $this->execute($argv, $root, 120);
                $executions[] = $execution;
                if (0 !== $execution['exit_code']) {
                    return ['status' => 'incomplete', 'summary' => 'Development configuration was written; native Mate setup needs attention.',
                        'root' => $root, 'changes' => [...$application['changes'], ...$this->changed($root, $before)], 'executions' => $executions,
                        'next_steps' => ['Run the recorded failed command in the application environment, then repeat setup. Application-authored configuration is preserved.']];
                }
            }
            $changes = [...$application['changes'], ...$this->changed($root, $before)];
            $project = $this->files->project($root);
        }
        return $this->result($project, $plan, 'apply', $changes, $executions);
    }

    /** Removing only Mate's registration must reproduce the locked resolution inputs, including on retry. */
    private function onlyMateMetadataIsUnlocked(string $root): bool
    {
        $manifest = $this->files->json($this->files->path($root, 'composer.json'));
        $lock = $this->files->path($root, 'composer.lock');
        if (!isset($manifest['extra']['ai-mate']) || !is_file($lock)) {
            return false;
        }
        $lockedHash = $this->files->json($lock)['content-hash'] ?? null;
        if (null === $lockedHash || $lockedHash === Locker::getContentHash(ApplicationFiles::encode($manifest))) {
            return false;
        }
        unset($manifest['extra']['ai-mate']);
        if ($lockedHash === Locker::getContentHash(ApplicationFiles::encode($manifest))) {
            return true;
        }
        // Init may have created the whole extra object in an application with no other metadata.
        if ([] === $manifest['extra']) {
            unset($manifest['extra']);
            return $lockedHash === Locker::getContentHash(ApplicationFiles::encode($manifest));
        }
        return false;
    }

    public function detach(string $directory, bool $apply = false): array
    {
        return $this->ownership->detach($this->inspector->root($directory), $apply);
    }

    public function dependencies(array $project): array
    {
        return DevelopmentDependencies::evaluate($project);
    }

    private function plan(array $project, string $client, string $hostProjectRoot, bool $saveProjectTrust): array
    {
        $root = $project['root'];
        $paths = array_values(array_filter(['src', 'tests', 'templates'], static fn (string $path): bool => is_dir($root.'/'.$path)));
        if ([] === $paths) {
            $paths = ['src'];
        }
        $quotedPaths = implode(', ', array_map(static fn (string $path): string => json_encode($path, JSON_THROW_ON_ERROR), $paths));
        $vendor = json_encode($project['vendor'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $phpTarget = (string) ($project['composer']['config']['platform']['php'] ?? PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION);
        if (!preg_match('/^(\\d+\\.\\d+)(?:\\.\\d+)?$/', $phpTarget, $match)) {
            throw new \InvalidArgumentException('Composer config.platform.php must be a concrete PHP version for generated Mago configuration.');
        }
        $phpTarget = $match[1];
        $bindingRoot = '' === $hostProjectRoot ? $root : $this->hostRoot($hostProjectRoot);
        // This describes the requested binding, not the contents of preserved client files.
        $binding = ['root' => $bindingRoot, 'source' => '' === $hostProjectRoot ? 'current_runtime' : 'explicit_host',
            'verified' => false, 'requested_saved_project_trust' => $saveProjectTrust];
        $mago = 'version = "'.SymfonyPreparation::REQUIREMENTS['carthage-software/mago'].'"'."\n".'php-version = "'.$phpTarget."\"\n"
            .'extends = ".uxor/mago/config.toml"'."\n\n[source]\npaths = [".$quotedPaths."]\nincludes = [".$vendor."]\n";
        $serverArgs = ['--project-root', $bindingRoot];
        if ($saveProjectTrust) {
            $serverArgs[] = '--trust-project-code';
        }
        $serverArgs[] = 'serena';
        $servers = [
            'uxor-mago' => ['command' => $bindingRoot.'/'.$project['bin'].'/uxor-mago', 'args' => $serverArgs],
        ];
        $browserImport = '../'.$project['vendor'].'/xormania/uxor/packages/uxor/resources/browser/diagnostics.mjs';
        $browser = "import { test as base, expect } from '@playwright/test';\n"
            .'import { recordBrowserDiagnostics } from '.json_encode($browserImport, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR).";\n\n"
            ."export const test = base.extend({ browserDiagnostics: [recordBrowserDiagnostics, { auto: true }] });\nexport { expect };\n";
        $templates = [
            SetupIntegration::Mago->value => $mago,
            SetupIntegration::Browser->value => $browser,
            SetupIntegration::LocalMcp->value => ApplicationFiles::encode(['mcpServers' => $servers]),
            '.uxor/.gitignore' => "/mcp.json\n",
            SetupIntegration::Guide->value => "# Application development tools\n\n"
                ."This configuration belongs to this application. Repeated UXor setup preserves existing files.\n\n"
                ."Setup’s --trust-project-code authorizes native commands for the current setup operation; it does not save permission in MCP bindings. The separate --save-project-trust option adds --trust-project-code to new Serena bindings when the plan is applied. Saving it authorizes application code on every future connection, including code checked out later at the same path. It has no commit restriction or expiry. Removing the saved flag affects subsequent launches; also stop any already running Serena provider when revoking permission. --write separately allows editing and is not generated by setup.\n\n"
                ."Without --trust-project-code before serena, the provider refuses to connect. Review the application and its Mago configuration before authorizing that launch or choosing to save permission for future connections. Existing bindings are preserved and may retain permission from earlier setup. --save-project-trust does not update them; reconcile those bindings manually, removing --trust-project-code if recurring execution is no longer intended.\n\n"
                ."- Run ".$project['bin']."/uxor environment --format=json for current setup and next steps.\n"
                ."- Run ".$project['bin']."/uxor prepare --trust-project-code after source, dependency or service changes to refresh Symfony wiring.\n"
                ."- Prepare external Mago providers on the Docker host with ".$project['bin']."/uxor-mago pull.\n"
                ."- Connect Serena using the local MCP definition in mcp.json. Paths are machine-local to the MCP host; container users supply --host-project-root during setup.\n"
                ."- Mate Beta1 uses the application CLI: ".$project['bin']."/mate tools:list --format=json; inspect exact inputs before tools:call.\n"
                ."- Import test and expect from .uxor/browser.mjs in the application's Playwright tests; configure its baseURL and output directory, and set PROFILER_COLLECT=1 for a diagnostic run.\n"
                ."- Inspect the exact request profile URI in browser-diagnostics.json. Preserve failure evidence before changing caches.\n"
                ."- Keep the application's production runtime independent of development dependencies.\n",
        ];
        foreach ($this->preparation->configurationFiles($project['vendor']) as $path => $content) {
            $templates[$path] = $content;
        }
        if (isset($project['composer']['require']['symfony/framework-bundle']) || null !== $project['installedPackages']->match('symfony/framework-bundle')) {
            $profiler = file_get_contents(__DIR__.'/../resources/symfony/profiler.php');
            if (false === $profiler) {
                throw new \RuntimeException('The packaged development profiler configuration is missing.');
            }
            $templates[self::PROFILER_CONFIG] = $profiler;
        }
        $files = [];
        $notes = [];
        $detached = $this->ownership->reconnectableFiles($root);
        foreach ($templates as $path => $content) {
            $proposal = $this->files->proposal($root, $path, $content);
            if ('preserve' === $proposal['action'] && isset($detached[$path])) {
                if ($proposal['sha256'] === $detached[$path]) {
                    $proposal['action'] = 'update';
                    $proposal['content'] = $content;
                } else {
                    $notes[] = 'Detached application configuration changed: '.$path.'. Reconcile the project file with the proposed integration before using it.';
                }
            }
            $files[] = $proposal;
            if (SetupIntegration::LocalMcp->value === $path && 'preserve' === $proposal['action'] && $proposal['sha256'] !== hash('sha256', $content)) {
                $notes[] = 'Existing .uxor/mcp.json was preserved; reconcile its application paths and saved execution permission before connecting. It may retain a previous --trust-project-code flag; remove that flag and stop any already running Serena provider if recurring execution is no longer intended.';
            }
        }
        $oldProfiler = $this->files->path($root, 'config/packages/dev/uxor.yaml');
        if (is_file($oldProfiler) && hash_file('sha256', $oldProfiler) === hash('sha256', "# Local development diagnostics; never loaded in production.\nframework:\n    profiler:\n        collect: true\n")) {
            $notes[] = 'The earlier config/packages/dev/uxor.yaml enables profiling on every dev request. Reconcile this preserved file with your application’s profiler policy.';
        }
        if (is_file($root.'/mago.toml') && !str_contains((string) file_get_contents($root.'/mago.toml'), '.uxor/mago/config.toml')) {
            $notes[] = 'Existing mago.toml was preserved. Include .uxor/mago/config.toml in its existing inheritance chain to enable Symfony enrichment.';
        }
        if ('claude' === $client) {
            $path = $this->files->path($root, '.mcp.json');
            if (is_file($path)) {
                $json = $this->files->readJson($path);
                $existing = json_decode($json, flags: JSON_THROW_ON_ERROR);
                if (!$existing instanceof \stdClass || (property_exists($existing, 'mcpServers') && !$existing->mcpServers instanceof \stdClass)) {
                    throw new \InvalidArgumentException('The existing .mcp.json and its mcpServers member must be objects.');
                }
                $rootOffset = strspn($json, " \t\r\n");
                $map = JsonObjectMembers::span($json, 'mcpServers', $rootOffset);
                $target = $map[1] ?? $rootOffset;
                $additions = [];
                foreach ($servers as $name => $server) {
                    $member = null === $map ? null : JsonObjectMembers::span($json, $name, $target);
                    if (null === $member) {
                        $additions[$name] = $server;
                    } elseif (!$existing->mcpServers->$name instanceof \stdClass || (array) $existing->mcpServers->$name !== $server) {
                        $notes[] = 'Existing MCP server '.$name.' was preserved; reconcile its application paths and saved execution permission before connecting. It may retain a previous --trust-project-code flag; remove that flag and stop any already running Serena provider if recurring execution is no longer intended.';
                    }
                }
                if ([] === $additions) {
                    $files[] = $this->files->proposal($root, '.mcp.json', '');
                } else {
                    $entries = rtrim(ApplicationFiles::encode(null === $map ? ['mcpServers' => $additions] : $additions));
                    $members = rtrim(substr($entries, 1, -1));
                    $object = null === $map ? $existing : $existing->mcpServers;
                    $content = substr_replace($json, $members.([] === (array) $object ? "\n" : ','), $target + 1, 0);
                    $files[] = ['path' => '.mcp.json', 'action' => 'update', 'sha256' => hash('sha256', $json), 'content' => $content];
                }
            } else {
                $files[] = $this->files->proposal($root, '.mcp.json', ApplicationFiles::encode(['mcpServers' => $servers]));
            }
        } elseif ('codex' === $client) {
            $path = $this->files->path($root, SetupIntegration::Codex->value);
            if (file_exists($path) && (!is_file($path) || !is_readable($path) || filesize($path) > 1024 * 1024)) {
                throw new \InvalidArgumentException('Expected a readable .codex/config.toml under 1 MiB.');
            }
            $existing = is_file($path) ? (string) file_get_contents($path) : '';
            $updated = $existing;
            foreach ($servers as $name => $server) {
                $section = "\n[mcp_servers.".$name."]\ncommand = ".json_encode($server['command'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
                    ."\nargs = ".json_encode($server['args'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
                    ."\ncwd = ".json_encode($bindingRoot, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n";
                if (str_contains($existing, ltrim($section, "\n"))) {
                    continue;
                }
                // Without a TOML editor, preserve bindings whose ownership cannot be established.
                $ambiguous = str_contains($existing, $name);
                foreach (explode("\n", $existing) as $line) {
                    if (str_contains($line, 'mcp_servers')
                        && !preg_match('/^\\s*\\[mcp_servers\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*\\]\\s*(?:#.*)?$/', $line)) {
                        $ambiguous = true;
                    }
                }
                if ($ambiguous) {
                    $notes[] = 'Existing Codex MCP definitions were preserved. Reconcile the Serena application paths and saved execution permission manually before connecting. They may retain a previous --trust-project-code flag; remove that flag and stop any already running Serena provider if recurring execution is no longer intended.';
                    continue;
                }
                $updated .= $section;
            }
            $files[] = !is_file($path) ? $this->files->proposal($root, SetupIntegration::Codex->value, $updated)
                : ($updated === $existing ? $this->files->proposal($root, SetupIntegration::Codex->value, '')
                    : ['path' => SetupIntegration::Codex->value, 'action' => 'update', 'sha256' => hash_file('sha256', $path), 'content' => $updated]);
        }
        $files = $this->ownership->record($root, $files, $servers);
        return compact('files', 'notes', 'servers', 'binding');
    }

    private function hostRoot(string $path): string
    {
        if (!str_starts_with($path, '/') || preg_match('/[\\x00-\\x1f\\x7f]/', $path)) {
            throw new \InvalidArgumentException('The MCP host project root must be an absolute Linux or macOS path.');
        }
        $path = rtrim($path, '/');
        if ('' === $path || array_intersect(explode('/', substr($path, 1)), ['', '.', '..'])) {
            throw new \InvalidArgumentException('The MCP host project root must not contain empty, dot or parent segments.');
        }
        return $path;
    }

    private function result(array $project, array $plan, string $mode, array $changes, array $executions): array
    {
        $dependencies = $this->dependencies($project);
        $missing = DevelopmentDependencies::missingRequests($dependencies);
        $publicFiles = array_map(static function (array $file): array {
            // Existing client configuration can contain private environment values.
            unset($file['content']);
            return $file;
        }, $plan['files']);
        $next = $plan['notes'];
        if ([] !== $missing) {
            $next[] = 'Install the listed development dependencies with setup --apply --install --trust-project-code in the application PHP environment.';
        }
        $next[] = 'Run prepare --trust-project-code for current compiled Symfony wiring.';
        $next[] = 'Requested MCP paths target '.$plan['binding']['root'].'; preserved bindings may differ. Configuration is not connection evidence. Supply --host-project-root when application PHP and the MCP host use different paths.';
        $next[] = $plan['binding']['requested_saved_project_trust']
            ? 'This setup request explicitly uses --save-project-trust to include --trust-project-code in new Serena bindings. New bindings written with this option authorize project code on every future connection, including later code at the selected path; there is no commit restriction or expiry. This choice does not authorize native setup commands. File editing separately requires --write, which setup does not add.'
            : 'This setup request does not save execution permission in new Serena bindings, even when --trust-project-code authorizes installation now. Review the application before authorizing a provider launch; use the separate --save-project-trust choice only when recurring execution on future connections is intended. Without launch authorization, Serena refuses to connect.';
        $next[] = 'Existing MCP bindings are preserved and may retain --trust-project-code, which authorizes application code on future connections. --save-project-trust does not update preserved bindings; reconcile them manually. Omitting it does not revoke existing permission. To revoke permission, remove the saved flag and stop any already running Serena provider; configuration changes affect subsequent launches.';
        $next[] = 'On the local Docker host, run '.$project['bin'].'/uxor-mago pull; connect the configured MCP servers, then use environment --probe --trust-project-code.';
        $next[] = 'Use the application’s existing server and tests; enable its Playwright recorder and inspect an exact Symfony request profile.';
        return ['status' => [] !== $plan['notes'] || ('apply' === $mode && [] !== $missing) ? 'incomplete' : 'completed',
            'summary' => 'plan' === $mode ? 'Development setup planned; no files or processes changed.'
                : 'Development configuration applied; inspect capability readiness before starting work.',
            'mode' => $mode, 'root' => $project['root'], 'php_binary' => PHP_BINARY,
            'files' => $publicFiles, 'dependencies' => $dependencies, 'mcp_binding' => $plan['binding'], 'changes' => $changes,
            'executions' => $executions, 'next_steps' => $next];
    }

    private function execute(array $argv, string $root, int $timeout): array
    {
        $process = new Process($argv, $root, ['APP_ENV' => 'dev', 'APP_DEBUG' => '1',
            'COMPOSER' => $root.'/composer.json', 'COMPOSER_VENDOR_DIR' => false, 'COMPOSER_BIN_DIR' => false], timeout: $timeout);
        $process->disableOutput();
        try {
            $process->run();
            return ['argv' => $argv, 'exit_code' => $process->getExitCode(), 'output' => 'Inspect native output locally; it can contain application data.'];
        } catch (\Throwable) {
            return ['argv' => $argv, 'exit_code' => null, 'output' => 'Native command could not complete within its execution limit.'];
        }
    }

    private function hashes(string $root, array $paths): array
    {
        $result = [];
        foreach ($paths as $path) {
            $absolute = $this->files->path($root, $path);
            $result[$path] = is_file($absolute) ? hash_file('sha256', $absolute) : null;
        }
        return $result;
    }

    private function changed(string $root, array $before): array
    {
        $changes = [];
        foreach ($before as $path => $hash) {
            $current = is_file($root.'/'.$path) ? hash_file('sha256', $root.'/'.$path) : null;
            if ($hash !== $current) {
                $changes[] = ['path' => $path, 'action' => null === $hash ? 'create' : 'update'];
            }
        }
        return $changes;
    }
}
