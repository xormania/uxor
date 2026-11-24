<?php

declare(strict_types=1);

namespace Xormania\UXor\Mate;

use Symfony\AI\Mate\Attribute\MateResource;
use Symfony\AI\Mate\Attribute\MateResourceTemplate;
use Symfony\AI\Mate\Attribute\MateTool;
use Symfony\AI\Mate\Encoding\ResponseEncoder;
use Xormania\UXor\Operations;

final class Capabilities
{
    public function __construct(private readonly Operations $operations, private readonly string $projectRoot)
    {
    }

    /** @param string $query Component intent/name filter; empty lists the catalog. */
    #[MateTool('uxor_catalog', description: 'Find a bounded set of UXor components and documentation references.')]
    public function catalog(string $query = '', string $category = '', int $limit = 10, int $offset = 0): array
    {
        return $this->operations->run('catalog', compact('query', 'category', 'limit', 'offset'));
    }

    /** @param string $name Exact component name from uxor_catalog. */
    #[MateTool('uxor_component', description: 'Inspect one UXor reference component, dependencies and documentation URI.')]
    public function component(string $name): array
    {
        return $this->operations->run('component', compact('name'));
    }

    #[MateTool('uxor_project', description: 'Inspect the bound application packages, configuration paths and component-file evidence without booting it.')]
    public function project(): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('inspect', ['project_root' => $this->projectRoot]));
    }

    /**
     * @param string $component Optional exact installed component name from the catalog.
     * @param string $assetProfile auto detects AssetMapper conventions; custom leaves relocated or alternative wiring for project-specific verification.
     */
    #[MateTool('uxor_doctor', description: 'Check runtime dependency placement and selected-component static asset/controller wiring, with explicit runtime unknowns.')]
    public function doctor(string $component = '', string $assetProfile = 'auto'): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('doctor',
            ['project_root' => $this->projectRoot, 'component' => $component, 'asset_profile' => $assetProfile]));
    }

    /**
     * @param bool $apply Apply the proposed configuration, preserving application-owned files.
     * @param bool $install Compatibility flag for older clients. Composer owns installation.
     * @param bool $trustProjectCode Compatibility flag for older clients. Setup only configures the application.
     * @param string $client none, claude, or codex; only Serena uses MCP, Mate uses the application CLI.
     * @param string $hostProjectRoot Optional absolute checkout path on the MCP host when PHP uses a different path.
     * @param bool $saveProjectTrust Save recurring execution permission in new Serena bindings, including later code at the selected path; no commit restriction or expiry.
     */
    #[MateTool('uxor_setup', description: 'Preview application and client configuration or apply it with apply=true. Composer installs the development tools. saveProjectTrust adds permission for future Serena connections, including later checkouts, to new bindings.')]
    public function setup(bool $apply = false, bool $install = false, bool $trustProjectCode = false, string $client = 'none', string $hostProjectRoot = '', bool $saveProjectTrust = false): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('setup',
            ['project_root' => $this->projectRoot, 'apply' => $apply, 'install' => $install, 'trust_project_code' => $trustProjectCode, 'client' => $client, 'host_project_root' => $hostProjectRoot, 'save_project_trust' => $saveProjectTrust]));
    }

    /** @param bool $apply Apply the reviewed changes to the bound application. */
    #[MateTool('uxor_detach', description: 'Plan or detach UXor development integrations before removing its Composer package. Defaults to a read-only plan.')]
    public function detach(bool $apply = false): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('detach', ['project_root' => $this->projectRoot, 'apply' => $apply]));
    }

    /** @param bool $trustProjectCode Acknowledge application PHP execution before enabling native probes. */
    #[MateTool('uxor_environment', description: 'Inspect development capabilities and preparation state. Authorized probes run native entry points and can prepare Docker provider images on first use.')]
    public function environment(bool $probe = false, bool $trustProjectCode = false): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('environment',
            ['project_root' => $this->projectRoot, 'probe' => $probe, 'trust_project_code' => $trustProjectCode]));
    }

    /** @param bool $trustProjectCode Acknowledge authorized application execution for compiled Symfony facts. */
    #[MateTool('uxor_prepare', description: 'Refresh sanitized Symfony dev-container wiring for Mago/Serena without clearing existing request profiles or logs. Requires trustProjectCode=true.')]
    public function prepare(bool $trustProjectCode = false): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('prepare',
            ['project_root' => $this->projectRoot, 'trust_project_code' => $trustProjectCode]));
    }

    /** @param string $path Path to browser-diagnostics.json relative to the bound project. */
    #[MateTool('uxor_browser_diagnostics', description: 'Read a local Playwright capture with browser errors, failed requests, and exact Symfony profile URIs.')]
    public function browserDiagnostics(string $path): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('browser-diagnostics', ['project_root' => $this->projectRoot, 'path' => $path]));
    }

    /**
     * @param string $kind maker or mate
     * @param string $name Empty lists capabilities; an exact name returns native parameter definitions.
     * @param bool $trustProjectCode Explicitly acknowledge execution of PHP/autoload code from the already trusted, authorized project.
     */
    #[MateTool('uxor_tools', description: 'Discover Maker/Mate metadata by booting the bound project and executing its PHP/autoload code. Requires trustProjectCode=true; fixed argv is not a sandbox.')]
    public function tools(string $kind = 'maker', string $name = '', int $limit = 20, bool $trustProjectCode = false): string
    {
        return ResponseEncoder::encodeUntrusted($this->operations->run('tools',
            ['project_root' => $this->projectRoot, 'kind' => $kind, 'name' => $name, 'limit' => $limit, 'trust_project_code' => $trustProjectCode]));
    }

    #[MateResource('uxor://catalog', name: 'UXor catalog', mimeType: 'application/json')]
    public function catalogResource(): array
    {
        return $this->catalog();
    }

    /** @param string $path Exact indexed reference path, e.g. INSTALL.md or modal/README.md. */
    #[MateResourceTemplate('uxor://reference/{path}', name: 'UXor reference', mimeType: 'application/json')]
    public function reference(string $path): array
    {
        return $this->operations->run('reference', compact('path'));
    }

    #[MateResourceTemplate('uxor://reference/{directory}/{file}', name: 'UXor component or guide reference', mimeType: 'application/json')]
    public function nestedReference(string $directory, string $file): array
    {
        return $this->reference($directory.'/'.$file);
    }

    #[MateResourceTemplate('uxor://reference/{directory}/{subdirectory}/{file}', name: 'UXor nested guide reference', mimeType: 'application/json')]
    public function deeplyNestedReference(string $directory, string $subdirectory, string $file): array
    {
        return $this->reference($directory.'/'.$subdirectory.'/'.$file);
    }

    /** @param string $path Exact reference key; use next_offset to continue a truncated document. */
    #[MateTool('uxor_reference', description: 'Read a bounded page of a bundled UXor reference with continuation offsets.')]
    public function readReference(string $path, int $offset = 0, int $limit = 12000): array
    {
        return $this->operations->run('reference', compact('path', 'offset', 'limit'));
    }

    /** @param string $name Known workflow name: customer-management. */
    #[MateTool('uxor_workflow', description: 'Read a practical UXor-authored application workflow with bounded pages and continuation offsets.')]
    public function workflow(string $name, int $offset = 0, int $limit = 12000): array
    {
        return $this->operations->run('workflow', compact('name', 'offset', 'limit'));
    }

    #[MateResourceTemplate('uxor://workflow/{name}', name: 'UXor application workflow', mimeType: 'application/json')]
    public function workflowResource(string $name): array
    {
        return $this->workflow($name);
    }
}
