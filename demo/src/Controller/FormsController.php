<?php

namespace App\Controller;

use App\Form\DemoType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * The form-theme recipe on a real Symfony form: every field type, server-side validation errors, and a
 * page comparing theme-rendered rows with the same rows written by hand with the components.
 */
#[Route('/forms', options: ['uxor_security' => 'public-reference'])]
final class FormsController extends AbstractController
{
    #[Route('', name: 'app_forms', methods: ['GET', 'POST'], options: ['uxor_csrf' => 'symfony-form'])]
    public function index(Request $request): Response
    {
        $form = $this->createForm(DemoType::class);
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            $this->addFlash('success', 'Account created.');

            return $this->redirectToRoute('app_forms', [], Response::HTTP_SEE_OTHER);
        }

        // 422 lets Turbo render the page again with the errors
        return $this->render('forms/index.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/parity', name: 'app_forms_parity', methods: ['GET'])]
    public function parity(): Response
    {
        $form = $this->createForm(DemoType::class, null, ['csrf_protection' => false]);
        $form->submit(['name' => 'A', 'bio' => 'Designer in Lyon.', 'startsOn' => '2026-03-12', 'country' => '', 'save' => '']);

        return $this->render('forms/parity.html.twig', ['form' => $form->createView()]);
    }
}
