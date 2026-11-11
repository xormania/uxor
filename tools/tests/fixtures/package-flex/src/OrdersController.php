<?php

namespace Consumer;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Twig\Environment;

final class OrdersController
{
    public function __construct(private readonly Environment $twig, private readonly OrdersTable $table)
    {
    }

    public function __invoke(Request $request): Response
    {
        return new Response($this->twig->render('orders.html.twig', ['table' => $this->table->handleRequest($request)]));
    }
}
