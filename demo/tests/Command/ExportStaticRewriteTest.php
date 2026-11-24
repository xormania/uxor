<?php

namespace App\Tests\Command;

use App\Command\ExportStaticCommand;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
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
 *
 * PCRE's JIT does not count small backtrack limits, and a pattern compiled with JIT on keeps its JIT code in PHP's
 * pattern cache when pcre.jit is turned off later: a case run after any test that rewrote a page (this class's healthy
 * case, DemoExportTest) would match and pass no error. So each case runs in its own PHP process, where JIT is
 * off before any of the export's patterns is compiled.
 */
final class ExportStaticRewriteTest extends TestCase
{
    /**
     * @return iterable<string, array{'rewrite'|'addDemoNotice', string, string, string}>
     */
    public static function failingSteps(): iterable
    {
        yield 'the preview links' => ['rewrite', '<a href="/preview/a/b?theme=dark">', '/', 'rewrite the preview links'];
        // no '/': the preview links' pattern starts no attempt
        yield 'the Live controllers' => ['rewrite', '<div data-controller="live x">', '/r/x', "remove Live's controller"];
        // no '=', which the preview links' pattern requires, and no 'd': only the asset pattern starts
        yield 'the asset URLs' => ['rewrite', '"/assets/a.js"', '/r/x', 'prefix the asset URLs'];
        // no '/', no quote (which the Live pattern requires): only the notice's pattern after <body>, on a /demo page
        yield 'the demo notice after <body>' => ['rewrite', '<body>', '/demo/x', 'add the demo notice'];
        // `id="main"` holds a 'd', where the Live pattern would start: the notice before <main>, on its own
        yield 'the demo notice before <main>' => ['addDemoNotice', '<main id="main">', '/demo/x', 'add the demo notice'];
    }

    /**
     * @param 'rewrite'|'addDemoNotice' $method
     */
    #[DataProvider('failingSteps')]
    #[RunInSeparateProcess]
    public function testAPcreErrorFailsTheExportNamingTheStep(string $method, string $html, string $path, string $step): void
    {
        // restored before PHPUnit's own patterns run in this process (TestDox names the test with preg_replace): at a
        // limit of 1 they fail too, and PHPUnit asserts that they did not
        $limit = ini_get('pcre.backtrack_limit');
        $jit = ini_get('pcre.jit');
        try {
            ini_set('pcre.jit', '0');
            ini_set('pcre.backtrack_limit', '1');
            self::assertSame('0', ini_get('pcre.jit'));
            ExportStaticCommand::$method($html, '/uxor', $path);
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
