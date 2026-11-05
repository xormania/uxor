<?php

namespace App\Tests\Functional;

use App\Kit\KitReader;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * The recipe page (/r/<recipe>) shows the recipe's README rendered by the UX Toolkit (App\Kit\RecipeDocs): its prose,
 * its install step (StaticExportBannerTest checks its ref), each example as its gallery preview page in both themes,
 * its API tables; and keeps what the page said before, the name, the description, what it installs and the static
 * copy's note on what needs the server.
 */
final class RecipePageTest extends WebTestCase
{
    /**
     * @param array<string, mixed>|null $export what app:export-static puts on each request; null for the dev server
     */
    private static function page(string $recipe, ?array $export = null): string
    {
        $kernel = static::bootKernel();
        $request = Request::create('/r/'.$recipe);
        if (null !== $export) {
            $request->attributes->set('_static_export', $export + ['release' => null, 'latest_release' => '0.4.0', 'commit' => 'abc1234def', 'branch' => 'main', 'server_only' => []]);
        }
        $response = $kernel->handle($request, HttpKernelInterface::MAIN_REQUEST, false);
        self::assertSame(200, $response->getStatusCode());

        return (string) $response->getContent();
    }

    public function testThePageShowsTheReadmeUnderTheRecipesOwnTitle(): void
    {
        $html = self::page('badge', ['release' => '0.4.0']);

        self::assertSame(1, substr_count($html, '<h1'), "one title: the page's, not the README's too");
        self::assertSame(1, substr_count($html, 'The badge component can be used to complement'), 'the description once, under the title');
        foreach (['installation' => 'Installation', 'usage' => 'Usage', 'examples' => 'Examples', 'api-reference' => 'API Reference'] as $id => $heading) {
            self::assertStringContainsString(\sprintf('<h2 id="%s">%s</h2>', $id, $heading), $html);
        }
        self::assertStringContainsString('<h2 id="installs-heading"', $html, 'what it installs, still');

        preg_match_all('/(?<![\w-])id="([^"]+)"/', $html, $ids);
        self::assertSame(array_unique($ids[1]), $ids[1], 'every id on the page is unique');
    }

    public function testEachExampleIsItsPreviewPageInBothThemes(): void
    {
        $html = self::page('badge', ['release' => '0.4.0']);

        $examples = static::getContainer()->get(KitReader::class)->getExamples(static::getContainer()->get(KitReader::class)->getRecipe('badge') ?? throw new \LogicException('No badge recipe.'));
        self::assertNotEmpty($examples);
        self::assertSame(\count($examples), substr_count($html, 'data-testid="example"'));
        foreach ($examples as $example) {
            self::assertStringContainsString(\sprintf('data-example="%s"', $example['id']), $html);
            foreach (['light', 'dark'] as $theme) {
                self::assertStringContainsString(\sprintf('<iframe src="/preview/badge/%1$s?theme=%2$s" title="%1$s (%2$s)"', $example['id'], $theme), $html);
            }
        }
    }

    public function testABlocksPreviewsAreTallerThanAComponents(): void
    {
        self::assertStringContainsString('class="recipe-doc group/doc mt-10 min-w-0" data-page data-testid="recipe-doc"', self::page('dashboard-home'));
        self::assertStringContainsString('class="recipe-doc group/doc mt-10 min-w-0" data-testid="recipe-doc"', self::page('badge'));
    }

    public function testTheStaticCopySaysWhatNeedsTheServerAndKeepsTheExample(): void
    {
        $html = self::page('data-table', ['release' => '0.4.0', 'server_only' => ['data-table' => 'the pages ask the server for the rows']]);

        self::assertStringContainsString('In this static copy, the pages ask the server for the rows.', $html);
        self::assertStringContainsString('data-example="default"', $html);
        self::assertStringContainsString('<h3 id="what-you-can-override">What you can override</h3>', $html);
    }
}
