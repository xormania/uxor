<?php

namespace App\Tests\Editor;

use App\UXor\Editor\EditorHtmlPolicy;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\UX\LiveComponent\Test\InteractsWithLiveComponents;

/**
 * The Editor inside a Live Component (lab's LiveEditor, `data-model` on `body`) through real Live requests: a body
 * longer than EditorHtmlPolicy reads re-renders with the editor and its textarea empty instead of failing, and the
 * longest body it reads is shown whole.
 */
final class LiveEditorTest extends KernelTestCase
{
    use InteractsWithLiveComponents;

    public function testABodyLongerThanThePolicyReadsIsShownEmpty(): void
    {
        $component = $this->createLiveComponent('Lab:LiveEditor', ['body' => '<p>'.str_repeat('a', EditorHtmlPolicy::MAX_INPUT_BYTES).'</p>']);

        $crawler = $component->set('note', 'typed')->render()->crawler();

        self::assertSame('typed', $crawler->filter('[data-testid="note"]')->text());
        self::assertSame('', $crawler->filter('#body')->html());
        self::assertSame('', $crawler->filter('textarea[name="body"]')->text(normalizeWhitespace: false));
    }

    public function testTheLongestBodyThePolicyReadsIsShownWhole(): void
    {
        $body = '<p>'.str_repeat('a', EditorHtmlPolicy::MAX_INPUT_BYTES - 7).'</p>';

        $crawler = $this->createLiveComponent('Lab:LiveEditor', ['body' => $body])->render()->crawler();

        self::assertSame($body, $crawler->filter('#body')->html());
        self::assertSame($body, $crawler->filter('textarea[name="body"]')->text(normalizeWhitespace: false));
    }
}
