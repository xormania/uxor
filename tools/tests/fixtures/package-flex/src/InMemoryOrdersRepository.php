<?php

namespace Consumer;

final class InMemoryOrdersRepository implements OrdersRepository
{
    public function all(): array
    {
        return [
            ['id' => 1, 'number' => 'ORD-001', 'customer' => 'Alice <script>alert(1)</script>'],
            ['id' => 2, 'number' => 'ORD-002', 'customer' => 'Bob'],
        ];
    }
}
