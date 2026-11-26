<?php

declare(strict_types=1);

namespace Xormania\UXor\Composer;

use Composer\Installer\BinaryInstaller;

/** Compare a public command with this Composer version's proxy without evaluating the application file. */
final class InstalledBinary extends BinaryInstaller
{
    public function matches(string $source, string $path): bool
    {
        if (!is_file($source) || !is_file($path)) {
            return false;
        }
        if (is_link($path)) {
            return realpath($source) === realpath($path);
        }
        $expected = $this->generateUnixyProxyCode($source, $path);
        return strlen($expected) === filesize($path) && file_get_contents($path) === $expected;
    }
}
