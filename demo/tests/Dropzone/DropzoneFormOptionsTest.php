<?php

namespace App\Tests\Dropzone;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\Form\FormInterface;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\UX\Dropzone\Form\DropzoneType;
use Symfony\UX\TwigComponent\Test\InteractsWithTwigComponents;
use Twig\Loader\ChainLoader;
use Twig\Loader\FilesystemLoader;

/**
 * The UX Dropzone 3.7 options the recipe's component and its form widget pass to the controller: `maxFiles` (the
 * `max_files` form option, whose Count constraint comes from UX Dropzone's DropzoneType) and the markup of each
 * picked file (the component's `preview_item` block, the form theme's `dropzone_preview_item` block), which the
 * component wraps in the controller's `previewItemTemplate` target. The browser side (files over the limit refused,
 * the template cloned per file) is the lab's.
 */
final class DropzoneFormOptionsTest extends KernelTestCase
{
    use InteractsWithTwigComponents;

    private const CONTROLLER = '[data-controller~="symfony--ux-dropzone--dropzone"]';
    private const MAX_FILES = 'data-symfony--ux-dropzone--dropzone-max-files-value';
    private const TEMPLATE = 'template[data-symfony--ux-dropzone--dropzone-target="previewItemTemplate"]';

    /** @var list<string> */
    private array $files = [];

    /** @var list<string> */
    private array $directories = [];

    protected function tearDown(): void
    {
        foreach ($this->files as $file) {
            @unlink($file);
        }
        foreach ($this->directories as $directory) {
            @rmdir($directory);
        }
        $this->files = $this->directories = [];
        parent::tearDown();
    }

    /**
     * The limit renders, as written, only on a `multiple` zone and only when `maxFiles` is not a boolean and its text is a
     * positive integer's digits (/^[1-9][0-9]*$/): `:maxFiles="3"` gives an int, a plain `maxFiles="3"` a string.
     *
     * @return iterable<string, array{mixed, string}>
     */
    public static function limits(): iterable
    {
        yield 'int' => [3, '3'];
        yield 'digits' => ['3', '3'];
        yield 'several digits' => [12, '12'];
        yield 'float with no fraction (its text is 3)' => [3.0, '3'];
    }

    #[DataProvider('limits')]
    public function testAMultipleDropzoneGivesTheControllerItsMaxFiles(mixed $value, string $expected): void
    {
        $zone = $this->zone($this->renderTwigComponent('Dropzone', ['multiple' => true, 'maxFiles' => $value])->toString());

        self::assertSame($expected, $zone->attr(self::MAX_FILES));
    }

    /** @return iterable<string, array{mixed}> */
    public static function singleFileLimits(): iterable
    {
        yield 'int' => [3];
        yield 'digits' => ['3'];
    }

    #[DataProvider('singleFileLimits')]
    public function testASingleFileDropzoneHasNoMaxFiles(mixed $value): void
    {
        $zone = $this->zone($this->renderTwigComponent('Dropzone', ['multiple' => false, 'maxFiles' => $value])->toString());

        self::assertNull($zone->attr(self::MAX_FILES));
    }

    public function testWithoutMaxFilesTheControllerHasNoLimit(): void
    {
        $zone = $this->zone($this->renderTwigComponent('Dropzone', ['multiple' => true])->toString());

        self::assertNull($zone->attr(self::MAX_FILES));
    }

    /**
     * Not a positive integer's digits: no limit at all, and the prop is not passed on as an attribute either. No
     * HostileProps entry covers this prop, so the markup cases also check that no element of theirs (by selector) is
     * in the output: escaped text inside an attribute value is not markup.
     *
     * @return iterable<string, array{mixed, list<string>}>
     */
    public static function notALimit(): iterable
    {
        yield 'zero' => [0, []];
        yield 'zero as text' => ['0', []];
        yield 'negative' => [-1, []];
        yield 'negative as text' => ['-1', []];
        yield 'fraction' => [2.5, []];
        yield 'decimal text' => ['3.0', []];
        yield 'leading space' => [' 3', []];
        yield 'leading zero' => ['03', []];
        yield 'trailing letters' => ['3abc', []];
        // a regular expression's `$` also matches before a final line break: the limit must be the digits alone
        yield 'trailing line break' => ["3\n", []];
        yield 'word' => ['three', []];
        yield 'null' => [null, []];
        yield 'false' => [false, []];
        yield 'list' => [[3], []];
        yield 'markup' => ['<b>3</b>', ['b']];
        yield 'attribute breakout' => ['3" onclick="x', ['[onclick]']];
        yield 'script' => ['3"><script>alert(1)</script>', ['script']];
    }

    /** @param list<string> $absent selectors of the elements the value's markup must not create */
    #[DataProvider('notALimit')]
    public function testAMaxFilesThatIsNotAPositiveIntegerRendersNoLimit(mixed $value, array $absent): void
    {
        $html = $this->renderTwigComponent('Dropzone', ['multiple' => true, 'maxFiles' => $value])->toString();

        $crawler = new Crawler($html);
        self::assertNull($this->zone($html)->attr(self::MAX_FILES));
        self::assertCount(0, $crawler->filter('[maxfiles], [max-files]'), 'maxFiles is a prop, not an attribute to pass on');
        foreach ($absent as $selector) {
            self::assertCount(0, $crawler->filter($selector), "no {$selector} element: {$html}");
        }
    }

    /** Twig writes true as "1", which the digits would accept: a boolean is never a limit. */
    public function testTrueIsNotALimit(): void
    {
        $zone = $this->zone($this->renderTwigComponent('Dropzone', ['multiple' => true, 'maxFiles' => true])->toString());

        self::assertNull($zone->attr(self::MAX_FILES));
    }

    public function testTheFormOptionMaxFilesReachesTheController(): void
    {
        $zone = $this->zone($this->renderForm(['multiple' => true, 'max_files' => 3]));

        self::assertSame('3', $zone->attr(self::MAX_FILES));
    }

    public function testAFormFieldWithoutMaxFilesHasNoLimit(): void
    {
        $zone = $this->zone($this->renderForm(['multiple' => true]));

        self::assertNull($zone->attr(self::MAX_FILES));
    }

    public function testMaxFilesRefusesASubmitOverTheLimitOnTheServer(): void
    {
        $over = $this->submit(['multiple' => true, 'max_files' => 3], 4);
        self::assertFalse($over->isValid());
        self::assertCount(1, $over->getErrors(true));

        self::assertTrue($this->submit(['multiple' => true, 'max_files' => 3], 3)->isValid());
    }

    public function testThePreviewItemBlockBecomesTheControllersTemplate(): void
    {
        $item = '<li class="my-item"><span data-dropzone-slot="filename"></span><button type="button" data-dropzone-slot="remove">x</button></li>';
        $html = $this->renderTwigComponent('Dropzone', ['multiple' => true], null, ['preview_item' => $item])->toString();

        $this->assertTemplateHolds($html, 'my-item');
    }

    /** The component cannot count HTML roots: it renders the block as given, and UX Dropzone refuses it at connect. */
    public function testAPreviewItemBlockWithTwoRootsRendersBothUnwrapped(): void
    {
        $items = '<li class="first-item"></li><li class="second-item"></li>';
        $html = $this->renderTwigComponent('Dropzone', ['multiple' => true], null, ['preview_item' => $items])->toString();

        $this->assertTemplateHoldsBothRoots($html);
    }

    /** Guards the implementation: a block of white space is no block, so the default preview is used. */
    public function testAWhiteSpacePreviewItemBlockIsNoBlock(): void
    {
        $html = $this->renderTwigComponent('Dropzone', ['multiple' => true], null, ['preview_item' => " \n\t "])->toString();

        self::assertCount(0, (new Crawler($html))->filter(self::TEMPLATE));
        $this->zone($html);
    }

    public function testWithoutAPreviewItemThereIsNoTemplate(): void
    {
        $html = $this->renderTwigComponent('Dropzone', ['multiple' => true])->toString();

        self::assertCount(0, (new Crawler($html))->filter(self::TEMPLATE));
    }

    public function testTheFormThemeBlockDropzonePreviewItemBecomesTheControllersTemplate(): void
    {
        $theme = '{% block dropzone_preview_item %}<li class="themed-item"><span data-dropzone-slot="filename"></span></li>{% endblock %}';

        $this->assertTemplateHolds($this->renderForm(['multiple' => true], $theme), 'themed-item');
    }

    public function testAFormThemeBlockWithTwoRootsRendersBothUnwrapped(): void
    {
        $theme = '{% block dropzone_preview_item %}<li class="first-item"></li><li class="second-item"></li>{% endblock %}';

        $this->assertTemplateHoldsBothRoots($this->renderForm(['multiple' => true], $theme));
    }

    /** Guards the implementation: a form-theme block of white space is no block. */
    public function testAWhiteSpaceFormThemeBlockIsNoBlock(): void
    {
        $html = $this->renderForm(['multiple' => true], "{% block dropzone_preview_item %} \n\t {% endblock %}");

        self::assertCount(0, (new Crawler($html))->filter(self::TEMPLATE));
        $this->zone($html);
    }

    public function testUxDropzonesOwnTemplateBlockIsNotRead(): void
    {
        $theme = '{% block dropzone_preview_item_template %}<template data-symfony--ux-dropzone--dropzone-target="previewItemTemplate"><li class="upstream-item"></li></template>{% endblock %}';
        $html = $this->renderForm(['multiple' => true], $theme);

        self::assertStringNotContainsString('upstream-item', $html);
        self::assertCount(0, (new Crawler($html))->filter(self::TEMPLATE));
    }

    private function assertTemplateHolds(string $html, string $class): void
    {
        $root = $this->templateContent($html);
        self::assertCount(1, $root->filter('body > *'), 'the template holds one root element: '.$root->html());
        self::assertCount(1, $root->filter('body > .'.$class), $root->html());
    }

    /** The one template target, inside the controller's element and nowhere else: its content, under a body. */
    private function templateContent(string $html): Crawler
    {
        $crawler = new Crawler($html);
        $templates = $crawler->filter(self::CONTROLLER.' '.self::TEMPLATE);
        self::assertCount(1, $templates, 'one template target, inside the controller\'s element');
        self::assertCount(1, $crawler->filter(self::TEMPLATE), 'and none elsewhere');
        // the template's content is a fragment: read it as markup
        $content = trim((string) preg_replace('/^<template[^>]*>|<\/template>$/', '', trim($templates->outerHtml())));

        return new Crawler('<body>'.$content.'</body>');
    }

    /** Two roots, rendered as given: both, in order, neither wrapped nor dropped (UX Dropzone refuses them at connect). */
    private function assertTemplateHoldsBothRoots(string $html): void
    {
        $root = $this->templateContent($html);
        self::assertCount(2, $root->filter('body > *'), 'both roots, unwrapped: '.$root->html());
        self::assertSame(['first-item', 'second-item'], $root->filter('body > li')->each(static fn (Crawler $item): string => (string) $item->attr('class')));
    }

    private function zone(string $html): Crawler
    {
        $zone = (new Crawler($html))->filter(self::CONTROLLER);
        self::assertCount(1, $zone, 'one element runs the UX Dropzone controller');

        return $zone;
    }

    /** @param array<string, mixed> $options */
    private function renderForm(array $options, string $theme = ''): string
    {
        $form = self::getContainer()->get('form.factory')->createNamed('upload', DropzoneType::class, null, $options);
        $twig = self::getContainer()->get('twig');
        $source = '{{ form_widget(form) }}';
        if ('' !== $theme) {
            // an app's own form theme: a template of its own, on a namespace of the test's
            $directory = sys_get_temp_dir().'/dropzone-theme-'.bin2hex(random_bytes(6));
            mkdir($directory);
            file_put_contents($directory.'/theme.html.twig', $theme);
            $this->files[] = $directory.'/theme.html.twig';
            $this->directories[] = $directory;
            $loader = $twig->getLoader();
            $filesystem = $loader instanceof ChainLoader
                ? array_values(array_filter($loader->getLoaders(), static fn ($inner) => $inner instanceof FilesystemLoader))[0]
                : $loader;
            self::assertInstanceOf(FilesystemLoader::class, $filesystem);
            $filesystem->addPath($directory, 'DropzoneTest');
            $source = "{% form_theme form '@DropzoneTest/theme.html.twig' %}".$source;
        }

        return $twig->createTemplate($source)->render(['form' => $form->createView()]);
    }

    /**
     * @param array<string, mixed> $options
     *
     * @return FormInterface<mixed>
     */
    private function submit(array $options, int $count): FormInterface
    {
        $form = self::getContainer()->get('form.factory')->createNamed('upload', DropzoneType::class, null, ['csrf_protection' => false] + $options);
        $files = [];
        for ($i = 0; $i < $count; ++$i) {
            $path = (string) tempnam(sys_get_temp_dir(), 'dropzone-');
            file_put_contents($path, "file {$i}\n");
            $this->files[] = $path;
            $files[] = new UploadedFile($path, "file-{$i}.txt", 'text/plain', null, true);
        }
        $form->submit($files);

        return $form;
    }
}
