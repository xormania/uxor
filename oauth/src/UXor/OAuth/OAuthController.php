<?php

namespace App\UXor\OAuth;

use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;
use Symfony\Component\Security\Csrf\CsrfToken;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Symfony\Component\Security\Http\SecurityRequestAttributes;

#[Route('/oauth/{provider}', requirements: ['provider' => '[a-z][a-z0-9_-]{0,31}'])]
#[AsController]
#[Exclude]
final class OAuthController
{
    public function __construct(
        private readonly OAuthClient $client,
        private readonly IdentityStoreInterface $identities,
        private readonly Security $security,
        private readonly AuthorizationCheckerInterface $authorization,
        private readonly CsrfTokenManagerInterface $csrf,
        private readonly UrlGeneratorInterface $urls,
        private readonly string $defaultTargetRoute = 'app_home',
        private readonly string $loginRoute = 'app_login',
    ) {
    }

    #[Route('/start', name: 'uxor_oauth_start', methods: ['GET'])]
    public function start(Request $request, string $provider): Response
    {
        try {
            return new RedirectResponse($this->client->start($provider, $this->target($request)));
        } catch (\InvalidArgumentException) {
            $request->getSession()->set(SecurityRequestAttributes::AUTHENTICATION_ERROR,
                new CustomUserMessageAuthenticationException('This sign-in provider is unavailable. Please choose another.'));

            return new RedirectResponse($this->urls->generate($this->loginRoute), Response::HTTP_SEE_OTHER);
        }
    }

    #[Route('/check', name: 'uxor_oauth_check', methods: ['GET'])]
    public function check(): never
    {
        throw new \LogicException('Register OAuthAuthenticator on the firewall covering the callback route.');
    }

    #[Route('/link', name: 'uxor_oauth_link', methods: ['POST'])]
    public function link(Request $request, string $provider): Response
    {
        $user = $this->security->getUser();
        if ($user === null || !$this->authorization->isGranted('IS_AUTHENTICATED_FULLY')) {
            throw new AccessDeniedHttpException('Sign in before connecting a provider.');
        }
        $this->checkCsrf($request, 'uxor_oauth_link');

        try {
            return new RedirectResponse($this->client->start($provider, $this->target($request), 'link', $user->getUserIdentifier()), Response::HTTP_SEE_OTHER);
        } catch (\InvalidArgumentException) {
            $request->getSession()->set(SecurityRequestAttributes::AUTHENTICATION_ERROR,
                new CustomUserMessageAuthenticationException('This sign-in provider is unavailable. Please choose another.'));

            return new RedirectResponse($this->target($request), Response::HTTP_SEE_OTHER);
        }
    }

    #[Route('/unlink', name: 'uxor_oauth_unlink', methods: ['POST'])]
    public function unlink(Request $request, string $provider): Response
    {
        $user = $this->security->getUser();
        if ($user === null || !$this->authorization->isGranted('IS_AUTHENTICATED_FULLY')) {
            throw new AccessDeniedHttpException('Sign in before disconnecting a provider.');
        }
        $this->checkCsrf($request, 'uxor_oauth_unlink');
        try {
            $this->identities->unlink($user, $provider, $request->request->getString('subject'));
        } catch (CustomUserMessageAuthenticationException $exception) {
            $request->getSession()->set(SecurityRequestAttributes::AUTHENTICATION_ERROR, $exception);
        }

        return new RedirectResponse($this->target($request), Response::HTTP_SEE_OTHER);
    }

    private function checkCsrf(Request $request, string $id): void
    {
        if (!$this->csrf->isTokenValid(new CsrfToken($id, $request->request->getString('_csrf_token')))) {
            throw new AccessDeniedHttpException('The account change could not be verified.');
        }
    }

    private function target(Request $request): string
    {
        $target = $request->query->all()['returnTo'] ?? $request->request->all()['returnTo'] ?? null;
        if (is_string($target) && OAuthAttemptStore::isSafeTarget($target)) {
            return $target;
        }
        $firewall = $this->security->getFirewallConfig($request)?->getName();
        $saved = $firewall === null ? null : $request->getSession()->get('_security.'.$firewall.'.target_path');
        if (is_string($saved)) {
            // Symfony records absolute URLs. Accept only this origin, then store a local path for the callback.
            $origin = $request->getSchemeAndHttpHost();
            if (str_starts_with($saved, $origin.'/')) {
                $saved = substr($saved, strlen($origin));
            }
            if (OAuthAttemptStore::isSafeTarget($saved)) {
                return $saved;
            }
        }

        return $this->urls->generate($this->defaultTargetRoute);
    }
}
