<?php

namespace App\Controller;

use App\UXor\Editor\EditorType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class PostController extends AbstractController
{
    #[Route('/post', name: 'app_post')]
    public function post(Request $request): Response
    {
        $form = $this->createFormBuilder()
            ->add('body', EditorType::class, ['help' => 'Headings, lists and links are kept.'])
            ->getForm();
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            return $this->redirectToRoute('app_post', ['stored' => $form->get('body')->getData()], Response::HTTP_SEE_OTHER);
        }

        return $this->render('post/index.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
    }
}
