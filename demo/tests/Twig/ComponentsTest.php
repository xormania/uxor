<?php

namespace App\Tests\Twig;

use App\Tests\Snapshot\Html5Driver;
use PHPUnit\Framework\Attributes\DataProvider;
use Spatie\Snapshots\MatchesSnapshots;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\UX\TwigComponent\Test\InteractsWithTwigComponents;
use Symfony\UX\TwigComponent\Test\RenderedComponent;

/**
 * Recipes rendered through the demo's Twig, as an app renders them (the templates tools/sync-demo copies). Each
 * rendering is compared with a snapshot in __snapshots__/: a change in a recipe's markup shows in the diff of its
 * snapshot. Write the missing snapshots with `bin/phpunit`, rewrite changed ones with UPDATE_SNAPSHOTS=true, and
 * review them like any other change; CI sets CREATE_SNAPSHOTS=false, so a missing snapshot fails there.
 */
final class ComponentsTest extends KernelTestCase
{
    use InteractsWithTwigComponents;
    use MatchesSnapshots;

    public function testBadge(): void
    {
        $rendered = $this->renderTwigComponent('Badge', ['variant' => 'success', 'shape' => 'pill', 'class' => 'ms-2'], 'Paid');

        $badge = $rendered->crawler()->filter('div');
        self::assertCount(1, $badge);
        self::assertSame('Paid', trim($badge->text()));
        // tailwind_classes merges the class prop into the variant's classes
        self::assertStringContainsString('ms-2', (string) $badge->attr('class'));
        self::assertStringContainsString('rounded-full', (string) $badge->attr('class'));
        $this->assertMatchesSnapshot($rendered->toString(), new Html5Driver());
    }

    public function testABadgeTagNotInItsListRendersADiv(): void
    {
        $rendered = $this->renderTwigComponent('Badge', ['as' => 'SCRIPT'], 'x');

        self::assertCount(0, $rendered->crawler()->filter('script'));
        self::assertCount(1, $rendered->crawler()->filter('div'));
    }

    public function testBreadcrumb(): void
    {
        // a component with parts: a template in the `<twig:…>` syntax, as a page writes it
        $html = self::getContainer()->get('twig')->createTemplate(<<<'TWIG'
            <twig:Breadcrumb>
                <twig:Breadcrumb:Item href="/">Home</twig:Breadcrumb:Item>
                <twig:Breadcrumb:Item href="/projects">Projects</twig:Breadcrumb:Item>
                <twig:Breadcrumb:Item>Flowbite</twig:Breadcrumb:Item>
            </twig:Breadcrumb>
            TWIG)->render();
        $rendered = new RenderedComponent($html);

        self::assertSame(['/', '/projects'], $rendered->crawler()->filter('a')->extract(['href']));
        self::assertSame('Flowbite', trim($rendered->crawler()->filter('[aria-current="page"]')->text()));
        $this->assertMatchesSnapshot($html, new Html5Driver());
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function links(): iterable
    {
        yield 'relative' => ['/orders?page=2', '/orders?page=2'];
        yield 'https' => ['https://example.com/', 'https://example.com/'];
        yield 'javascript' => ['javascript:alert(1)', '#'];
        yield 'javascript, mixed case after a tab and spaces' => ["\t  JaVa\tScRiPt:alert(1)", '#'];
        yield 'data' => ['data:text/html,<script>alert(1)</script>', '#'];
    }

    /**
     * @return iterable<string, array{string, array<string, mixed>}>
     */
    public static function attributeBags(): iterable
    {
        $hostile = ['ONCLICK' => 'x()', ' onfocus' => 'x()', 'HREF' => 'javascript:alert(1)', 'FormAction' => " JaVa\tScRiPt:alert(1)", 'Src' => 'data:image/svg+xml,x', 'srcset' => 'x.png 1x', 'Ping' => '/t'];
        foreach (['Button' => ['as' => 'a'], 'Button as button' => [], 'Badge' => ['as' => 'a'], 'Dropdown:Item' => [], 'Avatar:GroupCount' => ['as' => 'a'], 'Avatar:Image' => [], 'Input' => ['type' => 'submit']] as $name => $props) {
            yield $name => [explode(' ', $name)[0], $props + $hostile];
        }
    }

    /**
     * The attributes given to a component, read as a browser reads their names (in any case): no `on…`, `srcset` or
     * `ping`; `href` and `formaction` with an unsafe scheme render `#`, such a `src` renders nothing.
     *
     * @param array<string, mixed> $props
     */
    #[DataProvider('attributeBags')]
    public function testAComponentChecksTheUrlAndHandlerAttributesGivenInAnyCase(string $component, array $props): void
    {
        $html = $this->renderTwigComponent($component, $props, 'x')->toString();
        $document = new \DOMDocument();
        @$document->loadHTML('<!doctype html><body>'.$html);
        $found = [];
        foreach ((new \DOMXPath($document))->query('//body//*') ?: [] as $element) {
            \assert($element instanceof \DOMElement);
            foreach ($element->attributes as $attribute) {
                $name = strtolower(ltrim(html_entity_decode($attribute->name), "\x00..\x20"));
                if (str_starts_with($name, 'on') || \in_array($name, ['srcset', 'ping', 'src'], true)
                    || (\in_array($name, ['href', 'formaction'], true) && '#' !== $attribute->value)) {
                    $found[] = $attribute->name.'="'.$attribute->value.'"';
                }
            }
        }

        self::assertSame([], $found, $html);
    }

    #[DataProvider('links')]
    public function testABreadcrumbLinkKeepsOnlyAllowedSchemes(string $href, string $expected): void
    {
        $rendered = $this->renderTwigComponent('Breadcrumb:Item', ['href' => $href], 'Level');

        self::assertSame($expected, $rendered->crawler()->filter('a')->attr('href'));
    }

    public function testANavMenuRenderedTwiceGivesEachSubmenuItsOwnId(): void
    {
        // the same items in two menus, as the navbar and the drawer render them; the page's own variables (`name`,
        // `route`, `active`, `id`) must not reach the parts
        $items = <<<'TWIG'
            <twig:NavMenu:Link href="/">Home</twig:NavMenu:Link>
            <twig:NavMenu:Submenu label="Our Products">
                <twig:NavMenu:Link href="/products">All products</twig:NavMenu:Link>
                <twig:NavMenu:Submenu label="Integrations">
                    <twig:NavMenu:Link href="javascript:alert(1)">Slack</twig:NavMenu:Link>
                </twig:NavMenu:Submenu>
                <twig:NavMenu:Submenu label="More" name="tools">
                    <twig:NavMenu:Link href="/tools" :active="true">Tools</twig:NavMenu:Link>
                </twig:NavMenu:Submenu>
            </twig:NavMenu:Submenu>
            TWIG;
        $html = self::getContainer()->get('twig')->createTemplate(
            '<twig:NavMenu id="site">'.$items.'</twig:NavMenu><twig:NavMenu id="drawer" orientation="vertical">'.$items.'</twig:NavMenu>'
        )->render(['name' => 'page', 'route' => 'app_page', 'active' => true, 'id' => 'outer']);
        $rendered = new RenderedComponent($html);
        $crawler = $rendered->crawler();

        $ids = ['site-our-products', 'site-our-products-integrations', 'site-our-products-tools', 'drawer-our-products', 'drawer-our-products-integrations', 'drawer-our-products-tools'];
        self::assertSame($ids, $crawler->filter('ul[id]')->extract(['id']));
        self::assertSame($ids, $crawler->filter('button')->extract(['aria-controls']));
        self::assertSame(['false'], array_values(array_unique($crawler->filter('button')->extract(['aria-expanded']))));
        self::assertSame(['horizontal', 'vertical'], $crawler->filter('[data-controller="nav-menu"]')->extract(['data-nav-menu-orientation-value']));
        // only the link given `active` is current; a rejected scheme renders `#`
        self::assertSame(['Tools', 'Tools'], $crawler->filter('a[aria-current="page"]')->each(static fn ($link) => trim($link->text())));
        self::assertSame(['#', '#'], $crawler->filterXPath('//a[normalize-space()="Slack"]')->extract(['href']));
        $this->assertMatchesSnapshot($html, new Html5Driver());
    }

    public function testASectionNavIsANavigationListOfLinksMarkingTheCurrentSection(): void
    {
        // the page of the route `app_settings_account`, as the router leaves it on the request
        self::getContainer()->get('request_stack')->push(new Request(attributes: ['_route' => 'app_settings_account']));

        $html = self::getContainer()->get('twig')->createTemplate(<<<'TWIG'
            <twig:SectionNav label="Settings" orientation="sideways">
                <twig:SectionNav:Item href="/settings/profile" route="app_settings_profile">Profile</twig:SectionNav:Item>
                <twig:SectionNav:Item href="/settings/account" route="app_settings_account">Account</twig:SectionNav:Item>
                <twig:SectionNav:Item href="/settings/billing" route="app_settings_account" :active="false">Billing</twig:SectionNav:Item>
                <twig:SectionNav:Item href="/settings/security" :active="true">Security</twig:SectionNav:Item>
                <twig:SectionNav:Item href="/settings/team">Team</twig:SectionNav:Item>
                <twig:SectionNav:Item :href="hostile">Hostile</twig:SectionNav:Item>
            </twig:SectionNav>
            TWIG)->render(['hostile' => " JaVa\tScRiPt:alert(1)"]);
        $crawler = (new RenderedComponent($html))->crawler();

        $nav = $crawler->filter('nav');
        self::assertSame('Settings', $nav->attr('aria-label'));
        self::assertSame('section-nav', $nav->attr('data-controller'));
        // an orientation it does not know is the responsive one
        self::assertStringContainsString('lg:flex-col', (string) $crawler->filter('nav > ul')->attr('class'));
        self::assertCount(6, $crawler->filter('nav > ul > li > a'));
        self::assertSame(['/settings/profile', '/settings/account', '/settings/billing', '/settings/security', '/settings/team', '#'], $crawler->filter('a')->extract(['href']));
        // the current route marks Account, `active` overrides the route either way; only an item with neither is
        // left to the controller, which compares the URL's path
        self::assertSame(['Account', 'Security'], $crawler->filter('a[aria-current="page"]')->each(static fn ($link) => trim($link->text())));
        self::assertSame(['Team', 'Hostile'], $crawler->filter('a[data-section-nav-match-url]')->each(static fn ($link) => trim($link->text())));
        $this->assertMatchesSnapshot($html, new Html5Driver());
    }
}
