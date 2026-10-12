<?php

namespace App\Demo;

use App\UXor\DataTable\Column;
use App\UXor\DataTable\Filter;
use App\UXor\DataTable\TableQuery;
use Symfony\Contracts\Service\Attribute\Required;

/**
 * The demo's orders table, shared by its plain (OrdersTable) and Live (LiveOrdersTable) versions: 57 made-up orders
 * held in memory, searched, filtered, sorted and sliced like a query would.
 */
trait OrdersTableDefinition
{
    private const CUSTOMERS = ['Bonnie Green', 'Jese Leos', 'Neil Sims', 'Lana Byrd', 'Thomas Lean', 'Roberta Casas', 'Michael Gough', 'Karen Nelson'];
    private const STATUSES = ['paid' => 'Paid', 'pending' => 'Pending', 'refunded' => 'Refunded'];

    private ?DataTableCollector $collector = null;

    /**
     * The profiler's record of the loader calls (DataTableCollector), set by the container.
     */
    #[Required]
    public function setCollector(DataTableCollector $collector): void
    {
        $this->collector = $collector;
    }

    public function columns(): array
    {
        return [
            Column::make('number', 'Order')->sortable(),
            Column::make('customer', 'Customer')->sortable(),
            Column::make('status', 'Status'),
            Column::make('total', 'Total')->sortable(),
        ];
    }

    public function filters(): array
    {
        return [Filter::choice('status', 'Status', self::STATUSES)];
    }

    public function defaultSort(): string
    {
        return 'number';
    }

    public function defaultDirection(): string
    {
        return 'desc';
    }

    protected function countRows(TableQuery $query): int
    {
        $this->collector?->record((new \ReflectionClass($this))->getShortName(), 'count');

        return \count(self::matching($query));
    }

    protected function loadRows(TableQuery $query): array
    {
        $this->collector?->record((new \ReflectionClass($this))->getShortName(), 'rows@'.$query->offset());
        $rows = self::matching($query);
        if (null !== $query->sortField) {
            $field = $query->sortField;
            usort($rows, static fn (array $a, array $b): int => ('asc' === $query->direction ? 1 : -1) * ($a[$field] <=> $b[$field] ?: $a['id'] <=> $b['id']));
        }

        return \array_slice($rows, $query->offset(), $query->pageSize);
    }

    /**
     * @return list<array{id: int, number: string, customer: string, status: string, total: int}>
     */
    private static function matching(TableQuery $query): array
    {
        return array_values(array_filter(self::orders(), static fn (array $order): bool => ('' === $query->search
                || str_contains(strtolower($order['number'].' '.$order['customer']), strtolower($query->search)))
            && (!isset($query->filters['status']) || $order['status'] === $query->filters['status'])));
    }

    /**
     * @return list<array{id: int, number: string, customer: string, status: string, total: int}>
     */
    private static function orders(): array
    {
        $statuses = array_keys(self::STATUSES);
        $orders = [];
        for ($id = 1; $id <= 57; ++$id) {
            $orders[] = [
                'id' => $id,
                'number' => \sprintf('#%04d', 1000 + $id),
                'customer' => self::CUSTOMERS[($id * 5) % \count(self::CUSTOMERS)],
                'status' => $statuses[($id * 7) % 3],
                'total' => 20 + ($id * 37) % 480,
            ];
        }

        return $orders;
    }
}
