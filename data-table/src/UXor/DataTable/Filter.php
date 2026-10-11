<?php

namespace App\UXor\DataTable;

/**
 * A filter of a data table: a select of fixed choices. A value outside the choices is ignored.
 */
final class Filter
{
    /**
     * @param array<int|string, string> $choices value => label
     */
    private function __construct(
        public readonly string $key,
        public readonly string $label,
        public readonly array $choices,
    ) {
    }

    /**
     * @param array<int|string, string> $choices value => label; PHP keys a numeric value (`'2024'`) as an integer, and
     *                                         the query holds it as a string
     */
    public static function choice(string $key, string $label, array $choices): self
    {
        if (1 !== preg_match('/^[a-z][a-z0-9_]*$/', $key)) {
            throw new \InvalidArgumentException(\sprintf('The filter key "%s" must be lower snake case.', $key));
        }

        return new self($key, $label, $choices);
    }
}
