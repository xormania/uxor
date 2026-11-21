<?php

declare(strict_types=1);

namespace UXor\AnalysisEvaluation\Good\PhpUnitNarrowing;

use PHPUnit\Framework\Assert;
use Symfony\Component\HttpFoundation\Response;

function readStatus(object $value): int
{
    Assert::assertInstanceOf(Response::class, $value);

    return $value->getStatusCode(); // evaluated
}
