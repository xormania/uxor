<?php

require __DIR__.'/vendor/autoload.php';

use Consumer\Kernel;
use Symfony\Component\HttpFoundation\Request;

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$kernel = new Kernel('prod', false);
$cases = [
    ['/orders?campaign=fixture', 'ORD-001', 'ORD-002'],
    ['/orders?page=2&campaign=fixture', 'ORD-002', 'ORD-001'],
    ['/orders?q=Bob', 'ORD-002', 'ORD-001'],
    ['/orders?sort=number&dir=desc', 'ORD-002', 'ORD-001'],
];
foreach ($cases as [$url, $present, $absent]) {
    $request = Request::create($url);
    $response = $kernel->handle($request);
    check(200 === $response->getStatusCode(), 'Consumer request failed: '.$url);
    $html = $response->getContent();
    check(str_contains($html, $present) && !str_contains($html, $absent), 'Consumer row loading failed: '.$url);
    check(str_contains($html, 'data-invoice') && str_contains($html, 'data-customer'), 'Consumer cell slots missing');
    check(str_contains($html, 'data-consumer="fixture"'), 'Attributes were not forwarded');
    check(!str_contains($html, 'data-wrong-local-button'), 'Package nested component collided with app Button');
    check(str_contains($html, 'xormania--uxor-pilot--data-table'), 'Namespaced controller missing');
    check(!str_contains($html, '<script>alert(1)</script>'), 'Custom cell content was not escaped');
    if ('ORD-001' === $present) {
        check(str_contains($html, 'Alice &lt;script&gt;alert(1)&lt;/script&gt;'), 'Escaped consumer content was dropped');
    }
    if (str_contains($url, 'campaign=')) {
        check(str_contains($html, 'name="campaign" value="fixture"'), 'Unrelated query state was dropped');
    }
    $kernel->terminate($request, $response);
}
$assets = json_decode(file_get_contents(__DIR__.'/public/assets/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
check(isset($assets['@xormania/uxor-pilot/controllers/data_table_controller.js']), 'Packaged controller not compiled');
check(isset($assets['@xormania/uxor-pilot/lib/uxor-turbo.js']), 'Relative lifecycle helper not compiled');
$css = file_get_contents(__DIR__.'/public/'.ltrim($assets['styles/app.css'], '/'));
check(str_contains($css, '.rounded-base') && str_contains($css, '.min-w-48'), 'Vendor classes missing from production CSS');
check(str_contains($css, '--color-brand:#6d28d9') && str_contains($css, '--color-brand:#a78bfa'), 'Consumer mode-specific branding missing');
check(str_contains($css, '--radius-base:4px') && str_contains($css, 'Georgia'), 'Consumer shape or typography missing');
echo "Package consumer: 4 request scenarios, nested names, slots, escaping, state and production assets passed.\n";
