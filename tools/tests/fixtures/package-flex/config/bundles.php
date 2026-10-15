<?php

// Pre-existing application Twig support: this dependency's bridge is not discoverable
// by Flex's bundle naming convention. Flex registers UXor and other dependency bundles.
return [
    TalesFromADev\Twig\Extra\Tailwind\Bridge\Symfony\Bundle\TalesFromADevTwigExtraTailwindBundle::class => ['all' => true],
];
