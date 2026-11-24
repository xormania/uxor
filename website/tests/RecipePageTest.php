<?php

namespace UXor\Website\Tests;

final class RecipePageTest extends WebsiteTestCase
{
    public function testThePageShowsTheReadmeUnderTheRecipesOwnTitle(): void
    {
        $html = self::recipeHtml('badge');

        self::assertSame(1, substr_count($html, '<h1'), "one title: the page's, not the README's too");
        self::assertSame(1, substr_count((string) strstr($html, '<body'), 'The badge component can be used to complement'), 'the description once on the page, under the title (and in its <meta>)');
        foreach (['installation' => 'Installation', 'usage' => 'Usage', 'examples' => 'Examples', 'api-reference' => 'API Reference'] as $id => $heading) {
            self::assertStringContainsString(\sprintf('<h2 id="%s">%s</h2>', $id, $heading), $html);
        }
        self::assertStringContainsString('<h2 id="installs-heading"', $html, 'what it installs, still');

        preg_match_all('/(?<![\w-])id="([^"]+)"/', $html, $ids);
        self::assertSame(array_unique($ids[1]), $ids[1], 'every id on the page is unique');
    }

    public function testEachExampleIsItsPreviewPageInBothThemes(): void
    {
        $html = self::recipeHtml('badge');

        $examples = self::kit()->getExamples(self::kit()->getRecipe('badge') ?? throw new \LogicException('No badge recipe.'));
        self::assertNotEmpty($examples);
        self::assertSame(\count($examples), substr_count($html, 'data-testid="example"'));
        foreach ($examples as $example) {
            self::assertStringContainsString(\sprintf('data-example="%s"', $example['id']), $html);
            foreach (['light', 'dark'] as $theme) {
                self::assertStringContainsString(\sprintf('<iframe src="/uxor/preview/badge/%1$s/%2$s/" title="%1$s (%2$s)"', $example['id'], $theme), $html);
            }
        }
    }

    public function testABlocksPreviewsAreTallerThanAComponents(): void
    {
        foreach (['dashboard-home' => true, 'badge' => false] as $name => $isPage) {
            $dom = \Dom\HTMLDocument::createFromString(self::recipeHtml($name), LIBXML_NOERROR);
            $article = $dom->querySelector('[data-testid="recipe-doc"]');
            self::assertNotNull($article);
            self::assertSame($isPage, $article->hasAttribute('data-page'), $name);
        }
    }

    public function testTheStaticCopySaysWhatNeedsTheServerAndKeepsTheExample(): void
    {
        $html = self::recipeHtml('data-table');

        self::assertStringContainsString('the pages ask the server for the rows', $html);
        self::assertStringContainsString('data-example="default"', $html);
        self::assertStringContainsString('<h3 id="what-you-can-override">What you can override</h3>', $html);
    }

    public function testTheRecipesMarkdownIsItsDocumentationAtTheReleaseWithItsLinksBesideIt(): void
    {
        $markdown = self::page('r/button.md');
        self::assertStringStartsWith("# Button\n", $markdown);
        self::assertStringContainsString('php bin/console ux:install button --kit=https://github.com/xormania/uxor:0.4.0', $markdown);
        self::assertStringContainsString('[spinner component](spinner.md)', $markdown, 'the spinner README, saved beside it');
        self::assertStringNotContainsString('{"preview"', $markdown);

        self::assertStringContainsString('<a href="/uxor/r/button.md" type="text/markdown"', self::recipeHtml('button'), 'the page links it');
    }
}
