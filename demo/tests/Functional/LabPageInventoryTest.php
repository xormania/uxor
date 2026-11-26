<?php

namespace App\Tests\Functional;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Exception\MethodNotAllowedException;
use Symfony\Component\Routing\Exception\ResourceNotFoundException;

final class LabPageInventoryTest extends KernelTestCase
{
    private const INVENTORY = 'tests/e2e/lab-pages.json';
    private const NON_PAGE_ROUTES = [
        'app_lab_turbo_nav_save' => 'POST only: the form on the Turbo navigation page submits here',
    ];

    public function testEveryRegisteredLabPageIsScanned(): void
    {
        self::bootKernel();
        $router = self::getContainer()->get('router');

        $getRoutes = [];
        $nonPageRoutes = [];
        foreach ($router->getRouteCollection() as $name => $route) {
            $path = $route->getPath();
            if ('/lab' !== $path && !str_starts_with($path, '/lab/')) {
                continue;
            }

            $methods = $route->getMethods();
            if ([] === $methods || \in_array('GET', $methods, true)) {
                $getRoutes[$name] = $path;
            } else {
                $nonPageRoutes[$name] = $path;
            }
        }

        $inventory = file_get_contents(\dirname(__DIR__, 3).'/'.self::INVENTORY);
        self::assertIsString($inventory);
        $paths = json_decode($inventory, true, flags: \JSON_THROW_ON_ERROR);
        self::assertIsList($paths);

        $scanned = [];
        $errors = [];
        foreach ($paths as $path) {
            self::assertIsString($path);
            try {
                $name = $router->matchRequest(Request::create($path))['_route'] ?? null;
            } catch (ResourceNotFoundException|MethodNotAllowedException) {
                $name = null;
            }
            if (!\is_string($name) || !isset($getRoutes[$name])) {
                $errors[] = "{$path} does not match a registered GET lab route";
                continue;
            }
            $scanned[$name] = true;
        }

        foreach (array_diff_key($getRoutes, $scanned) as $name => $path) {
            $errors[] = "{$path} ({$name}) is missing from ".self::INVENTORY;
        }
        foreach (array_diff_key($nonPageRoutes, self::NON_PAGE_ROUTES) as $name => $path) {
            $errors[] = "{$path} ({$name}) has no GET method: document it in NON_PAGE_ROUTES";
        }
        foreach (array_diff_key(self::NON_PAGE_ROUTES, $nonPageRoutes) as $name => $reason) {
            $errors[] = "{$name} is no longer a non-page lab route: remove its exclusion ({$reason})";
        }

        self::assertSame([], $errors, implode("\n", $errors));
    }
}
