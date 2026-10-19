<?php

namespace App\Customer;

use Symfony\Component\HttpFoundation\RequestStack;

/** Session-isolated application state; no shared mutable test database. */
final class CustomerStore
{
    private const SESSION_KEY = 'workflow_customers';

    public function __construct(private readonly RequestStack $requests)
    {
    }

    /** @return list<array{id: int, name: string, email: string}> */
    public function all(): array
    {
        $session = $this->requests->getSession();
        if (!$session->has(self::SESSION_KEY)) {
            $session->set(self::SESSION_KEY, [
                ['id' => 1, 'name' => 'Ada Lovelace', 'email' => 'ada@example.test'],
                ['id' => 2, 'name' => 'Grace Hopper', 'email' => 'grace@example.test'],
                ['id' => 3, 'name' => 'Katherine Johnson', 'email' => 'katherine@example.test'],
                ['id' => 4, 'name' => 'Margaret Hamilton', 'email' => 'margaret@example.test'],
            ]);
        }

        return $session->get(self::SESSION_KEY);
    }

    public function find(int $id): ?array
    {
        foreach ($this->all() as $customer) {
            if ($customer['id'] === $id) {
                return $customer;
            }
        }

        return null;
    }

    public function save(int $id, string $name, string $email): void
    {
        $customers = $this->all();
        foreach ($customers as &$customer) {
            if ($customer['id'] === $id) {
                $customer = ['id' => $id, 'name' => $name, 'email' => $email];
                $this->requests->getSession()->set(self::SESSION_KEY, $customers);

                return;
            }
        }

        throw new \OutOfBoundsException('The customer no longer exists.');
    }
}
