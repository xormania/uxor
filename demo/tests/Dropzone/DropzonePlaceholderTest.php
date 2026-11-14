<?php

namespace App\Tests\Dropzone;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\DomCrawler\Crawler;
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

    /** @param array<string, mixed> $options */
    private function renderField(array $options): Crawler
    {
        $form = self::getContainer()->get('form.factory')->createNamed('upload', DropzoneType::class, null, $options);

        return new Crawler(self::getContainer()->get('twig')->createTemplate('{{ form_widget(form) }}')->render(['form' => $form->createView()]));
    }
}
