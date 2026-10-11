<?php

namespace App\Tests\Editor;

use App\UXor\Editor\EditorHtmlPolicy;
use App\UXor\Editor\EditorType;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Form\FormInterface;

/**
 * EditorType's limits on a submit: `max_bytes` counts the bytes of the HTML sent, before sanitizing; `max_chars` the
 * characters of the sanitized text, an entity as one. Empty HTML is null. A refused submit keeps what was sent, so the
 * form shows it again with its error. The blank and 200-character errors of a whole form are lab.editor's.
 */
final class EditorTypeTest extends WebTestCase
{
    /**
     * @param array<string, mixed> $options
     *
     * @return FormInterface<string|null>
     */
    private static function submit(?string $html, array $options = []): FormInterface
    {
        $form = self::getContainer()->get('form.factory')->createNamed('body', EditorType::class, null, $options);
        $form->submit($html);

        return $form;
    }

    public function testMaxCharsCountsCharactersOfTextNotBytes(): void
    {
        // 5 characters, 10 bytes of text, 17 of HTML
        $form = self::submit('<p>ééééé</p>', ['max_chars' => 5, 'max_bytes' => 17]);

        self::assertTrue($form->isValid());
        self::assertSame('<p>ééééé</p>', $form->getData());
    }

    public function testOneCharacterOverMaxCharsIsRefused(): void
    {
        $form = self::submit('<p>éééééé</p>', ['max_chars' => 5]);

        self::assertFalse($form->isValid());
        self::assertSame('This text is too long: it holds more than 5 characters.', $form->getErrors()->current()->getMessage());
    }

    public function testAnEntityIsOneCharacter(): void
    {
        self::assertTrue(self::submit('<p>&amp;&lt;&gt;&quot;&nbsp;</p>', ['max_chars' => 5])->isValid());
    }

    public function testMaxCharsCountsTheTextLeftAfterSanitizing(): void
    {
        $form = self::submit('<p>abc</p><script>far more than five characters</script>', ['max_chars' => 5]);

        self::assertTrue($form->isValid());
        self::assertSame('<p>abc</p>', $form->getData());
    }

    public function testMaxBytesCountsTheBytesSentBeforeSanitizing(): void
    {
        $html = '<p>a</p><script>x()</script>';  // 8 bytes once sanitized, 28 sent

        self::assertTrue(self::submit($html, ['max_bytes' => 28])->isValid());
        // bytes, not characters: 17 bytes, 12 characters
        self::assertFalse(self::submit('<p>ééééé</p>', ['max_bytes' => 16])->isValid());
        $form = self::submit($html, ['max_bytes' => 27]);
        self::assertFalse($form->isValid());
        self::assertSame('This text is too long: it holds more than 27 bytes of formatting and text.', $form->getErrors()->current()->getMessage());
    }

    public function testNothingSentOrNoTextIsNull(): void
    {
        foreach ([null, '', '<p></p>', '<p> </p><script>x()</script>'] as $html) {
            $form = self::submit($html);
            self::assertTrue($form->isValid());
            self::assertNull($form->getData(), var_export($html, true));
        }
    }

    public function testARefusedSubmitKeepsWhatWasSent(): void
    {
        $html = '<p>éééééé <b>bold</b></p><script>x()</script>';

        $form = self::submit($html, ['max_chars' => 5]);

        self::assertFalse($form->isValid());
        self::assertNull($form->getData());
        // nothing is cut or sanitized away: the widget prints it through flowbite_editor_html
        self::assertSame($html, $form->getViewData());
        self::assertSame($html, $form->createView()->vars['value']);
    }

    public function testLinesBetweenBlocksAreNotCharacters(): void
    {
        // the editor's counter shows 4 / 4
        $form = self::submit("<p>ab</p>\r\n<p>cd</p>", ['max_chars' => 4]);

        self::assertCount(0, $form->getErrors());
    }

    public function testAFormRefusingMoreThanThePolicyReadsShowsItsError(): void
    {
        $client = static::createClient();
        $client->catchExceptions(false);
        $form = $client->request('GET', '/lab/editor-turbo')->selectButton('Publish')->form();
        $values = $form->getPhpValues();
        $values['editor_demo']['body'] = '<p>'.str_repeat('a', EditorHtmlPolicy::MAX_INPUT_BYTES).'</p>';

        $client->request('POST', '/lab/editor-turbo', $values);

        self::assertResponseStatusCodeSame(422);
        self::assertSelectorTextContains('#editor_demo_body_error', 'bytes of formatting and text');
    }
}
