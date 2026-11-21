<?php

declare(strict_types=1);

namespace UXor\AnalysisEvaluation\Bad\ReturnType;

function countResults(): int
{
    return 'three'; // evaluated
}
