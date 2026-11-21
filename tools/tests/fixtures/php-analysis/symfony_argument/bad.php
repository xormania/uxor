<?php

declare(strict_types=1);

namespace UXor\AnalysisEvaluation\Bad\SymfonyArgument;

use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Response;

function pushRequest(ContainerInterface $container): void
{
    $container->get('request_stack')->push(new Response()); // evaluated
}
