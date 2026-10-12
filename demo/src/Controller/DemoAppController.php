<?php

namespace App\Controller;

use App\Form\ForgotPasswordType;
use App\Form\LoginType;
use App\Form\NotificationsType;
use App\Form\ProfileType;
use App\Form\RegistrationType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Authentication\AuthenticationUtils;
use Symfony\Component\Security\Http\Event\LogoutEvent;

/**
 * Every layout and block of the kit as a real page of a small application (/demo), wired the way their
 * READMEs show. Sign in with demo@example.com / demo.
 */
#[Route('/demo', options: ['uxor_security' => 'public-reference'])]
final class DemoAppController extends AbstractController
{
    #[Route('', name: 'app_demo', methods: ['GET'])]
    public function dashboard(): Response
    {
        return $this->render('demo_app/dashboard.html.twig');
    }

    #[Route('/login', name: 'app_demo_login', methods: ['GET', 'POST'], options: ['uxor_csrf' => 'firewall-form'])]
    public function login(AuthenticationUtils $authenticationUtils): Response
    {
        $form = $this->createForm(LoginType::class, ['_username' => $authenticationUtils->getLastUsername()]);

        return $this->render('demo_app/login.html.twig', ['form' => $form, 'error' => $authenticationUtils->getLastAuthenticationError()]);
    }

    #[Route('/logout', name: 'app_demo_logout', methods: ['POST'], options: ['uxor_csrf' => 'firewall-logout'])]
    public function logout(): never
    {
        throw new \LogicException('The firewall handles the logout.');
    }

    /**
     * A flash message for the login page (the auth layout), after the firewall has invalidated the session.
     */
    #[AsEventListener(event: LogoutEvent::class, dispatcher: 'security.event_dispatcher.main', priority: -100)]
    public function onLogout(LogoutEvent $event): void
    {
        $event->getRequest()->getSession()->getFlashBag()->add('info', 'You are signed out.');
    }

    #[Route('/signup', name: 'app_demo_signup', methods: ['GET', 'POST'], options: ['uxor_csrf' => 'symfony-form'])]
    public function signup(Request $request): Response
    {
        $form = $this->createForm(RegistrationType::class);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            $this->addFlash('success', 'Welcome aboard!');

            return $this->redirectToRoute('app_demo', [], Response::HTTP_SEE_OTHER);
        }

        return $this->render('demo_app/signup.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/forgot-password', name: 'app_demo_forgot_password', methods: ['GET', 'POST'], options: ['uxor_csrf' => 'symfony-form'])]
    public function forgotPassword(Request $request): Response
    {
        $form = $this->createForm(ForgotPasswordType::class);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            // ... send the link; Turbo needs a redirect after a successful submit
            return $this->redirectToRoute('app_demo_forgot_password', ['sent' => 1], Response::HTTP_SEE_OTHER);
        }

        return $this->render('demo_app/forgot_password.html.twig', ['form' => $form, 'sent' => $request->query->getBoolean('sent')], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/settings/profile', name: 'app_demo_settings_profile', methods: ['GET', 'POST'], options: ['uxor_csrf' => 'symfony-form'])]
    public function settingsProfile(Request $request): Response
    {
        $form = $this->createForm(ProfileType::class, ['name' => 'Bonnie Green', 'email' => 'bonnie@example.com']);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            $this->addFlash('success', 'Profile saved.');

            return $this->redirectToRoute('app_demo_settings_profile', [], Response::HTTP_SEE_OTHER);
        }

        return $this->render('demo_app/settings_profile.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/settings/notifications', name: 'app_demo_settings_notifications', methods: ['GET', 'POST'], options: ['uxor_csrf' => 'symfony-form'])]
    public function settingsNotifications(Request $request): Response
    {
        $form = $this->createForm(NotificationsType::class, ['orders' => true, 'mentions' => true, 'newsletter' => false]);
        $form->handleRequest($request);
        if ($form->isSubmitted() && $form->isValid()) {
            $this->addFlash('success', 'Preferences saved.');

            return $this->redirectToRoute('app_demo_settings_notifications', [], Response::HTTP_SEE_OTHER);
        }

        return $this->render('demo_app/settings_notifications.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
    }

    #[Route('/settings/billing', name: 'app_demo_settings_billing', methods: ['GET'])]
    public function settingsBilling(): Response
    {
        return $this->render('demo_app/settings_billing.html.twig');
    }

    #[Route('/blank', name: 'app_demo_blank', methods: ['GET'])]
    public function blank(): Response
    {
        return $this->render('demo_app/blank.html.twig');
    }

    #[Route('/not-found', name: 'app_demo_not_found', methods: ['GET'])]
    public function notFound(): Response
    {
        return $this->render('demo_app/not_found.html.twig', [], new Response(null, Response::HTTP_NOT_FOUND));
    }
}
