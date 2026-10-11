<?php

namespace App\UXor\DataTable;

/**
 * A column of a data table: its public key (in the URL and the cell block name `cell_<key>`), its label and, when
 * sortable, the server-side field it sorts by. The field never leaves the server.
 */
final class Column
{
    private function __construct(
        public readonly string $key,
        public readonly string $label,
        public readonly ?string $sortField = null,
    ) {
    }

    public static function make(string $key, string $label): self
    {
        if (1 !== preg_match('/^[a-z][a-z0-9_]*$/', $key)) {
            throw new \InvalidArgumentException(\sprintf('The column key "%s" must be lower snake case.', $key));
        }

        return new self($key, $label);
    }

    /**
     * Makes the column sortable by the given field (its key when omitted), e.g. a DQL path such as `o.number`.
     */
    public function sortable(?string $field = null): self
    {
        return new self($this->key, $this->label, $field ?? $this->key);
    }

    public function isSortable(): bool
    {
        return null !== $this->sortField;
    }
}
