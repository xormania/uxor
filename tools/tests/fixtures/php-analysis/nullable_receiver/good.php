<?php

declare(strict_types=1);

namespace UXor\AnalysisEvaluation\Good\NullableReceiver;

use DateTimeImmutable;

function formatDate(?DateTimeImmutable $date): ?string
{
    return $date?->format('Y-m-d'); // evaluated
}
