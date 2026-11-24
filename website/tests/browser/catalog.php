<?php

declare(strict_types=1);

use UXor\Kit\KitReader;

require dirname(__DIR__, 2).'/vendor/autoload.php';

$root = dirname(__DIR__, 3);
$kit = new KitReader($root);
$examples = [];
foreach ($kit->getRecipes() as $recipe) {
    $previews = array_filter($kit->getExamples($recipe), static fn (array $example): bool => true === ($example['options']['preview'] ?? false));
    $examples[$recipe->name] = array_column($previews, 'id');
}

echo json_encode($examples, JSON_THROW_ON_ERROR);
