<?php

namespace App\Tests\Functional;

use App\Controller\DemoAppController;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Routing\RouterInterface;

/**
 * Every page of the demo app names the brand it shows in its title (` — xor`), its error page included. The title is
 * the server's, the same in every browser. The pages are the demo app controller's GET routes, read from the router,
 * so a new page is checked without a list to keep.
 */
final class DemoAppTitleTest extends WebTestCase
{
    public function testEveryDemoPageNamesTheBrandInItsTitle(): void
    {
        $client = static::createClient();
        $router = static::getContainer()->get(RouterInterface::class);
        $paths = [];
        foreach ($router->getRouteCollection() as $route) {
            $controller = (string) $route->getDefault('_controller');
            $methods = $route->getMethods();
            if (str_starts_with($controller, DemoAppController::class.'::') && ([] === $methods || \in_array('GET', $methods, true))) {
                $paths[] = $route->getPath();
            }
        }
        sort($paths);
        // the pages the demo app shows, its sign-in, settings and error page among them
        foreach (['/demo', '/demo/login', '/demo/settings/profile', '/demo/not-found'] as $known) {
            self::assertContains($known, $paths);
        }

        $problems = [];
        foreach ($paths as $path) {
            $client->request('GET', $path);
            // the error page answers 404 on purpose
            $expected = '/demo/not-found' === $path ? 404 : 200;
            if ($expected !== $status = $client->getResponse()->getStatusCode()) {
                $problems[] = "$path: answers $status, expected $expected";
                continue;
            }
            $document = \Dom\HTMLDocument::createFromString((string) $client->getResponse()->getContent(), \LIBXML_NOERROR);
            $titles = $document->querySelectorAll('head > title');
            // read as a browser reads document.title: whitespace collapsed, trimmed
            $title = trim((string) preg_replace('/\s+/u', ' ', (string) $titles->item(0)?->textContent));
            if (1 !== $titles->length || !preg_match('/ — xor$/u', $title)) {
                $problems[] = \sprintf('%s: %d title(s), "%s"', $path, $titles->length, $title);
            }
        }

        self::assertSame([], $problems);
    }
}
