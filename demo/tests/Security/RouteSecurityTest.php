<?php

namespace App\Tests\Security;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class RouteSecurityTest extends KernelTestCase
{
    private const CATEGORIES = ['public-read', 'public-reference', 'trusted-code-preview', 'development-only'];
    private const CSRF = ['symfony-form', 'firewall-form', 'firewall-logout'];

    public function testEveryDemoRouteDeclaresItsTrustBoundaryAndMethods(): void
    {
        self::bootKernel();
        $router = self::getContainer()->get('router');

        $found = [];
        foreach ($router->getRouteCollection() as $name => $route) {
            $controller = $route->getDefault('_controller');
            if (!\is_string($controller) || !str_starts_with($controller, 'App\\Controller\\')) {
                continue;
            }

            $category = $route->getOption('uxor_security');
            self::assertContains($category, self::CATEGORIES, "{$name} ({$route->getPath()}) has no reviewed uxor_security category");
            $found[$name] = $category;

            $methods = $route->getMethods();
            if ('development-only' !== $category) {
                self::assertNotSame([], $methods, "{$name} accepts every HTTP method");
                self::assertSame([], array_diff($methods, ['GET', 'POST']), "{$name} accepts a method outside GET and POST");
            }
            if (\in_array('POST', $methods, true) && 'development-only' !== $category) {
                self::assertContains($route->getOption('uxor_csrf'), self::CSRF, "{$name} accepts POST without a reviewed CSRF mechanism");
            }
            if (\in_array($category, ['public-read', 'trusted-code-preview'], true)) {
                self::assertSame(['GET'], $methods, "{$name} is read-only but accepts another method");
            }
        }

        self::assertNotSame([], $found);
        self::assertContains('public-read', $found);
        self::assertContains('public-reference', $found);
        self::assertContains('trusted-code-preview', $found);
        self::assertContains('development-only', $found);
    }
}
