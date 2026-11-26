<?php

declare(strict_types=1);

namespace Xormania\UXor\Composer;

use Symfony\Component\Process\Process;
use Xormania\UXor\ApplicationFiles;
use Xormania\UXor\Preparation\ProjectPath;

/** Mate reads installed extensions at <application>/vendor, independently of Composer's vendor-dir. */
final class MateVendorLink
{
    private const RECORD = '.uxor/mate-vendor-link.json';
    private const KIND = 'uxor-mate-vendor-link';
    private const WITNESS = '.uxor/mate-vendor-link.id';

    public static function available(string $root, string $vendor): bool
    {
        $configured = realpath($root.'/'.$vendor);
        return false !== $configured && $configured === realpath($root.'/vendor');
    }

    public static function connect(string $root, string $vendor): ?string
    {
        $lock = ApplicationFiles::lockProject($root);
        if (self::available($root, $vendor)) {
            return null;
        }
        $alias = $root.'/vendor';
        if (file_exists($alias) || is_link($alias)) {
            return 'Mate needs vendor to point to '.$vendor.'. UXor preserved the existing vendor path. Reconcile it, then run composer install again.';
        }
        $record = ProjectPath::writablePath($root, '.uxor').'/mate-vendor-link.json';
        $witness = self::witness($root);
        // If only the public link was removed, the original witness and record still prove ownership.
        if (is_link($witness) && !is_link($record) && is_file($record) && is_readable($record) && filesize($record) <= 4096) {
            $data = json_decode((string) file_get_contents($record), true);
            if (self::KIND === ($data['kind'] ?? null) && $vendor === ($data['target'] ?? null)
                && readlink($witness) === $vendor && is_array($data['identity'] ?? null) && $data['identity'] === self::identity($witness)) {
                self::detachment($root, true);
            }
        }
        if (is_link($record) || file_exists($record) || is_link($witness) || file_exists($witness)) {
            return 'Mate needs vendor to point to '.$vendor.'. Inspect the preserved compatibility-link record in .uxor before retrying.';
        }
        // symlink() is exclusive, even for a dangling destination. Use a relative target so the app can move.
        if (!@symlink($vendor, $alias)) {
            return 'Could not create vendor -> '.$vendor.'. Check symbolic-link permissions, then run composer install again.';
        }
        $identity = self::identity($alias);
        // Pin the symlink inode itself so replacing it (even with an identical target) never transfers ownership.
        // Darwin link(2) dereferences the source; ln -P explicitly links the symbolic link on that platform.
        if ('Linux' === PHP_OS_FAMILY) {
            @link($alias, $witness);
        } elseif ('Darwin' === PHP_OS_FAMILY && is_executable('/bin/ln')) {
            (new Process(['/bin/ln', '-P', $alias, $witness]))->run();
        }
        $stream = @fopen($record, 'x');
        if (false === $stream) {
            return 'Mate can use vendor, but UXor could not record its creation. Inspect the link before removal.';
        }
        try {
            $json = ApplicationFiles::encode(['kind' => self::KIND, 'schema' => 1, 'target' => $vendor, 'identity' => $identity]);
            if (strlen($json) !== fwrite($stream, $json)) {
                throw new \RuntimeException('Could not record the created Mate vendor link.');
            }
        } finally {
            fclose($stream);
        }
        return null === $identity || !is_link($witness) ? 'Mate is configured. This filesystem could not pin the link identity, so inspect vendor manually when removing UXor.' : null;
    }

    /** Return only verified removals. Preserve an application replacement or an unprovable link. */
    public static function detachment(string $root, bool $apply): array
    {
        if (is_link($root.'/.uxor') || (file_exists($root.'/.uxor') && !is_dir($root.'/.uxor'))) {
            return ['files' => [], 'note' => 'UXor preserved the application’s .uxor path; its local Mate link record could not be inspected.'];
        }
        $record = ProjectPath::writablePath($root, '.uxor').'/mate-vendor-link.json';
        if (!file_exists($record) && !is_link($record)) {
            return ['files' => [], 'note' => null];
        }
        $data = !is_link($record) && is_file($record) && is_readable($record) && filesize($record) <= 4096
            ? json_decode((string) file_get_contents($record), true) : null;
        if (self::KIND !== ($data['kind'] ?? null) || 1 !== ($data['schema'] ?? null) || !is_string($data['target'] ?? null)) {
            return ['files' => [], 'note' => 'Inspect the unrecognized Mate compatibility-link record in .uxor.'];
        }
        $alias = $root.'/vendor';
        $witness = self::witness($root);
        $expected = $data['identity'] ?? null;
        $witnessed = is_array($expected) && is_link($witness) && readlink($witness) === $data['target'] && self::identity($witness) === $expected;
        $owned = $witnessed && is_link($alias) && readlink($alias) === $data['target'] && self::identity($alias) === $expected;
        $files = [];
        if ($owned) {
            $files[] = 'vendor';
        }
        if ($witnessed) {
            $files[] = self::WITNESS;
        }
        $files[] = self::RECORD;
        $note = !$owned && (is_link($alias) || file_exists($alias)) ? 'UXor preserved vendor because its original ownership could not be verified. Inspect this application path before removal.' : null;
        if ($apply) {
            foreach ($files as $path) {
                if (!unlink($root.'/'.$path)) {
                    throw new \RuntimeException('Could not detach '.$path.'.');
                }
            }
        }
        return ['files' => array_map(static fn (string $path): array => ['path' => $path, 'action' => 'remove'], $files), 'note' => $note];
    }

    private static function identity(string $path): ?array
    {
        clearstatcache(true, $path);
        $stat = lstat($path);
        return false !== $stat && 0 !== $stat['ino'] ? [$stat['dev'], $stat['ino']] : null;
    }

    private static function witness(string $root): string
    {
        return ProjectPath::writablePath($root, '.uxor').'/mate-vendor-link.id';
    }
}
