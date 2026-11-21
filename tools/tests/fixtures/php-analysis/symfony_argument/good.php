<?php

declare(strict_types=1);

namespace UXor\AnalysisEvaluation\Good\SymfonyArgument;

use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

function pushRequest(ContainerInterface $container): void
{
    $container->get('request_stack')->push(new Request()); // evaluated
}
