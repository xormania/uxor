<?php

namespace App\Controller;

use App\OAuth\DemoIdentityStore;
use App\OAuth\DemoProviders;
use App\OAuth\DemoUser;
use App\UXor\OAuth\OAuthClient;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\Form\ClickableInterface;
use Symfony\Component\Form\Extension\Core\Type\ChoiceType;
use Symfony\Component\Form\Extension\Core\Type\SubmitType;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\Security\Http\Authentication\AuthenticationUtils;
use Symfony\Component\Security\Http\SecurityRequestAttributes;

/** The installed OAuth recipes exercised against offline providers and a real Symfony firewall. */
#[Route('/oauth-demo', options: ['uxor_security' => 'public-reference'])]
final class OAuthDemoController extends AbstractController
{
    #[Route('/login', name: 'app_oauth_demo_login', methods: ['GET'])]
    public function login(AuthenticationUtils $authentication, OAuthClient $oauth): Response
    {
        $error = $authentication->getLastAuthenticationError();

        return $this->render('oauth/login.html.twig', [
            'providers' => $oauth->loginLinks(),
            'feedback' => $error?->getMessageKey(),
        ]);
    }

    #[Route('/account', name: 'app_oauth_demo_account', methods: ['GET'])]
    #[IsGranted('ROLE_USER')]
    public function account(DemoProviders $providers, DemoIdentityStore $identities, CsrfTokenManagerInterface $csrf, AuthenticationUtils $authentication): Response
    {
        $user = $this->getUser();
        if (!$user instanceof DemoUser) {
            throw new \LogicException('The OAuth demo firewall must use the fixture user provider.');
        }
        $linked = $identities->connected($user);
        $accounts = [];
        foreach ($providers->all() as $key => $provider) {
            $identity = null;
            foreach ($linked as $candidate) {
                if ($candidate['provider'] === $key) {
                    $identity = $candidate;
                    break;
                }
            }
            $accounts[] = [
                'provider' => $key,
                'connected' => null !== $identity,
                'identity' => $identity['name'] ?? null,
                'subject' => $identity['subject'] ?? null,
                'connectAction' => $this->generateUrl('uxor_oauth_link', ['provider' => $key]),
                'connectToken' => $csrf->getToken('uxor_oauth_link')->getValue(),
                'disconnectAction' => $this->generateUrl('uxor_oauth_unlink', ['provider' => $key]),
                'disconnectToken' => $csrf->getToken('uxor_oauth_unlink')->getValue(),
                'cannotRemove' => null !== $identity && \count($linked) <= 1,
                'cannotRemoveReason' => 'Keep one provider connected so you can sign in again.',
            ];
        }

        return $this->render('oauth/account.html.twig', [
            'user' => $user,
            'accounts' => $accounts,
            'feedback' => $authentication->getLastAuthenticationError()?->getMessageKey(),
        ]);
    }

    #[Route('/private', name: 'app_oauth_demo_private', methods: ['GET'])]
    #[IsGranted('ROLE_USER')]
    public function privateContent(): Response
    {
        return $this->render('oauth/private.html.twig');
    }

    #[Route('/logout', name: 'app_oauth_demo_logout', methods: ['POST'], options: ['uxor_csrf' => 'firewall-logout'])]
    public function logout(): never
    {
        throw new \LogicException('The OAuth demo firewall handles logout.');
    }

    #[Route('/provider/{provider}/authorize', name: 'app_oauth_demo_authorize', requirements: ['provider' => 'github|google|facebook'], methods: ['GET', 'POST'], options: ['uxor_csrf' => 'symfony-form'])]
    public function authorize(string $provider, Request $request, DemoProviders $providers): Response
    {
        $mock = $providers->get($provider);
        $ticket = $request->query->getString('ticket');
        try {
            $mock->authorization($ticket);
        } catch (CustomUserMessageAuthenticationException $exception) {
            $request->getSession()->set(SecurityRequestAttributes::AUTHENTICATION_ERROR, $exception);

            return $this->redirectToRoute('app_oauth_demo_login', [], Response::HTTP_SEE_OTHER);
        }

        $form = $this->createFormBuilder(null, ['csrf_token_id' => 'oauth_demo_consent'])
            ->add('scenario', ChoiceType::class, [
                'label' => 'Demonstration account',
                'choices' => [
                    'Ada Example' => 'standard',
                    'Account without an email address' => 'missing-email',
                    'A different identity with an existing email' => 'email-collision',
                    'Provider account connected to another user' => 'other-account',
                ],
                'data' => 'standard',
            ])
            ->add('approve', SubmitType::class, ['label' => 'Continue as Ada'])
            ->add('cancel', SubmitType::class, ['label' => 'Cancel sign-in', 'attr' => ['formnovalidate' => true]])
            ->getForm();
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            $scenario = $form->get('scenario')->getData();
            \assert(\is_string($scenario));
            $cancel = $form->get('cancel');

            return $this->redirect($mock->finish($ticket, !($cancel instanceof ClickableInterface && $cancel->isClicked()), $scenario), Response::HTTP_SEE_OTHER);
        }

        return $this->render('oauth/consent.html.twig', [
            'provider' => $provider,
            'provider_name' => match ($provider) {
                'github' => 'GitHub', 'google' => 'Google', 'facebook' => 'Facebook',
                default => throw new \InvalidArgumentException('Unknown demo provider.'),
            },
            'form' => $form,
        ], new Response(null, $form->isSubmitted() ? Response::HTTP_UNPROCESSABLE_ENTITY : Response::HTTP_OK));
    }

}
