<?php

namespace UXor\Website\Tests;

/** Published recipe markup, installation instructions, previews and offline Markdown. */
final class RecipeDocsTest extends WebsiteTestCase
{
    public function testTheReadmeIsRenderedWithEveryHeadingAndExampleInPlace(): void
    {
        $recipe = self::kit()->getRecipe('badge');
        self::assertNotNull($recipe);
        $html = self::recipeHtml('badge');

        preg_match_all('/^#{2,3} (.+)$/m', (string) preg_replace('/^```.*?^```$/ms', '', file_get_contents(self::source().'/badge/README.md')), $headings);
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
                self::assertStringContainsString(\sprintf('src="/uxor/preview/badge/%s/%s/"', $example['id'], $theme), $html);
            }
        }

        // the tabs of every example, and of the install step, have ids of their own
        preg_match_all('/(?<![\w-])id="([^"]+)"/', $html, $ids);
        self::assertSame(array_unique($ids[1]), $ids[1], 'every id on the page is unique');
    }

    public function testIdenticalCodeOnlyUsesTheHeadingsOfOptedInPreviews(): void
    {
        $page = \Dom\HTMLDocument::createFromString(self::recipeHtml('duplicate-snippets'), LIBXML_NOERROR);
        $sources = [];
        foreach ($page->querySelectorAll('iframe') as $frame) {
            $sources[] = $frame->getAttribute('src');
        }
        self::assertSame([
            '/uxor/preview/duplicate-snippets/first-preview/light/',
            '/uxor/preview/duplicate-snippets/first-preview/dark/',
            '/uxor/preview/duplicate-snippets/second-preview/light/',
            '/uxor/preview/duplicate-snippets/second-preview/dark/',
        ], $sources);

        $home = \Dom\HTMLDocument::createFromString(self::page('index.html'), LIBXML_NOERROR);
        $card = $home->querySelector('a[href="/uxor/r/duplicate-snippets/"]')?->parentElement;
        self::assertSame('2 live examples', $card?->querySelector('.count')?->textContent);
    }

    public function testTheApiTablesListTheTemplatesDeclaredPropsWithTheirDescriptions(): void
    {
        $dom = \Dom\HTMLDocument::createFromString(self::recipeHtml('badge'), LIBXML_NOERROR);
        $rows = [];
        foreach ($dom->querySelectorAll('[data-testid="recipe-doc"] table tbody tr') as $row) {
            $cells = array_map(static fn ($cell) => $cell->textContent, iterator_to_array($row->querySelectorAll('td')));
            $rows[array_shift($cells)] = $cells;
        }
        $markdown = self::page('r/badge.md');

        // Compare the published reference with the recipe's own {% props %} declarations.
        preg_match_all('/^\h*## (\S+) (.+)\R\h*(\w+) = (.+?),?$/m', file_get_contents(self::source().'/badge/templates/components/Badge.html.twig'), $props, \PREG_SET_ORDER);
        self::assertNotEmpty($props);
        foreach ($props as [, $type, $description, $name, $default]) {
            self::assertArrayHasKey($name, $rows);
            self::assertSame([$type, $default, str_replace('`', '', $description)], $rows[$name], $name);
            self::assertStringContainsString("| `$name` |", $markdown, $name);
        }
        self::assertArrayHasKey('content', $rows, 'The block is documented too.');
        self::assertNull($dom->querySelector('toolkit-popover'));
    }

    public function testTheCopyableExamplesIdentifyTheirExtraRecipesAndPackages(): void
    {
        foreach ([
            ['card', 'Card with form inputs', ['button.md', 'checkbox.md', 'input.md', 'label.md']],
            ['badge', 'Badges with icon', ['composer require symfony/ux-icons']],
        ] as [$recipe, $title, $requirements]) {
            $section = strstr(self::page('r/'.$recipe.'.md'), '### '.$title."\n");
            self::assertIsString($section, $title);
            $intro = strstr($section, '```twig', true);
            self::assertIsString($intro, $title);
            foreach ($requirements as $requirement) {
                self::assertStringContainsString($requirement, $intro, $title.': before copying the example');
            }
        }
    }

    public function testTheInstallStepNamesTheRelease(): void
    {
        self::assertStringContainsString('ux:install badge --kit=https://github.com/xormania/uxor:0.4.0', self::recipeHtml('badge'));
        self::assertStringNotContainsString('Find this recipe in the latest published catalog', self::recipeHtml('badge'));
        self::assertStringNotContainsString('Find this recipe in the latest published catalog', self::page('r/badge.md'));
        self::assertStringNotContainsString('recipe-source-note', self::page('r/duplicate-snippets.md'));
        self::assertStringNotContainsString('Find this recipe in the latest published catalog', self::recipeHtml('duplicate-snippets'));
        self::assertStringContainsString("```shell\nphp bin/console ux:install badge --kit=https://github.com/xormania/uxor:0.4.0\n```", self::page('r/badge.md'));
    }

    public function testTheManualTabRegistersTheKitStylesheetAndChartWithAssetMapper(): void
    {
        $dom = \Dom\HTMLDocument::createFromString(self::recipeHtml('chart'), LIBXML_NOERROR);
        $manualId = null;
        foreach ($dom->querySelectorAll('button[aria-controls]') as $button) {
            if ('Manual' === trim($button->textContent)) {
                $manualId = $button->getAttribute('aria-controls');
                break;
            }
        }
        self::assertNotNull($manualId, 'The installation steps offer a Manual tab.');
        $manual = $dom->getElementById($manualId);
        self::assertNotNull($manual);
        $commands = [];
        foreach ($manual->querySelectorAll('code.language-shell') as $block) {
            $commands[] = $block->textContent;
        }
        $commands = implode("\n", $commands);

        self::assertMatchesRegularExpression('~^php bin/console importmap:require [^\n]*\bflowbite/dist/flowbite\.min\.css(?:@\S+)?(?=\s|$)~m', $commands);
        self::assertMatchesRegularExpression('~^php bin/console importmap:require [^\n]*\bchart\.js(?:@\S+)?(?=\s|$)~m', $commands);
        self::assertDoesNotMatchRegularExpression('/^\h*npm\h+install\b/m', $commands);
    }

    public function testARecipeThatNeedsTheServerKeepsItsProseAndItsPreview(): void
    {
        $html = self::recipeHtml('data-table');
        $markdown = self::page('r/data-table.md');

        self::assertStringContainsString('<h3 id="what-you-can-override">What you can override</h3>', $html);
        self::assertStringContainsString('src="/uxor/preview/data-table/default/light/"', $html);
        // the README's own account of the server round trips, in both formats
        foreach (['## Usage', '### What you can override', '### URL and history'] as $heading) {
            self::assertStringContainsString($heading, $markdown);
        }
    }

    public function testABinaryFileIsNamedInTheManualStepNotPrinted(): void
    {
        $html = self::recipeHtml('oauth');

        self::assertStringContainsString('<code>assets/images/uxor-oauth-google-light.png</code> (binary: copy it from the recipe', $html);
        self::assertStringNotContainsString("\x89PNG", $html);
    }

    public function testEveryRecipeRendersWithEachExamplePreviewedAndNoDirectiveLeft(): void
    {
        foreach (self::kit()->getRecipes() as $name => $recipe) {
            $html = self::recipeHtml($name);
            $markdown = self::page('r/'.$name.'.md');
            $previews = array_filter(self::kit()->getExamples($recipe), fn (array $example): bool => true === ($example['options']['preview'] ?? null));
            self::assertSame(\count($previews), substr_count($html, 'data-testid="example"'), "$name: every example has its preview page");
            self::assertDoesNotMatchRegularExpression('/^:{2,3} /m', $html, "$name: no directive left in HTML");
            // what can scroll sideways can take the focus (axe: scrollable-region-focusable)
            self::assertDoesNotMatchRegularExpression('/<pre(?![^>]*\btabindex="0")/', $html, "$name: every code block focusable");
            self::assertSame(substr_count($html, '<table>'), substr_count($html, '<div class="recipe-doc-table" tabindex="0"><table>'), "$name: every table in a focusable box");
            self::assertDoesNotMatchRegularExpression('/^:{2,3} /m', $markdown, "$name: no directive left in Markdown");
            self::assertDoesNotMatchRegularExpression('/^```\S+\h+\{/m', $markdown, "$name: no render metadata in Markdown");
            self::assertStringNotContainsString('--kit '.basename(self::source()), $markdown, "$name: never Toolkit's own install line");
            if (str_contains((string) $recipe->doc, '::: installation')) {
                self::assertStringContainsString("ux:install $name --kit=https://github.com/xormania/uxor:0.4.0", $markdown, $name);
            }
        }
    }

    public function testAReadmesLinksToOtherReadmesLandOnTheirRecipePagesAndMarkdown(): void
    {
        $html = [];
        foreach (array_keys(self::kit()->getRecipes()) as $name) {
            $dom = \Dom\HTMLDocument::createFromString(self::recipeHtml($name), LIBXML_NOERROR);
            $article = $dom->querySelector('[data-testid="recipe-doc"]');
            self::assertNotNull($article, $name);
            $html[$name] = $article->innerHTML;
        }

        $links = 0;
        foreach ($html as $name => $page) {
            preg_match_all('/<a href="([^"]*)"/', $page, $hrefs);
            foreach ($hrefs[1] as $href) {
                self::assertMatchesRegularExpression('#^(?:[a-z][a-z0-9+.-]*:|/|\#)#i', $href, "$name: no link left relative to the repository");
                if (preg_match('#^/uxor/r/([a-z0-9-]+)/?(?:\#(.+))?$#', $href, $target)) {
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
            $markdown = (string) preg_replace('/^(`{3,}).*?^\1\h*$/ms', '', self::page('r/'.$name.'.md'));
            preg_match_all('/\]\(([^)\s]*)\)/', $markdown, $targets);
            foreach ($targets[1] as $target) {
                if (!preg_match('#^(?:[a-z][a-z0-9+.-]*:|/|\#)#i', $target)) {
                    self::assertMatchesRegularExpression('/^[a-z0-9-]+\.md(?:#[a-z0-9-]+)?$/', $target, "$name: a relative link is another recipe's Markdown");
                    self::assertArrayHasKey((string) strstr($target, '.md', true), $html, "$name links $target");
                }
            }
        }
        self::assertStringContainsString('<a href="/uxor/r/spinner/">spinner component</a>', $html['button']);
        self::assertStringContainsString('<a href="/uxor/r/layouts/#back-and-forms">', $html['calendar']);
    }
}
