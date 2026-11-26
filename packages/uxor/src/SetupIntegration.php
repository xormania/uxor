<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Application paths whose package references participate in setup and detachment. */
enum SetupIntegration: string
{
    case Mago = 'mago.toml';
    case Browser = '.uxor/browser.mjs';
    case LocalMcp = '.uxor/mcp.json';
    case Claude = '.mcp.json';
    case Codex = '.codex/config.toml';
    case MagoConfig = SymfonyPreparation::CONFIG;
    case Worker = SymfonyPreparation::WORKER;
    case Guide = '.uxor/README.md';
}
