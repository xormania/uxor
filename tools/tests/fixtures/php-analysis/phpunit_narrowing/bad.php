<?php

declare(strict_types=1);

namespace UXor\AnalysisEvaluation\Bad\PhpUnitNarrowing;

use PHPUnit\Framework\Assert;
use Symfony\Component\HttpFoundation\Request;

function readStatus(object $value): int
{
    Assert::assertInstanceOf(Request::class, $value);

    return $value->getStatusCode(); // evaluated
}
