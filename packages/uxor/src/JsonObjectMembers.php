<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Locate a member in validated JSON so an edit can preserve the other values and their original number literals. */
final class JsonObjectMembers
{
    /** @return array{int, int, int}|null Byte offsets of the key, value and end of the value (exclusive). */
    public static function span(string $json, string $key, int $objectOffset): ?array
    {
        if ('{' !== ($json[$objectOffset] ?? null)) {
            throw new \InvalidArgumentException('Expected a JSON object at the selected offset.');
        }
        $offset = $objectOffset + 1;
        $found = null;
        while (true) {
            $offset += strspn($json, " \t\r\n", $offset);
            if ('}' === $json[$offset]) {
                return $found;
            }
            $keyEnd = self::stringEnd($json, $offset);
            $name = json_decode(substr($json, $offset, $keyEnd - $offset), flags: JSON_THROW_ON_ERROR);
            $colon = $keyEnd + strspn($json, " \t\r\n", $keyEnd);
            $value = $colon + 1 + strspn($json, " \t\r\n", $colon + 1);
            $end = self::valueEnd($json, $value);
            if ($name === $key) {
                if (null !== $found) {
                    throw new \InvalidArgumentException('Cannot edit an ambiguous duplicate JSON member: '.$key);
                }
                $found = [$offset, $value, $end];
            }
            $offset = $end + strspn($json, " \t\r\n", $end);
            if (',' === $json[$offset]) {
                ++$offset;
            }
        }
    }

    private static function stringEnd(string $json, int $quote): int
    {
        $offset = $quote + 1;
        while (true) {
            $offset += strcspn($json, '"\\', $offset);
            if ('"' === $json[$offset]) {
                return $offset + 1;
            }
            $offset += 2; // Skip the escaped character.
        }
    }

    private static function valueEnd(string $json, int $offset): int
    {
        if ('"' === $json[$offset]) {
            return self::stringEnd($json, $offset);
        }
        if (!str_contains('[{', $json[$offset])) {
            return $offset + strcspn($json, ",]} \t\r\n", $offset);
        }
        $depth = 1;
        ++$offset;
        while ($depth > 0) {
            $offset += strcspn($json, '"{}[]', $offset);
            $token = $json[$offset];
            if ('"' === $token) {
                $offset = self::stringEnd($json, $offset);
            } else {
                $depth += str_contains('[{', $token) ? 1 : -1;
                ++$offset;
            }
        }
        return $offset;
    }
}
