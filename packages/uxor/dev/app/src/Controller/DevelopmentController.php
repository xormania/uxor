<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class DevelopmentController extends AbstractController
{
    #[Route('/', name: 'development_home', methods: ['GET'])]
    public function index(): Response
    {
        return $this->render('development.html.twig');
    }

    #[Route('/health', name: 'development_health', methods: ['GET'])]
    public function health(): Response
    {
        return new Response('uxor-ready', headers: ['Content-Type' => 'text/plain; charset=utf-8']);
    }

    #[Route('/panel', name: 'development_panel', methods: ['GET'])]
    public function panel(): Response
    {
        return $this->render('panel.html.twig');
    }
}
