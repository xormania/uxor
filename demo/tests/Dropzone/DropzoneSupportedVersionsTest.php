<?php

namespace App\Tests\Dropzone;

use Composer\Semver\Comparator;
use Composer\Semver\Semver;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Filesystem\Filesystem;

final class DropzoneSupportedVersionsTest extends TestCase
{
    private const PACKAGE = 'symfony/ux-dropzone';
    private const MINIMUM_VERSION = '3.7';

    public function testTheDemoUsesTheRangeSupportedByTheRecipe(): void
    {
        $manifest = self::readJson('dropzone/manifest.json');
        $dependencies = array_filter(
            $manifest['dependencies']['composer'] ?? [],
            static fn (string $dependency): bool => explode(':', $dependency, 2)[0] === self::PACKAGE,
        );
        $range = '^'.self::MINIMUM_VERSION;
        self::assertSame([self::PACKAGE.':'.$range], array_values($dependencies), 'The recipe must declare its supported range exactly once.');

        $composer = self::readJson('demo/composer.json');
        self::assertSame($range, $composer['require'][self::PACKAGE] ?? null, 'The demo must require the same range as the recipe.');

        $lock = self::readJson('demo/composer.lock');
        $versions = array_column($lock['packages'], 'version', 'name');
        $version = $versions[self::PACKAGE] ?? null;
        self::assertIsString($version, 'The demo must lock a runtime version of '.self::PACKAGE.'.');
        self::assertTrue(Semver::satisfies($version, $range), \sprintf('The demo locks %s %s, which does not satisfy %s.', self::PACKAGE, $version, $range));
    }

    public function testTheReadmeNamesNoDropzone3VersionBelowTheSupportFloor(): void
    {
        $readme = (new Filesystem())->readFile(\dirname(__DIR__, 3).'/dropzone/README.md');
        preg_match_all('/(?<![\d.])3\.\d+(?:\.\d+)?(?![\d.])/', $readme, $matches);
        $unsupported = array_filter($matches[0], static fn (string $version): bool => Comparator::lessThan($version, self::MINIMUM_VERSION));
        self::assertSame([], $unsupported, 'dropzone/README.md names Dropzone versions below the supported floor.');
    }

    /** @return array<string, mixed> */
    private static function readJson(string $path): array
    {
        $data = json_decode((new Filesystem())->readFile(\dirname(__DIR__, 3).'/'.$path), true, flags: \JSON_THROW_ON_ERROR);
        self::assertIsArray($data, $path.' must contain a JSON object.');

        return $data;
    }
}
