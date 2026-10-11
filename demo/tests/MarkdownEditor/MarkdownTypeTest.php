<?php

namespace App\Tests\MarkdownEditor;

use App\UXor\MarkdownEditor\MarkdownRenderer;
use App\UXor\MarkdownEditor\MarkdownType;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Form\FormInterface;

/**
 * MarkdownType's limits on a submit: Windows line breaks become `\n` first, then `max_bytes` counts bytes and
 * `max_chars` characters (a line break is one, as the counter shows it). Blank Markdown is null. A refused submit keeps
 * what was sent, so the form shows it again with its error, longer than the renderer reads included. The blank and
 * 200-character errors of a whole form are lab.markdown-editor's.
 */
final class MarkdownTypeTest extends WebTestCase
{
    /**
     * @param array<string, mixed> $options
     *
     * @return FormInterface<string|null>
     */
    private static function submit(?string $markdown, array $options = []): FormInterface
    {
        $form = self::getContainer()->get('form.factory')->createNamed('body', MarkdownType::class, null, $options);
        $form->submit($markdown);

        return $form;
    }

    public function testMaxCharsCountsCharactersAndMaxBytesBytes(): void
    {
        // 5 characters, 10 bytes
        self::assertTrue(self::submit('ééééé', ['max_chars' => 5, 'max_bytes' => 10])->isValid());

        $chars = self::submit('éééééé', ['max_chars' => 5]);
        self::assertSame('This text is too long: it holds more than 5 characters.', $chars->getErrors()->current()->getMessage());

        $bytes = self::submit('ééééé', ['max_chars' => 5, 'max_bytes' => 9]);
        self::assertSame('This text is too long: it holds more than 9 bytes.', $bytes->getErrors()->current()->getMessage());
    }

    public function testWindowsLineBreaksAreStoredAndCountedAsOne(): void
    {
        // what a browser submits for "a", a line break, "b": 3 characters and 3 bytes once made `\n`
        $form = self::submit("a\r\nb", ['max_chars' => 3, 'max_bytes' => 3]);

        self::assertTrue($form->isValid());
        self::assertSame("a\nb", $form->getData());
    }

    public function testNothingSentOrBlankIsNull(): void
    {
        foreach ([null, '', " \r\n\t\r\n "] as $markdown) {
            $form = self::submit($markdown);
            self::assertTrue($form->isValid());
            self::assertNull($form->getData(), var_export($markdown, true));
        }
    }

    public function testARefusedSubmitKeepsWhatWasSent(): void
    {
        $markdown = "**éééééé**\r\n<script>x()</script>";

        $form = self::submit($markdown, ['max_chars' => 5]);

        self::assertFalse($form->isValid());
        self::assertNull($form->getData());
        self::assertSame($markdown, $form->getViewData());
        self::assertSame($markdown, $form->createView()->vars['value']);
    }

    public function testAFormRefusingMoreThanTheRendererReadsShowsItsError(): void
    {
        $client = static::createClient();
        $client->catchExceptions(false);
        $form = $client->request('GET', '/lab/markdown-turbo')->selectButton('Publish')->form();
        $values = $form->getPhpValues();
        $values['markdown_demo']['body'] = str_repeat('a', MarkdownRenderer::MAX_INPUT_BYTES + 1);

        $client->request('POST', '/lab/markdown-turbo', $values);

        self::assertResponseStatusCodeSame(422);
        self::assertSelectorTextContains('#markdown_demo_body_error', 'This text is too long: it holds more than 100000 bytes.');
        self::assertSame(MarkdownRenderer::MAX_INPUT_BYTES + 1, \strlen($client->getCrawler()->filter('textarea#markdown_demo_body')->text(normalizeWhitespace: false)));
    }
}
