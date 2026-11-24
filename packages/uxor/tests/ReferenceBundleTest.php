<?php

declare(strict_types=1);

namespace Xormania\UXor\Tests;

use PHPUnit\Framework\TestCase;
use RuntimeException;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Process\Process;
use Xormania\UXor\Console\Application;
use Xormania\UXor\Mate\Capabilities;
use Xormania\UXor\Operations;
use Xormania\UXor\ReferenceBundle;
use Xormania\UXor\Tools\ReferenceGenerator;

require_once dirname(__DIR__).'/tools/ReferenceGenerator.php';

final class ReferenceBundleTest extends TestCase
{
    private string $directory;
    private string $source;
    private string $output;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir().'/uxor-reference-'.bin2hex(random_bytes(8));
        $this->source = $this->directory.'/source';
        $this->output = $this->directory.'/bundle';
        $files = [
            'manifest.json' => json_encode(['name' => 'UXor fixture', 'homepage' => ReferenceGenerator::REPOSITORY, 'license' => 'MIT'], JSON_THROW_ON_ERROR),
            'README.md' => "# Fixture\n\n[Local](button/README.md)\n[Source](tools/example.php#example)\n![Logo](icon.svg)\n<https://raw.githubusercontent.com/xormania/uxor/main/FOR-AGENTS.md>\n[Release](https://github.com/xormania/uxor/blob/1.0.0/CHANGELOG.md)\n",
            'FOR-AGENTS.md' => "# Agents\n\n[Usage](docs/GUIDE.md)\n[Tools](tools)\n",
            'INSTALL.md' => "# Install\n",
            'docs/GUIDE.md' => "# Guide\n\n[Component](../button/README.md)\n",
            'docs/RECIPES.md' => "# Recipes\n\n## Basic components\n\n| Install | Description |\n|---|---|\n| [`button`](../button/README.md) | A useful button. |\n",
            'docs/PROJECT-AGENTS-SNIPPET.md' => "# Project guidance\n",
            'docs/APPLICATION-TESTING.md' => "# Application tests\n\n[Patterns](TESTING.md)\n",
            'docs/TESTING.md' => "# Tests\n",
            'packages/uxor/resources/guides.json' => json_encode([
                'install' => ['file' => 'INSTALL.md', 'title' => 'Install', 'description' => 'Install the kit.'],
                'guide' => ['file' => 'docs/GUIDE.md', 'title' => 'Guide', 'description' => 'Use the kit.'],
                'composer' => ['file' => 'packages/uxor/README.md', 'title' => 'Composer', 'description' => 'Install with Composer.'],
                'advanced' => ['file' => 'packages/uxor/OPERATIONS.md', 'title' => 'Advanced', 'description' => 'Configure the tools.'],
            ], JSON_THROW_ON_ERROR),
            'packages/uxor/README.md' => "# Composer\n\n<!-- package-install:start -->\n<!-- package-install:end -->\n\n[Operations](OPERATIONS.md)\n",
            'packages/uxor/OPERATIONS.md' => "# Advanced\n\n[Composer](README.md)\n",
            'composer.json' => json_encode([
                'name' => 'xormania/uxor', 'require' => ['php' => '>=8.4', 'vendor/experimental' => '^2.0.0-beta1', 'vendor/stable' => '^1.0'],
                'config' => ['allow-plugins' => ['vendor/example-plugin' => true]],
            ], JSON_THROW_ON_ERROR),
            'composer.lock' => json_encode([
                'stability-flags' => ['vendor/experimental' => 10, 'vendor/test-tool' => 20],
                'packages' => [
                    ['name' => 'vendor/experimental', 'version' => '2.0.0-beta1'],
                    ['name' => 'vendor/stable', 'version' => '1.0.0'],
                    ['name' => 'vendor/example-plugin', 'version' => '1.0.0', 'type' => 'composer-plugin'],
                ],
                'packages-dev' => [['name' => 'vendor/test-tool', 'version' => 'dev-main']],
            ], JSON_THROW_ON_ERROR),
            'LICENSE' => "MIT fixture license\n",
            'NOTICE' => "Fixture notice\n",
            'button/manifest.json' => '{"name":"Button","type":"component","dependencies":{"composer":["symfony/ux-twig-component:^3.5"]}}',
            'button/README.md' => "# Button\n\n[Guide](../docs/GUIDE.md)\n",
            'button/templates/Button.html.twig' => "<button>{% block content %}{% endblock %}</button>\n",
            'icon.svg' => "<svg/>\n",
            'tools/example.php' => "<?php // Example\n",
            // the latest version heading is the default ref, unreleased entries or not: never a branch
            'CHANGELOG.md' => "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A fix.\n\n## [1.4.0] - 2026-01-02\n\n## [1.0.0] - 2025-01-01\n",
        ];
        foreach ($files as $path => $content) {
            if (!is_dir(dirname($this->source.'/'.$path))) {
                mkdir(dirname($this->source.'/'.$path), 0777, true);
            }
            file_put_contents($this->source.'/'.$path, $content);
        }
    }

    protected function tearDown(): void
    {
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->directory, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($iterator as $entry) {
            $entry->isDir() && !$entry->isLink() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
        }
        rmdir($this->directory);
    }

    public function testGenerationIsDeterministicAndRecordsItsInputs(): void
    {
        $generator = new ReferenceGenerator();
        $files = $generator->build($this->source);
        self::assertSame($files, $generator->build($this->source));

        $index = json_decode($files['index.json'], true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(2, $index['schema_version']);
        self::assertEqualsCanonicalizing(['repository', 'ref', 'inputs_sha256', 'manifest_sha256', 'guide_catalog_sha256', 'license'], array_keys($index['source']));
        self::assertSame(hash_file('sha256', $this->source.'/packages/uxor/resources/guides.json'), $index['source']['guide_catalog_sha256']);
        self::assertSame('1.4.0', $index['source']['ref']);
        self::assertSame(['button'], array_keys($index['components']));
        self::assertSame('A useful button.', $index['components']['button']['summary']);
        self::assertSame('Basic components', $index['components']['button']['category']);
        self::assertSame(['symfony/ux-twig-component:^3.5'], $index['components']['button']['manifest']['dependencies']['composer']);
        self::assertSame('button/README.md', $index['components']['button']['documentation']);
        self::assertSame(ReferenceGenerator::REPOSITORY.'/tree/1.4.0/button', $index['components']['button']['source_url']);
        self::assertSame(ReferenceGenerator::REPOSITORY.'/blob/1.4.0/README.md', $index['documents']['README.md']['source_url']);
        self::assertSame(hash_file('sha256', $this->source.'/README.md'), $index['documents']['README.md']['source_sha256']);
        self::assertSame(hash('sha256', $files['docs/README.md']), $index['documents']['README.md']['sha256']);
        self::assertSame(self::inputsDigest($index), $index['source']['inputs_sha256']);
        // The inputs' digest is sha256sum's lines for the sorted input paths, hashed again
        $lines = '';
        foreach (['FOR-AGENTS.md', 'INSTALL.md', 'LICENSE', 'NOTICE', 'README.md', 'button/README.md', 'button/manifest.json',
            'docs/APPLICATION-TESTING.md', 'docs/GUIDE.md', 'docs/PROJECT-AGENTS-SNIPPET.md', 'docs/RECIPES.md', 'docs/TESTING.md', 'manifest.json',
            'packages/uxor/OPERATIONS.md', 'packages/uxor/README.md', 'packages/uxor/resources/guides.json'] as $path) {
            $lines .= hash_file('sha256', $this->source.'/'.$path).'  '.$path."\n";
        }
        self::assertSame(hash('sha256', $lines), $index['source']['inputs_sha256']);

        self::assertSame("# Application tests\n\n[Patterns](TESTING.md)\n", $files['docs/docs/APPLICATION-TESTING.md']);

        // A copied document stays a relative link; any other file of the repository is linked at the ref
        self::assertStringContainsString('[Local](button/README.md)', $files['docs/README.md']);
        self::assertStringContainsString('[Source]('.ReferenceGenerator::REPOSITORY.'/blob/1.4.0/tools/example.php#example)', $files['docs/README.md']);
        self::assertStringContainsString('![Logo](https://raw.githubusercontent.com/xormania/uxor/1.4.0/icon.svg)', $files['docs/README.md']);
        self::assertStringContainsString('[Tools]('.ReferenceGenerator::REPOSITORY.'/tree/1.4.0/tools)', $files['docs/FOR-AGENTS.md']);
        self::assertStringContainsString('<https://raw.githubusercontent.com/xormania/uxor/1.4.0/FOR-AGENTS.md>', $files['docs/README.md']);
        // a link to a fixed tag is kept as written
        self::assertStringContainsString('[Release](https://github.com/xormania/uxor/blob/1.0.0/CHANGELOG.md)', $files['docs/README.md']);

        // An explicit ref pins the links that follow a moving branch
        $tagged = $generator->build($this->source, '2.0.0');
        self::assertStringContainsString('<https://raw.githubusercontent.com/xormania/uxor/2.0.0/FOR-AGENTS.md>', $tagged['docs/README.md']);
        self::assertStringContainsString('/blob/2.0.0/tools/example.php#example', $tagged['docs/README.md']);
        self::assertSame($index['source']['inputs_sha256'], json_decode($tagged['index.json'], true)['source']['inputs_sha256']);
    }

    public function testProvenanceNamesNoCommitAndIgnoresTheCheckoutState(): void
    {
        $generator = new ReferenceGenerator();
        $before = $generator->build($this->source);
        self::assertArrayNotHasKey('revision', json_decode($before['index.json'], true)['source']);

        // The same inputs in a Git checkout, committed with the bundle they make, then edited without a commit
        $generator->write($before, $this->source.'/packages/uxor/resources/uxor');
        $this->git(['init', '--quiet']);
        $this->git(['add', '.']);
        $this->git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Fixture']);
        $head = $this->git(['rev-parse', 'HEAD']);
        $after = $generator->build($this->source);
        self::assertSame($before, $after);
        foreach ($after as $path => $content) {
            self::assertStringNotContainsString($head, $content, $path);
            self::assertStringNotContainsString(substr($head, 0, 7), $content, $path);
        }

        // A file that is not an input changes nothing; an uncommitted input is read as it is
        file_put_contents($this->source.'/tools/example.php', "<?php // Changed\n");
        file_put_contents($this->source.'/button/templates/Button.html.twig', "<button></button>\n");
        file_put_contents($this->source.'/unrelated.txt', "untracked\n");
        self::assertSame($before, $generator->build($this->source));
        file_put_contents($this->source.'/button/README.md', "# Button, changed\n");
        $changed = $generator->build($this->source);
        self::assertSame("# Button, changed\n", $changed['docs/button/README.md']);
        self::assertNotSame(json_decode($before['index.json'], true)['source']['inputs_sha256'], json_decode($changed['index.json'], true)['source']['inputs_sha256']);
    }

    public function testCheckReportsStaleFilesWithoutRepairingThem(): void
    {
        [$status, , $error] = $this->script(['--check']);
        self::assertSame(1, $status);
        self::assertStringContainsString('missing: index.json', $error);

        [$status, $output] = $this->script([]);
        self::assertSame(0, $status, $output);
        self::assertStringStartsWith('Wrote 14 generated reference files', $output);
        [$status, $output] = $this->script(['--check']);
        self::assertSame(0, $status);
        self::assertStringStartsWith('Verified 14 generated reference files', $output);

        $index = file_get_contents($this->output.'/index.json');
        file_put_contents($this->source.'/button/README.md', "# Button, changed\n");
        file_put_contents($this->output.'/docs/obsolete.md', "# Left over\n");
        [$status, , $error] = $this->script(['--check']);
        self::assertSame(1, $status);
        self::assertStringContainsString("  changed: docs/button/README.md\n  unexpected: docs/obsolete.md\n  changed: index.json\n", $error);
        self::assertSame($index, file_get_contents($this->output.'/index.json'));
        self::assertSame("# Button\n\n[Guide](../docs/GUIDE.md)\n", file_get_contents($this->output.'/docs/button/README.md'));
        self::assertFileExists($this->output.'/docs/obsolete.md');

        // Regenerating repairs the bundle and removes what is left over; a check at another ref than the bundle's fails
        self::assertSame(0, $this->script([])[0]);
        self::assertFileDoesNotExist($this->output.'/docs/obsolete.md');
        self::assertSame(0, $this->script(['--check'])[0]);
        self::assertSame(1, $this->script(['--check', '--ref=1.0.0'])[0]);
    }

    public function testComposerInstallGuideChangesWhenThePackageRequirementChanges(): void
    {
        [$status, , $error] = $this->script([]);
        self::assertSame(0, $status, $error);
        $guide = $this->source.'/packages/uxor/README.md';
        $before = file_get_contents($guide);
        self::assertStringContainsString('composer require --dev', $before);
        self::assertStringContainsString('vendor/experimental:^2.0.0-beta1', $before);
        self::assertStringNotContainsString('vendor/stable:', $before);
        self::assertStringNotContainsString('vendor/test-tool:', $before);
        self::assertStringContainsString('allow-plugins.vendor/example-plugin', $before);
        self::assertStringContainsString('>=8.4', $before);
        self::assertStringContainsString('xormania/uxor:^1.4.0', $before);
        self::assertSame($before, file_get_contents($this->output.'/docs/packages/uxor/README.md'));

        $path = $this->source.'/composer.json';
        $manifest = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        $manifest['require']['vendor/experimental'] = '>=2.0.0-beta1 <2.0.0-beta4';
        file_put_contents($path, json_encode($manifest, JSON_THROW_ON_ERROR));
        self::assertSame(1, $this->script(['--check'])[0]);
        self::assertSame($before, file_get_contents($guide), 'check leaves the source guide intact');
        self::assertSame($before, file_get_contents($this->output.'/docs/packages/uxor/README.md'));

        [$status, , $error] = $this->script([]);
        self::assertSame(0, $status, $error);
        $after = file_get_contents($guide);
        self::assertStringContainsString("'vendor/experimental:>=2.0.0-beta1 <2.0.0-beta4@beta'", $after);
        self::assertStringNotContainsString('vendor/experimental:^2.0.0-beta1', $after);
        self::assertSame($after, file_get_contents($this->output.'/docs/packages/uxor/README.md'));
        self::assertSame(0, $this->script(['--check'])[0]);
    }

    public function testInstalledCliAndMateReadBothPackageGuides(): void
    {
        $root = ReferenceGenerator::repositoryRoot();
        $catalogKey = 'packages/uxor/resources/guides.json';
        $bundle = $root.'/packages/uxor/resources/uxor';
        $index = json_decode(file_get_contents($bundle.'/index.json'), true, 512, JSON_THROW_ON_ERROR);
        $command = new CommandTester((new Application())->find('reference'));

        $mate = new Capabilities(Operations::create(), $root);
        $catalog = json_decode(file_get_contents($root.'/'.$catalogKey), true, 512, JSON_THROW_ON_ERROR);
        self::assertArrayNotHasKey($catalogKey, $index['documents']);
        self::assertSame(hash_file('sha256', $root.'/'.$catalogKey), $index['source']['guide_catalog_sha256']);
        foreach (['composer' => 'packages/uxor/README.md', 'advanced' => 'packages/uxor/OPERATIONS.md'] as $slug => $path) {
            self::assertSame($path, $catalog[$slug]['file']);
            $resource = $mate->deeplyNestedReference(...explode('/', $path));
            self::assertSame($path, $resource['data']['path']);
            self::assertSame($index['documents'][$path]['sha256'], $resource['data']['sha256']);
            $offset = 0;
            $text = '';
            do {
                $status = $command->execute(['path' => $path, '--offset' => $offset, '--limit' => 512, '--format' => 'json']);
                self::assertSame(0, $status, $command->getDisplay());
                $page = json_decode($command->getDisplay(), true, 512, JSON_THROW_ON_ERROR)['data'];
                self::assertSame($offset, $page['offset']);
                self::assertNotSame('', $page['content']);
                self::assertLessThanOrEqual(512, strlen($page['content']));
                $text .= $page['content'];
                $offset = $page['next_offset'];
                if (null !== $offset) {
                    self::assertSame(strlen($text), $offset);
                }
            } while (null !== $offset);
            self::assertSame(hash_file('sha256', $root.'/'.$path), $index['documents'][$path]['source_sha256'], $path);
            self::assertSame(file_get_contents($bundle.'/docs/'.$path), $text, $path);
        }
    }

    public function testTheCommandGuideRejectsDriftAndRestoresTheInstalledCommandDefinition(): void
    {
        $package = $this->source.'/packages/uxor';
        $script = $package.'/tools/generate-command-guide.php';
        mkdir(dirname($script), 0777, true);
        copy(dirname(__DIR__).'/tools/generate-command-guide.php', $script);
        symlink(ReferenceGenerator::repositoryRoot().'/vendor', $this->source.'/vendor');
        $guide = $package.'/OPERATIONS.md';
        $current = file_get_contents(dirname(__DIR__).'/OPERATIONS.md');
        $command = (new Application())->find('setup');
        $description = $command->getDefinition()->getOption('save-project-trust')->getDescription();
        self::assertStringContainsString('### `setup`', $current);
        self::assertStringContainsString($description, $current);
        $stale = str_replace($description, 'Stale option description.', $current);
        file_put_contents($guide, $stale);

        $check = new Process([PHP_BINARY, $script, '--check']);
        self::assertSame(1, $check->run(), $check->getErrorOutput());
        self::assertSame($stale, file_get_contents($guide));
        (new Process([PHP_BINARY, $script]))->mustRun();
        self::assertSame($current, file_get_contents($guide));
        self::assertSame(0, $check->run(), $check->getErrorOutput());
    }

    public function testNoReleaseInTheChangelogIsAnErrorNeverABranch(): void
    {
        file_put_contents($this->source.'/CHANGELOG.md', "# Changelog\n\n## [Unreleased]\n\n- A fix.\n");
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('no `## [X.Y.Z]` heading');
        (new ReferenceGenerator())->build($this->source);
    }

    public function testWrongRefIsRejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('--ref');
        (new ReferenceGenerator())->build($this->source, '../main');
    }

    public function testSymbolicLinkInputIsRejected(): void
    {
        unlink($this->source.'/INSTALL.md');
        symlink($this->source.'/NOTICE', $this->source.'/INSTALL.md');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('not a regular file');
        (new ReferenceGenerator())->build($this->source);
    }

    public function testCatalogDriftIsRejected(): void
    {
        file_put_contents($this->source.'/docs/RECIPES.md', "# No components listed\n");
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('catalog and recipe manifest directories do not match');
        (new ReferenceGenerator())->build($this->source);
    }

    public function testMissingRecipeDependencyIsRejected(): void
    {
        file_put_contents($this->source.'/button/manifest.json', '{"name":"Button","dependencies":{"recipe":["missing"]}}');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('depends on missing recipe');
        (new ReferenceGenerator())->build($this->source);
    }

    public function testBrokenLinkIsRejected(): void
    {
        file_put_contents($this->source.'/docs/GUIDE.md', "# Guide\n\n[Gone](../tools/gone.php)\n");
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('link target is missing');
        (new ReferenceGenerator())->build($this->source);
    }

    public function testPackagedDocumentsHaveValidHashesAndLocalDestinations(): void
    {
        $root = dirname(__DIR__).'/resources/uxor';
        $index = json_decode(file_get_contents($root.'/index.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(ReferenceGenerator::SCHEMA_VERSION, $index['schema_version']);
        self::assertArrayNotHasKey('revision', $index['source']);
        self::assertSame(ReferenceGenerator::releaseRef(ReferenceGenerator::repositoryRoot()), $index['source']['ref']);
        self::assertSame(self::inputsDigest($index), $index['source']['inputs_sha256']);
        self::assertSame($index['source'], (new ReferenceBundle($root))->metadata());
        self::assertNotEmpty($index['components']);
        foreach ($index['components'] as $name => $component) {
            self::assertArrayHasKey($component['documentation'], $index['documents'], $name);
            self::assertSame(ReferenceGenerator::REPOSITORY.'/tree/'.$index['source']['ref'].'/'.$name, $component['source_url']);
            foreach ($component['manifest']['dependencies']['recipe'] ?? [] as $dependency) {
                self::assertArrayHasKey($dependency, $index['components'], $name.' -> '.$dependency);
            }
        }
        foreach ($index['documents'] as $key => $document) {
            self::assertSame('docs/'.$key, $document['path']);
            $path = $root.'/'.$document['path'];
            self::assertFileExists($path);
            self::assertSame($document['sha256'], hash_file('sha256', $path), $key);
            self::assertSame(ReferenceGenerator::REPOSITORY.'/blob/'.$index['source']['ref'].'/'.$key, $document['source_url']);
            if (!str_ends_with($path, '.md')) {
                continue;
            }
            preg_match_all('/!?\[[^\]\n]*\]\(([^\s)]+)\)/', file_get_contents($path), $matches);
            foreach ($matches[1] as $target) {
                if (preg_match('~^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|/|#)~', $target)) {
                    continue;
                }
                $relative = preg_split('/[?#]/', $target, 2)[0];
                $resolved = realpath(dirname($path).'/'.rawurldecode($relative));
                self::assertNotFalse($resolved, $key.' -> '.$target);
                self::assertStringStartsWith(realpath($root.'/docs').'/', $resolved, $key.' -> '.$target);
            }
        }
    }

    public function testCopiedSkillsCanUseResourcesWithoutEscapingTheirDirectories(): void
    {
        foreach (['uxor-setup', 'uxor-build', 'uxor-verify'] as $name) {
            $content = file_get_contents(dirname(__DIR__).'/skills/'.$name.'/SKILL.md');
            self::assertStringStartsWith("---\nname: ".$name."\n", $content);
            self::assertStringContainsString('uxor://reference/', $content);
            self::assertStringNotContainsString('](../', $content);
            self::assertStringContainsString('xormania/uxor/packages/uxor/resources/uxor/docs/', $content);
        }
    }

    /** The inputs' digest, recomputed from the hashes the index records for each input. */
    private static function inputsDigest(array $index): string
    {
        $inputs = [
            'manifest.json' => $index['source']['manifest_sha256'],
            'packages/uxor/resources/guides.json' => $index['source']['guide_catalog_sha256'],
        ];
        foreach ($index['components'] as $name => $component) {
            $inputs[$name.'/manifest.json'] = $component['manifest_sha256'];
        }
        foreach ($index['documents'] as $path => $document) {
            $inputs[$path] = $document['source_sha256'];
        }

        return ReferenceGenerator::inputsDigest($inputs);
    }

    /**
     * Runs generate-reference.php on the fixture.
     *
     * @param list<string> $arguments
     *
     * @return array{int, string, string} the exit status, the output and the error output
     */
    private function script(array $arguments): array
    {
        $command = [PHP_BINARY, dirname(__DIR__).'/tools/generate-reference.php', '--source='.$this->source, '--output='.$this->output, ...$arguments];
        $process = proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) {
            throw new RuntimeException('Cannot start the generator.');
        }
        $output = stream_get_contents($pipes[1]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);

        return [proc_close($process), $output, $error];
    }

    /** @param list<string> $arguments */
    private function git(array $arguments): string
    {
        $process = proc_open(['git', '-C', $this->source, ...$arguments], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) {
            throw new RuntimeException('Cannot start fixture Git.');
        }
        $output = stream_get_contents($pipes[1]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (0 !== proc_close($process)) {
            throw new RuntimeException('Fixture Git failed: '.$error);
        }

        return trim($output);
    }
}
