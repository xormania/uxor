<?php

namespace App\Tests\Property;

use Random\Engine\Mt19937;
use Random\Randomizer;

/**
 * The property tests' runs: a seeded generator (Mt19937), the same values for the same seed. CI runs a fixed seed, so a
 * run is repeatable; the release checks run a random one and more runs (docs/TESTING.md, *Release checks*). Every
 * failure names its seed and run: `SEED=<seed> bin/phpunit --group property` replays it.
 *
 * SEED: the seed (default: the test's own fixed one); PROPERTY_RUNS: the runs per property (default 300).
 */
trait Seeded
{
    private function seed(int $default): int
    {
        $seed = getenv('SEED');

        return false === $seed || '' === $seed ? $default : (int) $seed;
    }

    private function randomizer(int $seed): Randomizer
    {
        return new Randomizer(new Mt19937($seed));
    }

    private function runs(): int
    {
        $runs = getenv('PROPERTY_RUNS');

        return false === $runs || '' === $runs ? 300 : max(1, (int) $runs);
    }

    /**
     * @template T
     *
     * @param list<T> $items
     *
     * @return T
     */
    private function pick(Randomizer $random, array $items): mixed
    {
        return $items[$random->getInt(0, \count($items) - 1)];
    }
}
