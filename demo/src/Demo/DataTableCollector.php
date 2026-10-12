<?php

namespace App\Demo;

use Symfony\Bundle\FrameworkBundle\DataCollector\AbstractDataCollector;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Records what a request makes the demo's data tables do (each countRows() and loadRows() call), for the profiler.
 * The profiler is on in the test environment only (config/packages/framework.yaml): functional tests read the calls
 * from a request's profile (tests/Functional/DataTableRequestsTest.php). Elsewhere it is an unread list.
 */
final class DataTableCollector extends AbstractDataCollector
{
    /** @var list<string> */
    private array $calls = [];

    /**
     * Records a call: `count`, or `rows@<offset>`.
     */
    public function record(string $table, string $call): void
    {
        $this->calls[] = $table.': '.$call;
    }

    public function collect(Request $request, Response $response, ?\Throwable $exception = null): void
    {
        $this->data = ['calls' => $this->calls];
    }

    /**
     * @return list<string> each call as `<table class without namespace>: count` or `…: rows@<offset>`, in order
     */
    public function getCalls(): array
    {
        /** @var list<string> */
        return $this->data['calls'] ?? [];
    }

    public function reset(): void
    {
        parent::reset();
        $this->calls = [];
    }

    public static function getTemplate(): ?string
    {
        return null;
    }
}
