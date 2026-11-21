<?php

namespace App\Tests\Functional;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class RevenueAssistantTest extends WebTestCase
{
    private const PATH = '/demo/revenue-assistant';

    /** @return iterable<string, array{string, string}> */
    public static function requests(): iterable
    {
        yield 'week' => ['Show weekly revenue', 'week'];
        yield 'year' => ['SHOW YEARLY REVENUE', 'year'];
        yield 'all time' => ['Show all-time revenue', 'all'];
    }

    #[DataProvider('requests')]
    public function testAFormSubmissionRedirectsToTheRequestedPeriod(string $prompt, string $period): void
    {
        $client = static::createClient();
        $client->request('GET', self::PATH.'?'.http_build_query(['prompt' => $prompt]));

        self::assertResponseRedirects('/demo?revenue='.$period);
        self::assertContains('Accept', $client->getResponse()->getVary());
    }

    public function testAnUnknownFormSubmissionRendersAnExplanation(): void
    {
        $client = static::createClient();
        $client->request('GET', self::PATH.'?prompt=monthly');

        self::assertResponseStatusCodeSame(422);
        self::assertSelectorTextContains('form [role="status"]', 'Choose weekly, yearly or all-time revenue');
    }

    #[DataProvider('requests')]
    public function testAStreamCompletesTheRunWithItsRequestedRevenuePeriod(string $prompt, string $period): void
    {
        $events = $this->requestEvents($prompt);

        self::assertSame(['RUN_STARTED', 'STATE_SNAPSHOT', 'RUN_FINISHED'], array_column($events, 'type'));
        self::assertSame(['revenuePeriod' => $period], $events[1]['snapshot']);
        foreach (['threadId', 'runId'] as $id) {
            self::assertIsString($events[0][$id]);
            self::assertNotSame('', $events[0][$id]);
            self::assertSame($events[0][$id], $events[2][$id]);
        }
    }

    public function testAnUnknownStreamedRequestEndsWithAnError(): void
    {
        $events = $this->requestEvents('Show monthly revenue');

        self::assertSame(['RUN_STARTED', 'RUN_ERROR'], array_column($events, 'type'));
        self::assertStringContainsString('Choose weekly, yearly or all-time revenue', $events[1]['message']);
    }

    /** @return list<array<string, mixed>> */
    private function requestEvents(string $prompt): array
    {
        $client = static::createClient();
        $client->request('GET', self::PATH.'?'.http_build_query(['prompt' => $prompt]), server: ['HTTP_ACCEPT' => 'text/event-stream']);

        self::assertResponseIsSuccessful();
        self::assertStringStartsWith('text/event-stream', (string) $client->getResponse()->headers->get('Content-Type'));
        self::assertContains('Accept', $client->getResponse()->getVary());
        $body = str_replace("\r\n", "\n", $client->getInternalResponse()->getContent());
        self::assertStringEndsWith("\n\n", $body);
        $events = [];
        foreach (explode("\n\n", trim($body)) as $event) {
            self::assertStringStartsWith('data: ', $event);
            $events[] = json_decode(substr($event, 6), true, flags: \JSON_THROW_ON_ERROR);
        }

        return $events;
    }
}
