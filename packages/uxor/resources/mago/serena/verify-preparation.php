<?php

declare(strict_types=1);

use Xormania\UXor\Preparation\PreparationSnapshot;

// Both files come from the provider image; never load the mounted application's autoloader.
require dirname(__DIR__, 3).'/src/Preparation/ProjectPath.php';
require dirname(__DIR__, 3).'/src/Preparation/PreparationSnapshot.php';

try {
    if (count($argv) !== 2 || false === ($root = realpath($argv[1])) || !is_dir($root)) {
        throw new \InvalidArgumentException('Supply the selected application directory.');
    }
    $state = (new PreparationSnapshot())->readiness($root);
    if (!in_array($state['state'], ['ready', 'unprepared'], true)) {
        throw new \RuntimeException('Preparation is unavailable.');
    }
    echo json_encode(['enabled' => $state['enabled'], 'fresh' => $state['fresh'], 'generation' => $state['generation']], JSON_THROW_ON_ERROR)."\n";
} catch (\Throwable) {
    fwrite(STDERR, "Symfony preparation is stale, incomplete or unavailable. Prepare again in the application runtime.\n");
    exit(3);
}
