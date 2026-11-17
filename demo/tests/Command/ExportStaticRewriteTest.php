<?php

namespace App\Tests\Command;

use App\Command\ExportStaticCommand;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The static export's rewriting of each page (ExportStaticCommand::rewrite()): a PCRE error, such as its backtrack
 * limit on a large page, fails the export naming the step, where it gave null and the export saved an empty page or
 * left the page unrewritten.
 *
 * The patterns are linear (PCRE makes their repeats possessive), so no realistic page reaches the backtrack limit; a
 * PCRE error still gives null, and must not be saved. Each case turns PCRE's JIT off and sets the backtrack limit to 1,
 * so any match attempt fails, and gives a page that only the step's own pattern starts an attempt on: the steps before
 * it lack their first or a required character in it, start no attempt and pass.
 */
final class ExportStaticRewriteTest extends TestCase
{
    /**
     * @return iterable<string, array{\Closure(): string, string, string}>
     */
    public static function failingSteps(): iterable
    {
        yield 'the preview links' => [static fn (): string => ExportStaticCommand::rewrite('<a href="/preview/a/b?theme=dark">', '/uxor', '/'), 'rewrite the preview links', '/'];
        // no '/': the preview links' pattern starts no attempt
        yield 'the Live controllers' => [static fn (): string => ExportStaticCommand::rewrite('<div data-controller="live x">', '/uxor', '/r/x'), "remove Live's controller", '/r/x'];
        // no '=', which the preview links' pattern requires, and no 'd': only the asset pattern starts
        yield 'the asset URLs' => [static fn (): string => ExportStaticCommand::rewrite('"/assets/a.js"', '/uxor', '/r/x'), 'prefix the asset URLs', '/r/x'];
        // no '/', no quote (which the Live pattern requires): only the notice's pattern after <body>, on a /demo page
        yield 'the demo notice after <body>' => [static fn (): string => ExportStaticCommand::rewrite('<body>', '/uxor', '/demo/x'), 'add the demo notice', '/demo/x'];
        // `id="main"` holds a 'd', where the Live pattern would start: the notice before <main>, on its own
        yield 'the demo notice before <main>' => [static fn (): string => ExportStaticCommand::addDemoNotice('<main id="main">', '/uxor', '/demo/x'), 'add the demo notice', '/demo/x'];
    }

    /**
     * @param \Closure(): string $export
     */
    #[DataProvider('failingSteps')]
    public function testAPcreErrorFailsTheExportNamingTheStep(\Closure $export, string $step, string $path): void
    {
        $limit = ini_get('pcre.backtrack_limit');
        $jit = ini_get('pcre.jit');
        ini_set('pcre.jit', '0');
        ini_set('pcre.backtrack_limit', '1');
        try {
            $export();
            self::fail(\sprintf('no exception: the step "%s" passed a PCRE error on', $step));
        } catch (\RuntimeException $exception) {
            self::assertSame(\sprintf('The static export could not %s on %s: Backtrack limit exhausted.', $step, $path), $exception->getMessage());
        } finally {
            ini_set('pcre.backtrack_limit', (string) $limit);
            ini_set('pcre.jit', (string) $jit);
        }
    }

    public function testAPageIsRewrittenAsBeforeWithinTheLimit(): void
    {
        $html = '<html><body><main id="main"><a href="/uxor/preview/button/default?theme=dark&amp;page=2">x</a>'
            .'<div data-controller="live other"></div><script src="/assets/app.js"></script></main></body></html>';

        self::assertSame(
            '<html><body><div class="border-b border-default bg-neutral-secondary-medium px-4 py-2 text-center text-sm text-body">A static copy of the demo application: its forms do not submit. <a href="/uxor/" class="underline hover:text-heading">Back to the gallery</a></div><main id="main"><a href="/uxor/preview/button/default/dark/?page=2">x</a>'
            .'<div data-controller="other"></div><script src="/uxor/assets/app.js"></script></main></body></html>',
            ExportStaticCommand::rewrite($html, '/uxor', '/demo'),
        );
    }
}
