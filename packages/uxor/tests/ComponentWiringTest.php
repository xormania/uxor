<?php

declare(strict_types=1);

namespace Xormania\UXor\Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Console\Tester\CommandTester;
use Xormania\UXor\ComponentWiring;
use Xormania\UXor\Console\Application;
use Xormania\UXor\ProjectInspector;
use Xormania\UXor\ReferenceBundle;

final class ComponentWiringTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir().'/uxor-wiring-'.bin2hex(random_bytes(8));
        mkdir($this->root.'/assets/styles', 0777, true);
        mkdir($this->root.'/assets/controllers', 0777, true);
        file_put_contents($this->root.'/composer.json', json_encode(['require' => ['symfony/asset-mapper' => '^7.4']], JSON_THROW_ON_ERROR));
        file_put_contents($this->root.'/importmap.php', "<?php return [];\n");
        file_put_contents($this->root.'/assets/styles/app.css', '/* @import "./uxor-editor.css"; */');
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->root);
    }

    public function testEditorReportsMissingWiringThenRecognizesDocumentedStaticSetup(): void
    {
        $component = (new ReferenceBundle())->component('editor');
        $findings = $this->findings($component);
        self::assertSame('fail', $this->findingStatus($findings, 'component_importmap', '@tiptap/core'));
        self::assertSame('fail', $this->findingStatus($findings, 'component_controller_file', 'assets/controllers/editor_controller.js'));
        self::assertSame('fail', $this->findingStatus($findings, 'component_stylesheet_import', 'uxor-editor.css'));
        $map = array_fill_keys($component['manifest']['dependencies']['importmap'], ['version' => 'example']);
        file_put_contents($this->root.'/importmap.php', '<?php return '.var_export($map, true).';');
        file_put_contents($this->root.'/assets/styles/app.css', '@import "./uxor.css"; @import "./uxor-editor.css";');
        file_put_contents($this->root.'/assets/styles/uxor-editor.css', '.editor { color: inherit; }');
        file_put_contents($this->root.'/assets/controllers/editor_controller.js', 'export default class Editor {}');
        $findings = $this->findings($component);
        self::assertSame([], array_values(array_filter($findings, static fn (array $finding): bool => 'fail' === $finding['status'])));
        self::assertSame('pass', $this->findingStatus($findings, 'component_importmap', '@tiptap/core'));
        self::assertSame('pass', $this->findingStatus($findings, 'component_stylesheet_import', 'uxor-editor.css'));
        self::assertSame('unknown', $this->findingStatus($findings, 'component_runtime_verification', 'editor'));
    }

    public function testDropzoneDetectsDisabledControllerAndConflictingDefaultStylesheet(): void
    {
        $component = (new ReferenceBundle())->component('dropzone');
        $config = ['controllers' => ['@symfony/ux-dropzone' => ['dropzone' => ['enabled' => false,
            'autoimport' => ['@symfony/ux-dropzone/dist/style.min.css' => true]]]]];
        file_put_contents($this->root.'/assets/controllers.json', json_encode($config, JSON_THROW_ON_ERROR));
        $findings = $this->findings($component);
        self::assertSame('fail', $this->findingStatus($findings, 'component_controller_enabled', '@symfony/ux-dropzone/dropzone'));
        self::assertSame('fail', $this->findingStatus($findings, 'component_default_stylesheet_disabled', '@symfony/ux-dropzone/dist/style.min.css'));
        $config['controllers']['@symfony/ux-dropzone']['dropzone']['enabled'] = true;
        $config['controllers']['@symfony/ux-dropzone']['dropzone']['autoimport']['@symfony/ux-dropzone/dist/style.min.css'] = false;
        file_put_contents($this->root.'/assets/controllers.json', json_encode($config, JSON_THROW_ON_ERROR));
        $findings = $this->findings($component);
        self::assertSame('pass', $this->findingStatus($findings, 'component_controller_enabled', '@symfony/ux-dropzone/dropzone'));
        self::assertSame('pass', $this->findingStatus($findings, 'component_default_stylesheet_disabled', '@symfony/ux-dropzone/dist/style.min.css'));
    }

    public function testCustomAssetLayoutRemainsUnknownAndPhpImportmapIsNeverExecuted(): void
    {
        file_put_contents($this->root.'/importmap.php', '<?php file_put_contents(__DIR__."/executed", "yes"); return []; // "@tiptap/core" => []');
        $component = (new ReferenceBundle())->component('editor');
        $findings = $this->findings($component);
        self::assertSame('fail', $this->findingStatus($findings, 'component_importmap', '@tiptap/core'));
        self::assertFileDoesNotExist($this->root.'/executed');
        $custom = $this->findings($component, 'custom');
        self::assertSame(['unknown'], array_values(array_unique(array_column($custom, 'status'))));
        $command = new CommandTester((new Application())->find('doctor'));
        self::assertSame(2, $command->execute(['--project-root' => $this->root, '--component' => 'editor',
            '--asset-profile' => 'custom', '--format' => 'json']));
        $result = json_decode($command->getDisplay(), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame('editor', $result['data']['selected_component']);
        self::assertSame('custom', $result['data']['asset_profile']);
    }

    private function findings(array $component, string $profile = 'auto'): array
    {
        return (new ComponentWiring())->findings((new ProjectInspector())->inspect($this->root), $component, $profile);
    }

    private function findingStatus(array $findings, string $check, string $subject): string
    {
        foreach ($findings as $finding) {
            if ($finding['check'] === $check && $finding['subject'] === $subject) {
                return $finding['status'];
            }
        }
        self::fail('Expected component finding is missing.');
    }
}
