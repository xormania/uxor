<?php

namespace App\Controller;

use App\UXor\MarkdownEditor\MarkdownType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class NoteController extends AbstractController
{
    #[Route('/note', name: 'app_note')]
    public function note(Request $request): Response
    {
        $form = $this->createFormBuilder()
            ->add('body', MarkdownType::class, ['help' => 'Markdown: **bold**, _italic_, lists, links.'])
            ->getForm();
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            return $this->redirectToRoute('app_note', ['stored' => $form->get('body')->getData()], Response::HTTP_SEE_OTHER);
        }

        return $this->render('note/index.html.twig', ['form' => $form, 'stored' => $request->query->get('stored')], new Response(null, $form->isSubmitted() ? 422 : 200));
    }
}
