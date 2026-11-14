<?php

namespace App\Tests\Dropzone;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\Form\AbstractTypeExtension;
use Symfony\Component\Form\FormFactory;
use Symfony\Component\Form\FormFactoryInterface;
use Symfony\Component\Form\FormInterface;
use Symfony\Component\Form\FormRegistry;
use Symfony\Component\Form\FormView;
use Symfony\Component\Form\PreloadedExtension;
use Symfony\Component\Form\ResolvedFormTypeFactory;
use Symfony\Contracts\Translation\TranslatableInterface;
use Symfony\Contracts\Translation\TranslatorInterface;
use Symfony\UX\Dropzone\Form\DropzoneType;
use Symfony\UX\TwigComponent\Test\InteractsWithTwigComponents;

/**
 * The main line of a Dropzone (the placeholder above the hint) through the form widget. An explicit `placeholder: false`
 * on a `DropzoneType` shows no main line; a field that says nothing about it keeps the kit's default phrase, custom
 * `attr` or not, so existing forms stay as they are (UX Dropzone 3.7's own theme would drop the line for a field with
 * custom `attr`). The file input stays named by its label, which the main line never was.
 */
final class DropzonePlaceholderTest extends KernelTestCase
{
    use InteractsWithTwigComponents;

    private const DEFAULT_PHRASE = 'Drag and drop or browse';

    public function testPlaceholderFalseShowsNoMainLine(): void
    {
        $zone = $this->renderField(['placeholder' => false]);

        self::assertSame([], $this->mainLines($zone));
    }

    public function testPlaceholderFalseWithCustomAttrShowsNoMainLine(): void
    {
        $zone = $this->renderField(['placeholder' => false, 'attr' => ['accept' => 'image/png']]);

        self::assertSame([], $this->mainLines($zone));
        self::assertSame('image/png', $zone->filter('input[type="file"]')->attr('accept'));
    }

    public function testAFieldSayingNothingKeepsTheDefaultPhrase(): void
    {
        self::assertSame([self::DEFAULT_PHRASE], $this->mainLines($this->renderField([])));
    }

    /** UX Dropzone 3.7 resolves this field's placeholder to false; the kit keeps its default phrase for it. */
    public function testAFieldWithCustomAttrAndNoPlaceholderKeepsTheDefaultPhrase(): void
    {
        self::assertSame([self::DEFAULT_PHRASE], $this->mainLines($this->renderField(['attr' => ['accept' => 'image/png']])));
    }

    public function testAPlaceholderIsTheMainLine(): void
    {
        self::assertSame(['Drop a photo'], $this->mainLines($this->renderField(['placeholder' => 'Drop a photo'])));
    }

    /** UX Dropzone 3.7 deprecates the placeholder in `attr` but still uses it. */
    public function testThePlaceholderInAttrIsStillTheMainLine(): void
    {
        $this->expectUserDeprecationMessage('Since symfony/ux-dropzone 3.7: Passing the placeholder in the "attr" option of "Symfony\UX\Dropzone\Form\DropzoneType" is deprecated, use the "placeholder" option instead.');

        self::assertSame(['Drop a photo'], $this->mainLines($this->renderField(['attr' => ['placeholder' => 'Drop a photo']])));
    }

    /** Guards the change, green before it: a translatable placeholder is the main line, translated. */
    public function testATranslatablePlaceholderIsTheMainLineTranslated(): void
    {
        $placeholder = new class implements TranslatableInterface {
            public function trans(TranslatorInterface $translator, ?string $locale = null): string
            {
                return 'Déposez une photo';
            }
        };

        self::assertSame(['Déposez une photo'], $this->mainLines($this->renderField(['placeholder' => $placeholder])));
    }

    /** @return iterable<string, array{bool}> */
    public static function consumerExtensionOrders(): iterable
    {
        yield "the app's extension before the kit's" => [true];
        yield "the app's extension after the kit's" => [false];
    }

    /**
     * An app's own extension of DropzoneType, registered before or after the kit's: the kit's still works, and the app's
     * sees the options UX Dropzone resolves (the placeholder, the attr) and keeps what it adds to the view.
     */
    #[DataProvider('consumerExtensionOrders')]
    public function testAnAppsOwnExtensionOfDropzoneTypeAndTheKitsWorkSideBySide(bool $appFirst): void
    {
        $seen = self::seen();
        $factory = $this->factoryWithAppExtension($seen, $appFirst);

        $none = $this->mainLines($this->renderField(['placeholder' => false], $factory, 'off'));
        self::assertSame([], $none, 'placeholder false: no main line');
        self::assertFalse(self::sawFor($seen, 'off')['placeholder'], 'the app sees placeholder false as passed');

        $attrOnly = $this->renderField(['attr' => ['accept' => 'image/png']], $factory, 'attr_only');
        self::assertSame([self::DEFAULT_PHRASE], $this->mainLines($attrOnly), 'custom attr, nothing said: the default phrase');
        self::assertFalse(self::sawFor($seen, 'attr_only')['placeholder'], 'the app sees the placeholder UX Dropzone resolves for custom attr');
        self::assertSame(['accept' => 'image/png'], self::sawFor($seen, 'attr_only')['attr'], 'the app sees the attr as given');
        self::assertSame('kept', $attrOnly->filter('input[type="file"]')->attr('data-app'), "what the app adds to the view reaches the input");

        self::assertSame([self::DEFAULT_PHRASE], $this->mainLines($this->renderField([], $factory, 'plain')));
        self::assertSame(self::DEFAULT_PHRASE, self::sawFor($seen, 'plain')['placeholder'], "the app sees UX Dropzone's default phrase");
    }

    /** An empty placeholder is no text: no main line, as today. */
    public function testAnEmptyPlaceholderShowsNoMainLine(): void
    {
        self::assertSame([], $this->mainLines($this->renderField(['placeholder' => ''])));
    }

    /** Without the main line, the box keeps its icon, and the input keeps its name: the field's label, as always. */
    public function testWithoutAMainLineTheInputIsStillNamedByItsLabel(): void
    {
        $form = self::getContainer()->get('form.factory')->createNamed('upload', DropzoneType::class, null, ['placeholder' => false, 'label' => 'Photo']);
        $row = new Crawler(self::getContainer()->get('twig')->createTemplate('{{ form_row(form) }}')->render(['form' => $form->createView()]));

        $input = $row->filter('input[type="file"]');
        self::assertCount(1, $input);
        $id = (string) $input->attr('id');
        self::assertNotSame('', $id);
        self::assertSame('Photo', trim(str_replace('*', '', $row->filter(\sprintf('label[for="%s"]', $id))->text(''))));
        self::assertNull($input->attr('aria-labelledby'), 'named by its label, not by a line of the box');
        self::assertCount(1, $row->filter('[data-symfony--ux-dropzone--dropzone-target="placeholder"] svg'), 'the icon stays');
    }

    /**
     * The component's side of the contract: a `placeholder` prop of false (what the widget passes for `placeholder:
     * false`) shows no main line, and the box keeps its icon and its hint.
     */
    public function testTheComponentWithPlaceholderFalseKeepsItsIconAndHint(): void
    {
        $zone = new Crawler($this->renderTwigComponent('Dropzone', ['id' => 'photo', 'placeholder' => false, 'hint' => 'PNG, up to 1 MB'])->toString());

        self::assertSame([], $this->mainLines($zone));
        self::assertCount(1, $zone->filter('[data-symfony--ux-dropzone--dropzone-target="placeholder"] svg'));
        self::assertSame('PNG, up to 1 MB', trim($zone->filter('#photo_hint')->text('')));
        self::assertSame('photo_hint', $zone->filter('input[type="file"]')->attr('aria-describedby'));
    }

    /**
     * The text of the box's main lines: its lines before a pick, but the hint and the reselect note.
     *
     * @return list<string>
     */
    private function mainLines(Crawler $zone): array
    {
        $box = $zone->filter('[data-symfony--ux-dropzone--dropzone-target="placeholder"]');
        self::assertCount(1, $box, 'one box before a pick');

        return array_values(array_filter(
            $box->filter('p')->each(static fn (Crawler $line): ?string => preg_match('/_(?:hint|reselect)$/', (string) $line->attr('id')) ? null : trim($line->text())),
            static fn (?string $text): bool => null !== $text,
        ));
    }

    /**
     * What the app's extension saw for one field, which it must have seen.
     *
     * @param \ArrayObject<string, array{placeholder: mixed, attr: mixed}> $seen
     *
     * @return array{placeholder: mixed, attr: mixed}
     */
    private static function sawFor(\ArrayObject $seen, string $name): array
    {
        $entry = $seen[$name] ?? null;
        self::assertNotNull($entry, "the app's extension built the view of {$name}");

        return $entry;
    }

    /** @return \ArrayObject<string, array{placeholder: mixed, attr: mixed}> what the app's extension saw, per field */
    private static function seen(): \ArrayObject
    {
        return new \ArrayObject();
    }

    /** @param array<string, mixed> $options */
    private function renderField(array $options, ?FormFactoryInterface $factory = null, string $name = 'upload'): Crawler
    {
        $form = ($factory ?? self::getContainer()->get('form.factory'))->createNamed($name, DropzoneType::class, null, $options);

        return new Crawler(self::getContainer()->get('twig')->createTemplate('{{ form_widget(form) }}')->render(['form' => $form->createView()]));
    }

    /**
     * The demo's form factory with an app's own DropzoneType extension added before or after the extensions the
     * container registers (the kit's among them); it records the options it sees per field and adds `data-app`.
     *
     * @param \ArrayObject<string, array{placeholder: mixed, attr: mixed}> $seen
     */
    private function factoryWithAppExtension(\ArrayObject $seen, bool $appFirst): FormFactoryInterface
    {
        $app = new class($seen) extends AbstractTypeExtension {
            /** @param \ArrayObject<string, array{placeholder: mixed, attr: mixed}> $seen */
            public function __construct(private readonly \ArrayObject $seen)
            {
            }

            public static function getExtendedTypes(): iterable
            {
                return [DropzoneType::class];
            }

            public function buildView(FormView $view, FormInterface $form, array $options): void
            {
                $this->seen[$form->getName()] = ['placeholder' => $options['placeholder'], 'attr' => $options['attr']];
                $view->vars['attr']['data-app'] = 'kept';
            }
        };
        $container = self::getContainer()->get('form.extension');
        $preloaded = new PreloadedExtension([], [DropzoneType::class => [$app]]);

        return new FormFactory(new FormRegistry($appFirst ? [$preloaded, $container] : [$container, $preloaded], new ResolvedFormTypeFactory()));
    }
}
