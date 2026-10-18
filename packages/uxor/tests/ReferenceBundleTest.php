<?php

declare(strict_types=1);

namespace Xormania\UXor\Tests;

use PHPUnit\Framework\TestCase;
use RuntimeException;
use Xormania\UXor\Tools\ReferenceGenerator;

require_once dirname(__DIR__).'/tools/ReferenceGenerator.php';

final class ReferenceBundleTest extends TestCase
{
    private string $source;
    private string $revision;

    protected function setUp(): void
    {
        $this->source = sys_get_temp_dir().'/uxor-reference-'.bin2hex(random_bytes(8));
        mkdir($this->source, 0777, true);
        $files = [
            'manifest.json' => json_encode(['name' => 'UXor fixture', 'homepage' => ReferenceGenerator::REPOSITORY, 'license' => 'MIT'], JSON_THROW_ON_ERROR),
            'README.md' => "# Fixture\n\n[Local](button/README.md)\n[Source](tools/example.php#example)\n<https://raw.githubusercontent.com/xormania/uxor/main/FOR-AGENTS.md>\n",
            'FOR-AGENTS.md' => "# Agents\n\n[Usage](docs/GUIDE.md)\n",
            'INSTALL.md' => "# Install\n",
            'docs/GUIDE.md' => "# Guide\n\n[Component](../button/README.md)\n",
            'docs/RECIPES.md' => "# Recipes\n\n## Basic components\n\n| Install | Description |\n|---|---|\n| [`button`](../button/README.md) | A useful button. |\n",
            'docs/PROJECT-AGENTS-SNIPPET.md' => "# Project guidance\n",
            'docs/TESTING.md' => "# Tests\n",
            'LICENSE' => "MIT fixture license\n",
            'NOTICE' => "Fixture notice\n",
            'button/manifest.json' => '{"name":"Button","type":"component","dependencies":{"composer":["symfony/ux-twig-component:^3.5"]}}',
            'button/README.md' => "# Button\n\n[Guide](../docs/GUIDE.md)\n",
            'tools/example.php' => "<?php // Example\n",
        ];
        foreach ($files as $path => $content) {
            if (!is_dir(dirname($this->source.'/'.$path))) {
                mkdir(dirname($this->source.'/'.$path), 0777, true);
            }
            file_put_contents($this->source.'/'.$path, $content);
        }
        $this->git(['init', '--quiet']);
        $this->commit();
    }

    protected function tearDown(): void
    {
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->source, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($iterator as $entry) {
            $entry->isDir() && !$entry->isLink() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
        }
        rmdir($this->source);
    }

    public function testGenerationIsDeterministicAndPreservesProvenance(): void
    {
        $generator = new ReferenceGenerator();
        $files = $generator->build($this->source, $this->revision);
        self::assertSame($files, $generator->build($this->source, $this->revision));

        $index = json_decode($files['index.json'], true, 512, JSON_THROW_ON_ERROR);
        self::assertSame($this->revision, $index['source']['revision']);
        self::assertSame(['button'], array_keys($index['components']));
        self::assertSame('A useful button.', $index['components']['button']['summary']);
        self::assertSame('Basic components', $index['components']['button']['category']);
        self::assertSame(['symfony/ux-twig-component:^3.5'], $index['components']['button']['manifest']['dependencies']['composer']);
        self::assertSame('button/README.md', $index['components']['button']['documentation']);
        self::assertSame(hash_file('sha256', $this->source.'/README.md'), $index['documents']['README.md']['source_sha256']);
        self::assertSame(hash('sha256', $files['docs/README.md']), $index['documents']['README.md']['sha256']);
        self::assertStringContainsString('[Local](button/README.md)', $files['docs/README.md']);
        self::assertStringContainsString('[Source]('.ReferenceGenerator::REPOSITORY.'/blob/'.$this->revision.'/tools/example.php#example)', $files['docs/README.md']);
        self::assertStringContainsString('https://raw.githubusercontent.com/xormania/uxor/'.$this->revision.'/FOR-AGENTS.md', $files['docs/README.md']);
    }

    public function testWrongRevisionIsRejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('HEAD does not match');
        (new ReferenceGenerator())->build($this->source, str_repeat('0', 40));
    }

    public function testUncommittedSourceIsRejected(): void
    {
        file_put_contents($this->source.'/button/README.md', "# Changed\n");
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('must be clean');
        (new ReferenceGenerator())->build($this->source, $this->revision);
    }

    public function testCatalogDriftIsRejected(): void
    {
        file_put_contents($this->source.'/docs/RECIPES.md', "# No components listed\n");
        $this->commit();
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('catalog and recipe manifest directories do not match');
        (new ReferenceGenerator())->build($this->source, $this->revision);
    }

    public function testMissingRecipeDependencyIsRejected(): void
    {
        file_put_contents($this->source.'/button/manifest.json', '{"name":"Button","dependencies":{"recipe":["missing"]}}');
        $this->commit();
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('depends on missing recipe');
        (new ReferenceGenerator())->build($this->source, $this->revision);
    }

    public function testPackagedDocumentsHaveValidHashesAndLocalDestinations(): void
    {
        $root = dirname(__DIR__).'/resources/uxor';
        $index = json_decode(file_get_contents($root.'/index.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(1, $index['schema_version']);
        self::assertMatchesRegularExpression('/^[a-f0-9]{40}$/D', $index['source']['revision']);
        self::assertNotEmpty($index['components']);
        foreach ($index['components'] as $name => $component) {
            self::assertArrayHasKey($component['documentation'], $index['documents'], $name);
            foreach ($component['manifest']['dependencies']['recipe'] ?? [] as $dependency) {
                self::assertArrayHasKey($dependency, $index['components'], $name.' -> '.$dependency);
            }
        }
        foreach ($index['documents'] as $key => $document) {
            self::assertSame('docs/'.$key, $document['path']);
            $path = $root.'/'.$document['path'];
            self::assertFileExists($path);
            self::assertSame($document['sha256'], hash_file('sha256', $path), $key);
            self::assertStringContainsString('/'.$index['source']['revision'].'/', $document['source_url']);
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
        foreach (['setup', 'build', 'verify'] as $name) {
            $content = file_get_contents(dirname(__DIR__).'/skills/'.$name.'/SKILL.md');
            self::assertStringStartsWith("---\nname: ".$name."\n", $content);
            self::assertStringContainsString('uxor://reference/', $content);
            self::assertStringNotContainsString('](../', $content);
            self::assertStringContainsString('xormania/uxor/packages/uxor/resources/uxor/docs/', $content);
        }
    }

    private function commit(): void
    {
        $this->git(['add', '.']);
        $this->git(['-c', 'user.name=xormania', '-c', 'user.email=xormania@users.noreply.github.com', 'commit', '--quiet', '-m', 'Reference fixture']);
        $this->revision = $this->git(['rev-parse', 'HEAD']);
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
