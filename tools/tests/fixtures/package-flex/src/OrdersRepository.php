<?php

namespace Consumer;

interface OrdersRepository
{
    /** @return list<array{id: int, number: string, customer: string}> */
    public function all(): array;
}
