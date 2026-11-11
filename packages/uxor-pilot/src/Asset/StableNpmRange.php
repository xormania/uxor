<?php

namespace UXor\Pilot\Asset;

/**
 * A deliberately bounded npm range predicate for selected stable versions, not a package resolver.
 *
 * Supported: exact M.m.p, *, ^ and ~ with one to three numeric components, comparisons against
 * complete M.m.p, whitespace conjunctions and ||. Versions must be complete and stable. Other npm
 * syntax is rejected, including prereleases/build metadata, tags, X-ranges and hyphen ranges.
 * All alternatives are parsed before evaluation: a matching branch cannot hide unsupported syntax.
 * This implements numeric tuple rules directly; Composer's version grammar is not npm's grammar.
 */
final class StableNpmRange
{
    private const MAX_SAFE_COMPONENT = '9007199254740991';
    private const MAX_RANGE_LENGTH = 4096;

    public function matches(string $version, string $range): bool
    {
        $selected = $this->parseComponents($version, false);
        if ('' === trim($range) || strlen($range) > self::MAX_RANGE_LENGTH
            || preg_match('/[^\x09-\x0d\x20-\x7e]/', $range)) {
            throw new \InvalidArgumentException('Expected a nonempty stable npm range of at most 4096 ASCII characters.');
        }

        $alternatives = [];
        foreach (explode('||', $range) as $alternative) {
            $alternative = trim($alternative);
            if ('' === $alternative) {
                throw new \InvalidArgumentException('Empty npm range alternatives are unsupported.');
            }
            $conditions = [];
            $offset = 0;
            while ($offset < strlen($alternative)) {
                if (1 !== preg_match('/\G\s*(\^|~|>=|<=|>|<|=)?\s*(\*|[0-9]+(?:\.[0-9]+){0,2})(?=\s|$)/', $alternative, $match, 0, $offset)) {
                    throw new \InvalidArgumentException('Unsupported or malformed stable npm range: '.$range);
                }
                $offset += strlen($match[0]);
                $operator = $match[1];
                $operand = $match[2];
                if ('*' === $operand) {
                    if ('' !== $operator) {
                        throw new \InvalidArgumentException('Only a standalone * wildcard is supported.');
                    }
                    continue;
                }

                $partial = in_array($operator, ['^', '~'], true);
                $components = $this->parseComponents($operand, $partial);
                $count = count(explode('.', $operand));
                if (!$partial) {
                    $conditions[] = ['' === $operator ? '=' : $operator, $components];
                    continue;
                }

                if ('~' === $operator) {
                    $increment = 1 === $count ? 0 : 1;
                } elseif (1 === $count || 0 !== $components[0]) {
                    $increment = 0;
                } elseif (2 === $count || 0 !== $components[1]) {
                    $increment = 1;
                } else {
                    $increment = 2;
                }
                $upper = $components;
                if ($upper[$increment] === (int) self::maximumComponent()) {
                    throw new \InvalidArgumentException('Expanded npm range boundary exceeds the supported integer precision.');
                }
                ++$upper[$increment];
                for ($index = $increment + 1; $index < 3; ++$index) {
                    $upper[$index] = 0;
                }
                $conditions[] = ['>=', $components];
                $conditions[] = ['<', $upper];
            }
            $alternatives[] = $conditions;
        }

        foreach ($alternatives as $conditions) {
            $satisfied = true;
            foreach ($conditions as [$operator, $expected]) {
                $comparison = $selected <=> $expected;
                $condition = match ($operator) {
                    '=' => 0 === $comparison,
                    '>' => $comparison > 0,
                    '>=' => $comparison >= 0,
                    '<' => $comparison < 0,
                    '<=' => $comparison <= 0,
                };
                $satisfied = $satisfied && $condition;
            }
            if ($satisfied) {
                return true;
            }
        }

        return false;
    }

    /** @return array{int, int, int} */
    private function parseComponents(string $version, bool $partial): array
    {
        $pattern = $partial ? '/\A(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?(?:\.(0|[1-9][0-9]*))?\z/'
            : '/\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z/';
        if (1 !== preg_match($pattern, $version)) {
            throw new \InvalidArgumentException('Expected '.($partial ? 'one to three numeric components' : 'an exact stable M.m.p version').': '.$version);
        }
        $limit = self::maximumComponent();
        $components = [0, 0, 0];
        foreach (explode('.', $version) as $index => $component) {
            if (strlen($component) > strlen($limit) || (strlen($component) === strlen($limit) && strcmp($component, $limit) > 0)) {
                throw new \InvalidArgumentException('Version component exceeds the supported integer precision: '.$version);
            }
            $components[$index] = (int) $component;
        }

        return [$components[0], $components[1], $components[2]];
    }

    private static function maximumComponent(): string
    {
        return PHP_INT_SIZE >= 8 ? self::MAX_SAFE_COMPONENT : (string) PHP_INT_MAX;
    }
}
