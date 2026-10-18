<?php

namespace App\Controller;

use App\Customer\CustomerStore;
use App\Form\CustomerType;
use App\Table\CustomersTable;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\UX\Turbo\TurboBundle;

final class CustomerController extends AbstractController
{
    #[Route('/customers', name: 'customers', methods: ['GET'])]
    public function index(Request $request, CustomersTable $table): Response
    {
        return $this->render('customer/index.html.twig', ['table' => $table->handleRequest($request)]);
    }

    #[Route('/customers/{id}/edit', name: 'customer_edit', requirements: ['id' => '\\d+'], methods: ['GET', 'POST'])]
    public function edit(int $id, Request $request, CustomerStore $customers, CustomersTable $table): Response
    {
        $customer = $customers->find($id) ?? throw $this->createNotFoundException('Customer not found.');
        $form = $this->createForm(CustomerType::class, $customer, [
            'action' => $this->generateUrl('customer_edit', [...$request->query->all(), 'id' => $id]),
        ]);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            $values = $form->getData();
            $customers->save($id, $values['name'], $values['email']);
            if (str_contains($request->headers->get('Accept', ''), 'text/vnd.turbo-stream.html')) {
                $request->setRequestFormat(TurboBundle::STREAM_FORMAT);
                // Use the list's real URL for the refreshed table, retaining its search/sort/page query.
                $listRequest = Request::create($this->generateUrl('customers', $request->query->all()));

                return $this->render('customer/saved.stream.html.twig', ['table' => $table->handleRequest($listRequest), 'customer' => $values + ['id' => $id]]);
            }
            $this->addFlash('success', 'Customer saved.');

            return $this->redirectToRoute('customers', $request->query->all(), Response::HTTP_SEE_OTHER);
        }

        return $this->render('customer/edit.html.twig', ['form' => $form, 'customer' => $customer], new Response(null, $form->isSubmitted() ? 422 : 200));
    }
}
