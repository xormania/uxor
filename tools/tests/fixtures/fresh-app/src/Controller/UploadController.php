<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\UX\Dropzone\Form\DropzoneType;

final class UploadController extends AbstractController
{
    #[Route('/upload', name: 'app_upload')]
    public function upload(Request $request): Response
    {
        $form = $this->createFormBuilder()
            ->add('photo', DropzoneType::class, ['required' => false, 'help' => 'PNG or JPG, up to 1 MB.'])
            ->add('files', DropzoneType::class, ['required' => false, 'multiple' => true])
            // no main line in its box (placeholder: false), and the kit's default phrase for custom attr and no placeholder
            ->add('quiet', DropzoneType::class, ['required' => false, 'placeholder' => false])
            ->add('typed', DropzoneType::class, ['required' => false, 'attr' => ['accept' => 'image/png']])
            ->getForm();
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            $photo = $form->get('photo')->getData();

            return $this->redirectToRoute('app_upload', ['uploaded' => $photo instanceof UploadedFile ? $photo->getClientOriginalName() : ''], Response::HTTP_SEE_OTHER);
        }

        return $this->render('upload/index.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
    }
}
