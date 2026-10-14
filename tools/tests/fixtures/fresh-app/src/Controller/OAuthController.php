<?php

namespace App\Controller;

use App\OAuth\InstallUser;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Authentication\AuthenticationUtils;

final class OAuthController extends AbstractController
{
    #[Route('/oauth-install/login', name: 'app_oauth_install_login', methods: ['GET'])]
    public function login(AuthenticationUtils $authentication): Response
    {
        return $this->render('oauth/login.html.twig', ['error' => $authentication->getLastAuthenticationError()]);
    }

    #[Route('/oauth-install/account', name: 'app_oauth_install_account', methods: ['GET'])]
    public function account(): Response
    {
        $this->denyAccessUnlessGranted('ROLE_USER');
        $user = $this->getUser();
        \assert($user instanceof InstallUser);

        return $this->render('oauth/account.html.twig', ['user' => $user]);
    }
}
