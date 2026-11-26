<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\Routing\Attribute\Route;

final class HomeController extends AbstractController
{
    #[Route('/', name: 'app_home', methods: ['GET'], options: ['uxor_security' => 'public-read'])]
    public function __invoke(): RedirectResponse
    {
        return $this->redirectToRoute('app_demo');
    }
}
