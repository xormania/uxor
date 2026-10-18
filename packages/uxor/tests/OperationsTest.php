<?php

declare(strict_types=1);

namespace Xormania\UXor\Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Console\Tester\ApplicationTester;
use Symfony\Component\Filesystem\Filesystem;
use Xormania\UXor\Console\Application;
use Xormania\UXor\NativeTools;
use Xormania\UXor\Operations;
use Xormania\UXor\ProjectDoctor;
use Xormania\UXor\ProjectInspector;
use Xormania\UXor\ReferenceBundle;
use Xormania\UXor\Mate\Capabilities;
use Symfony\AI\Mate\Encoding\ResponseEncoder;

final class OperationsTest extends TestCase
{
    private string $directory;
    private Operations $operations;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir().'/uxor-'.bin2hex(random_bytes(8));
        mkdir($this->directory.'/references/docs/modal', 0777, true);
        $text = "# Modal\nAccessible café dialog.\n";
        file_put_contents($this->directory.'/references/docs/modal/README.md', $text);
        file_put_contents($this->directory.'/references/index.json', json_encode([
            'schema_version' => 1,
            'source' => ['repository' => 'https://github.com/xormania/uxor', 'revision' => str_repeat('a', 40), 'license' => 'MIT'],
            'components' => ['modal' => ['summary' => 'Accessible dialog', 'category' => 'overlay',
                'manifest' => ['name' => 'modal'], 'documentation' => 'modal/README.md', 'source_url' => 'https://example.test/modal']],
            'documents' => ['modal/README.md' => ['path' => 'docs/modal/README.md', 'sha256' => hash('sha256', $text),
                'source_url' => 'https://example.test/modal']],
        ], JSON_THROW_ON_ERROR));
        mkdir($this->directory.'/app');
        mkdir($this->directory.'/workflows');
        file_put_contents($this->directory.'/workflows/customer-management.md', "# Customer management\nSave café details, then show feedback.\n");
        file_put_contents($this->directory.'/app/composer.json', json_encode(['require' => ['php' => '^8.4'],
            'require-dev' => ['symfony/ux-turbo' => '^3.5']], JSON_THROW_ON_ERROR));
        $inspector = new ProjectInspector();
        $this->operations = new Operations(new ReferenceBundle($this->directory.'/references', $this->directory.'/workflows'), $inspector,
            new ProjectDoctor(), new NativeTools($inspector));
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->directory);
    }

    public function testCatalogSearchAndDocumentPaginationPreserveUnicodeAndUnknownPathsFail(): void
    {
        $result = $this->operations->run('catalog', ['query' => 'dialog']);
        self::assertSame('modal', $result['data']['items'][0]['name']);
        self::assertSame([], $this->operations->run('catalog', ['query' => 'nonexistent'])['data']['items']);
        self::assertSame('failed', $this->operations->run('component', ['name' => 'nonexistent'])['status']);
        self::assertSame('failed', $this->operations->run('reference', ['path' => '../../app/composer.json'])['status']);
        $text = '';
        $offset = 0;
        do {
            $page = $this->operations->run('reference', ['path' => 'modal/README.md', 'offset' => $offset, 'limit' => 1]);
            json_encode($page, JSON_THROW_ON_ERROR);
            $text .= $page['data']['content'];
            $offset = $page['data']['next_offset'];
        } while (null !== $offset);
        self::assertSame(file_get_contents($this->directory.'/references/docs/modal/README.md'), $text);
    }

    public function testTamperedOrEscapingIndexedReferenceCannotBeRead(): void
    {
        file_put_contents($this->directory.'/references/docs/modal/README.md', 'modified');
        self::assertSame('failed', $this->operations->run('reference', ['path' => 'modal/README.md'])['status']);
        unlink($this->directory.'/references/docs/modal/README.md');
        symlink($this->directory.'/app/composer.json', $this->directory.'/references/docs/modal/README.md');
        self::assertSame('failed', $this->operations->run('reference', ['path' => 'modal/README.md'])['status']);
    }

    public function testWorkflowUsesUXorProvenanceSharedPaginationAndWhitelist(): void
    {
        $tester = new CommandTester((new Application($this->operations))->find('workflow'));
        self::assertSame(0, $tester->execute(['name' => 'customer-management', '--limit' => 12, '--format' => 'json']));
        $page = json_decode($tester->getDisplay(), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame('uxor-authored', $page['data']['source']['type']);
        self::assertArrayNotHasKey('uxor', $page['reference']);
        self::assertSame(hash_file('sha256', $this->directory.'/workflows/customer-management.md'), $page['data']['sha256']);
        self::assertTrue($page['data']['truncated']);
        $next = $this->operations->run('workflow', ['name' => 'customer-management', 'offset' => $page['data']['next_offset']]);
        self::assertSame(file_get_contents($this->directory.'/workflows/customer-management.md'), $page['data']['content'].$next['data']['content']);
        self::assertSame('failed', $this->operations->run('workflow', ['name' => '../app/composer.json'])['status']);
        unlink($this->directory.'/workflows/customer-management.md');
        symlink($this->directory.'/app/composer.json', $this->directory.'/workflows/customer-management.md');
        self::assertSame('failed', $this->operations->run('workflow', ['name' => 'customer-management'])['status']);
    }

    public function testInspectionDistinguishesDeclaredInstalledAndLockedFacts(): void
    {
        file_put_contents($this->directory.'/app/composer.lock', json_encode(['packages' => [['name' => 'symfony/ux-turbo', 'version' => 'v3.5.1']]], JSON_THROW_ON_ERROR));
        $result = $this->operations->run('inspect', ['project_root' => $this->directory.'/app']);
        self::assertSame('require-dev', $result['data']['packages']['symfony/ux-turbo']['declared_in']);
        self::assertNull($result['data']['packages']['symfony/ux-turbo']['installed_version']);
        self::assertSame('v3.5.1', $result['data']['packages']['symfony/ux-turbo']['locked_version']);
        self::assertSame('unknown', $result['data']['component_evidence']['provenance']);
        mkdir($this->directory.'/app/vendor/composer', 0777, true);
        file_put_contents($this->directory.'/app/vendor/composer/installed.json', json_encode(['packages' => [['name' => 'symfony/ux-turbo', 'version' => 'v3.5.0']]], JSON_THROW_ON_ERROR));
        $result = $this->operations->run('inspect', ['project_root' => $this->directory.'/app']);
        self::assertSame('v3.5.0', $result['data']['packages']['symfony/ux-turbo']['installed_version']);
    }

    public function testDoctorReportsRuntimeDevPlacementAndUnknownWiring(): void
    {
        $result = $this->operations->run('doctor', ['project_root' => $this->directory.'/app']);
        self::assertSame('incomplete', $result['status']);
        $failures = array_values(array_filter($result['data']['findings'], static fn (array $finding): bool => 'fail' === $finding['status']));
        self::assertSame('symfony/ux-turbo', $failures[0]['subject']);
        self::assertGreaterThan(0, $result['data']['counts']['unknown']);
        self::assertSame([], $result['changes']);
    }

    public function testInvalidRootAndMalformedProjectAreStructuredCliErrors(): void
    {
        $application = new Application($this->operations);
        $tester = new CommandTester($application->find('inspect'));
        self::assertSame(1, $tester->execute(['--project-root' => $this->directory, '--format' => 'json']));
        $result = json_decode($tester->getDisplay(), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame('failed', $result['status']);
        self::assertSame('invalid_input', $result['error']['type']);
        file_put_contents($this->directory.'/app/composer.json', '{broken');
        self::assertSame('failed', $this->operations->run('inspect', ['project_root' => $this->directory.'/app'])['status']);
        $tester = new CommandTester($application->find('catalog'));
        self::assertSame(1, $tester->execute(['--limit' => 'potato', '--format' => 'json']));
        self::assertSame('invalid_input', json_decode($tester->getDisplay(), true, 512, JSON_THROW_ON_ERROR)['error']['type']);
        $application->setAutoExit(false);
        $tester = new ApplicationTester($application);
        self::assertSame(1, $tester->run(['command' => 'catalog', '--unknown-option' => true, '--format' => 'json']));
        self::assertSame('failed', json_decode($tester->getDisplay(), true, 512, JSON_THROW_ON_ERROR)['status']);
    }

    public function testNativeDiscoveryUsesBoundProjectAndRejectsCommandInput(): void
    {
        mkdir($this->directory.'/app/bin');
        mkdir($this->directory.'/app/vendor');
        file_put_contents($this->directory.'/app/vendor/autoload.php', '<?php file_put_contents(__DIR__."/autoload-executed", "yes");');
        file_put_contents($this->directory.'/app/bin/console', <<<'PHP'
<?php
require __DIR__.'/../vendor/autoload.php';
file_put_contents(__DIR__.'/../entrypoint-executed', 'yes');
if (['list', 'make', '--format=json', '--no-interaction'] !== array_slice($argv, 1)) { exit(9); }
echo json_encode(['commands' => [['name' => 'make:controller', 'description' => getcwd()], ['name' => 'cache:clear']]]);
PHP);
        $result = $this->operations->run('tools', ['project_root' => $this->directory.'/app']);
        self::assertSame('incomplete', $result['status']);
        self::assertFalse($result['data']['project_code_executed']);
        self::assertSame('incomplete', $this->operations->run('tools', ['project_root' => $this->directory.'/app',
            'trust_project_code' => 'false'])['status']);
        $mate = new Capabilities($this->operations, $this->directory.'/app');
        $blocked = ResponseEncoder::decode($mate->tools());
        self::assertSame('incomplete', $blocked['untrusted_data']['status']);
        self::assertFileDoesNotExist($this->directory.'/app/entrypoint-executed');
        self::assertFileDoesNotExist($this->directory.'/app/vendor/autoload-executed');
        $command = new CommandTester((new Application($this->operations))->find('tools'));
        self::assertSame(0, $command->execute(['--project-root' => $this->directory.'/app', '--trust-project-code' => true, '--format' => 'json']));
        $result = json_decode($command->getDisplay(), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame('completed', $result['status'], json_encode($result));
        self::assertSame('make:controller', $result['data']['items'][0]['name']);
        self::assertSame(realpath($this->directory.'/app'), $result['data']['items'][0]['description']);
        self::assertSame(1, $result['data']['total']);
        self::assertFileExists($this->directory.'/app/entrypoint-executed');
        self::assertFileExists($this->directory.'/app/vendor/autoload-executed');
        self::assertTrue($result['data']['evidence']['trust_project_code']);
        $result = $this->operations->run('tools', ['project_root' => $this->directory.'/app', 'name' => 'make:foo; touch nope', 'trust_project_code' => true]);
        self::assertSame('failed', $result['status']);
        self::assertFileDoesNotExist($this->directory.'/app/nope');
    }

    public function testNativeDiscoveryReportsMissingAndMalformedMetadataWithoutRawErrors(): void
    {
        $arguments = ['project_root' => $this->directory.'/app', 'kind' => 'mate', 'trust_project_code' => true];
        self::assertSame('incomplete', $this->operations->run('tools', $arguments)['status']);
        mkdir($this->directory.'/app/vendor/bin', 0777, true);
        file_put_contents($this->directory.'/app/vendor/bin/mate', '<?php echo "not-json"; fwrite(STDERR, "secret-example");');
        $result = $this->operations->run('tools', $arguments);
        self::assertSame('incomplete', $result['status']);
        self::assertStringNotContainsString('secret-example', json_encode($result));
    }
}
