<?php

namespace App\Tests\Functional;

use App\Kit\DocKitRef;
use App\Kit\KitReader;
use App\Kit\RecipeDocs;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\UX\Toolkit\Recipe\Recipe;

/**
 * A recipe's documentation rendered by the UX Toolkit's RecipeDocRenderer (App\Kit\RecipeDocs), on a component with
 * declared props and blocks (badge) and on a recipe whose examples need the server (data-table), then on every
 * recipe: the README's prose and examples, the install step at a release, the API tables from the template's
 * declarations, and portable Markdown with no directive left for its reader.
 */
final class RecipeDocsTest extends KernelTestCase
{
    private static function docs(): RecipeDocs
    {
        $container = static::getContainer();

        return new RecipeDocs($container->get(KitReader::class), $container->get('twig'), $container->get(UrlGeneratorInterface::class), $container->get(DocKitRef::class));
    }

    private static function kit(): KitReader
    {
        return static::getContainer()->get(KitReader::class);
    }

    private static function recipe(string $name): Recipe
    {
        return self::kit()->getRecipe($name) ?? throw new \LogicException(\sprintf('No recipe "%s" in the kit.', $name));
    }

    private static function source(string $path): string
    {
        return (string) file_get_contents(\dirname(__DIR__, 3).'/'.$path);
    }

    public function testTheReadmeIsRenderedWithEveryHeadingAndExampleInPlace(): void
    {
        $recipe = self::recipe('badge');
        $html = self::docs()->html($recipe, '0.3.0')->html;

        preg_match_all('/^#{1,3} (.+)$/m', (string) preg_replace('/^```.*?^```$/ms', '', self::source('badge/README.md')), $headings);
        self::assertNotEmpty($headings[1]);
        foreach ($headings[1] as $heading) {
            self::assertStringContainsString('>'.htmlspecialchars($heading, \ENT_QUOTES).'</h', $html, $heading);
        }

        // each example is the gallery's preview page, in both themes
        $examples = self::kit()->getExamples($recipe);
        self::assertCount(\count($examples), $previews = array_filter($examples, fn (array $example): bool => true === ($example['options']['preview'] ?? null)));
        self::assertSame(\count($previews), substr_count($html, 'data-testid="example"'));
        foreach ($previews as $example) {
            foreach (['light', 'dark'] as $theme) {
                self::assertStringContainsString(\sprintf('src="/preview/badge/%s?theme=%s"', $example['id'], $theme), $html);
            }
        }

        // the tabs of every example, and of the install step, have ids of their own
        preg_match_all('/(?<![\w-])id="([^"]+)"/', $html, $ids);
        self::assertSame(array_unique($ids[1]), $ids[1], 'every id on the page is unique');
    }

    public function testTheApiTablesListTheTemplatesDeclaredPropsWithTheirDescriptions(): void
    {
        $html = self::docs()->html(self::recipe('badge'), '0.3.0')->html;

        // the {% props %} declaration: `## <type> <description>` over each `name = default`
        preg_match_all('/^\h*## (\S+) (.+)\R\h*(\w+) = (.+?),?$/m', self::source('badge/templates/components/Badge.html.twig'), $props, \PREG_SET_ORDER);
        self::assertNotEmpty($props);
        foreach ($props as [, $type, $description, $name, $default]) {
            $row = \sprintf('<td align="left"><code>%s</code></td>', $name);
            self::assertStringContainsString($row, $html, $name);
            $cells = substr($html, (int) strpos($html, $row), 1000);
            self::assertStringContainsString(htmlspecialchars($type, \ENT_NOQUOTES), $cells, $name);
            self::assertStringContainsString(htmlspecialchars($default, \ENT_NOQUOTES), $cells, $name);
            // printed in its own column, not hidden in a popover
            self::assertStringContainsString('<td align="left">'.(string) preg_replace('/`([^`]+)`/', '<code>$1</code>', htmlspecialchars($description, \ENT_COMPAT)).'</td>', $cells, $name);
        }
        self::assertStringContainsString('<code>content</code>', $html, 'the documented block');
        self::assertStringNotContainsString('toolkit-popover', $html);
    }

    public function testTheInstallStepNamesTheRelease(): void
    {
        $docs = self::docs();
        $recipe = self::recipe('badge');

        self::assertStringContainsString('ux:install badge --kit=https://github.com/xormania/uxor:0.3.0', $docs->html($recipe, '0.3.0')->html);
        self::assertStringContainsString("```shell\nphp bin/console ux:install badge --kit=https://github.com/xormania/uxor:0.3.0\n```", $docs->markdown($recipe, '0.3.0'));
        // the dev server's pages install the default branch, as the gallery's own install block does there
        self::assertStringContainsString("ux:install badge --kit=https://github.com/xormania/uxor\n</code>", $docs->html($recipe)->html);
        self::assertNull(static::getContainer()->get(DocKitRef::class)->get(), 'the ref holds for one render only');
    }

    public function testARecipeThatNeedsTheServerKeepsItsProseAndItsPreview(): void
    {
        $docs = self::docs();
        $recipe = self::recipe('data-table');
        $html = $docs->html($recipe, '0.3.0')->html;
        $markdown = $docs->markdown($recipe, '0.3.0');

        self::assertStringContainsString('<h3 id="what-you-can-override">What you can override</h3>', $html);
        self::assertStringContainsString('src="/preview/data-table/default?theme=light"', $html);
        // the README's own account of the server round trips, in both formats
        foreach (['## Usage', '### What you can override', '### URL and history'] as $heading) {
            self::assertStringContainsString($heading, $markdown);
        }
    }

    public function testABinaryFileIsNamedInTheManualStepNotPrinted(): void
    {
        $html = self::docs()->html(self::recipe('oauth'), '0.3.0')->html;

        self::assertStringContainsString('<code>assets/images/uxor-oauth-google-light.png</code> (binary: copy it from the recipe', $html);
        self::assertStringNotContainsString("\x89PNG", $html);
    }

    public function testEveryRecipeRendersWithEachExamplePreviewedAndNoDirectiveLeft(): void
    {
        foreach (array_keys(self::kit()->getRecipes()) as $name) {
            // a kernel per recipe: in the test environment's debug mode, the Twig profiler and the components' logger
            // keep every render until the kernel goes, which for every recipe leaves the rest of the suite too little
            // memory (app:export-static renders without debug)
            self::ensureKernelShutdown();
            $docs = self::docs();
            $recipe = self::recipe($name);
            $html = $docs->html($recipe, '0.3.0')->html;
            $markdown = $docs->markdown($recipe, '0.3.0');

            $previews = array_filter(self::kit()->getExamples($recipe), fn (array $example): bool => true === ($example['options']['preview'] ?? null));
            self::assertSame(\count($previews), substr_count($html, 'data-testid="example"'), "$name: every example has its preview page");
            self::assertDoesNotMatchRegularExpression('/^:{2,3} /m', $html, "$name: no directive left in HTML");
            // what can scroll sideways can take the focus (axe: scrollable-region-focusable)
            self::assertDoesNotMatchRegularExpression('/<pre(?![^>]*\btabindex="0")/', $html, "$name: every code block focusable");
            self::assertSame(substr_count($html, '<table>'), substr_count($html, '<div class="recipe-doc-table" tabindex="0"><table>'), "$name: every table in a focusable box");
            self::assertDoesNotMatchRegularExpression('/^:{2,3} /m', $markdown, "$name: no directive left in Markdown");
            self::assertDoesNotMatchRegularExpression('/^```\S+\h+\{/m', $markdown, "$name: no render metadata in Markdown");
            self::assertStringNotContainsString('--kit '.basename(\dirname(__DIR__, 3)), $markdown, "$name: never Toolkit's own install line");
            if (str_contains((string) $recipe->doc, '::: installation')) {
                self::assertStringContainsString("ux:install $name --kit=https://github.com/xormania/uxor:0.3.0", $markdown, $name);
            }
        }
    }
    public function testAReadmesLinksToOtherReadmesLandOnTheirRecipePagesAndMarkdown(): void
    {
        $html = [];
        foreach (array_keys(self::kit()->getRecipes()) as $name) {
            self::ensureKernelShutdown(); // as in the test above: a kernel per recipe
            $html[$name] = self::docs()->html(self::recipe($name), '0.3.0')->html;
        }

        $links = 0;
        foreach ($html as $name => $page) {
            preg_match_all('/<a href="([^"]*)"/', $page, $hrefs);
            foreach ($hrefs[1] as $href) {
                self::assertMatchesRegularExpression('#^(?:[a-z][a-z0-9+.-]*:|/|\#)#i', $href, "$name: no link left relative to the repository");
                if (preg_match('#^/r/([a-z0-9-]+)(?:\#(.+))?$#', $href, $target)) {
                    ++$links;
                    self::assertArrayHasKey($target[1], $html, "$name links $href");
                    if (isset($target[2])) {
                        self::assertStringContainsString(\sprintf('id="%s"', $target[2]), $html[$target[1]], "$name links $href: the heading exists");
                    }
                }
            }
        }
        self::assertGreaterThanOrEqual(10, $links, 'the READMEs link each other (button to spinner, navbar to nav-menu, ...)');

        // the same links in the portable Markdown, saved beside the other recipes' (r/<recipe>.md), outside code blocks
        foreach (array_keys($html) as $name) {
            self::ensureKernelShutdown();
            $markdown = (string) preg_replace('/^(`{3,}).*?^\1\h*$/ms', '', self::docs()->markdown(self::recipe($name), '0.3.0'));
            preg_match_all('/\]\(([^)\s]*)\)/', $markdown, $targets);
            foreach ($targets[1] as $target) {
                if (!preg_match('#^(?:[a-z][a-z0-9+.-]*:|/|\#)#i', $target)) {
                    self::assertMatchesRegularExpression('/^[a-z0-9-]+\.md(?:#[a-z0-9-]+)?$/', $target, "$name: a relative link is another recipe's Markdown");
                    self::assertArrayHasKey((string) strstr($target, '.md', true), $html, "$name links $target");
                }
            }
        }
        self::assertStringContainsString('<a href="/r/spinner">spinner component</a>', $html['button']);
        self::assertStringContainsString('<a href="/r/layouts#back-and-forms">', $html['calendar']);
    }
}
