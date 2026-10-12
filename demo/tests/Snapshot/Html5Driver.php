<?php

namespace App\Tests\Snapshot;

use PHPUnit\Framework\Assert;
use Spatie\Snapshots\Driver;

/**
 * Snapshots of HTML fragments as an HTML5 parser reads them (PHP's Dom\HTMLDocument), each fragment ending in a new
 * line. spatie's own HtmlDriver parses with libxml's HTML 4 parser: it lower-cases SVG attributes (`viewBox`), so a
 * change there would not show. Use it with `$this->assertMatchesSnapshot($html, new Html5Driver())`.
 */
final class Html5Driver implements Driver
{
    public function serialize(mixed $data): string
    {
        if (!\is_string($data)) {
            throw new \InvalidArgumentException('An HTML snapshot is a string.');
        }

        $document = \Dom\HTMLDocument::createFromString('<!DOCTYPE html><body>'.$data, \LIBXML_NOERROR);

        return rtrim($document->body->innerHTML ?? '')."\n";
    }

    public function extension(): string
    {
        return 'html';
    }

    public function match(mixed $expected, mixed $actual): void
    {
        Assert::assertSame($expected, $this->serialize($actual));
    }
}
