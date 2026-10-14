<?php

namespace App\UXor\OAuth;

use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;
use Symfony\Component\Security\Http\Authenticator\AbstractAuthenticator;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;
use Symfony\Component\Security\Http\Authenticator\Passport\SelfValidatingPassport;
use Symfony\Component\Security\Http\EntryPoint\AuthenticationEntryPointInterface;
use Symfony\Component\Security\Http\SecurityRequestAttributes;

#[Exclude]
final class OAuthAuthenticator extends AbstractAuthenticator implements AuthenticationEntryPointInterface
{
    public function __construct(
        private readonly OAuthClient $client,
        private readonly IdentityStoreInterface $identities,
        private readonly Security $security,
        private readonly AuthorizationCheckerInterface $authorization,
        private readonly UrlGeneratorInterface $urls,
        private readonly string $loginRoute = 'app_login',
    ) {
    }

    public function supports(Request $request): bool
    {
        return $request->attributes->get('_route') === 'uxor_oauth_check';
    }

    public function authenticate(Request $request): Passport
    {
        try {
            $result = $this->client->complete($request);
            if ($result->attempt->intent === 'link') {
                $user = $this->security->getUser();
                if ($user === null || !$this->authorization->isGranted('IS_AUTHENTICATED_FULLY')
                    || !hash_equals($result->attempt->userIdentifier ?? '', $user->getUserIdentifier())) {
                    throw new CustomUserMessageAuthenticationException('Sign in to the same account before connecting a provider.');
                }
                $this->identities->link($user, $result->identity);
            } else {
                $user = $this->identities->resolve($result->identity);
            }
        } catch (CustomUserMessageAuthenticationException $exception) {
            throw $exception;
        } catch (\Exception) {
            // Provider exceptions can contain access tokens or upstream response bodies. Never expose them.
            throw new CustomUserMessageAuthenticationException('The provider could not complete sign-in. Please try again.');
        }

        $request->attributes->set('_uxor_oauth_target', $result->attempt->target);

        return new SelfValidatingPassport(new UserBadge($user->getUserIdentifier(), static fn () => $user));
    }

    public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): Response
    {
        $request->getSession()->remove('_security.'.$firewallName.'.target_path');

        return new RedirectResponse($request->attributes->getString('_uxor_oauth_target'), Response::HTTP_SEE_OTHER);
    }

    public function onAuthenticationFailure(Request $request, AuthenticationException $exception): Response
    {
        $request->getSession()->set(SecurityRequestAttributes::AUTHENTICATION_ERROR, $exception);
        $attempt = $request->attributes->get('_uxor_oauth_attempt');
        $user = $this->security->getUser();
        if ($attempt instanceof OAuthAttempt && $attempt->intent === 'link' && $user !== null
            && $this->authorization->isGranted('IS_AUTHENTICATED_FULLY')
            && hash_equals($attempt->userIdentifier ?? '', $user->getUserIdentifier())) {
            return new RedirectResponse($attempt->target, Response::HTTP_SEE_OTHER);
        }

        return new RedirectResponse($this->urls->generate($this->loginRoute), Response::HTTP_SEE_OTHER);
    }

    public function start(Request $request, ?AuthenticationException $authException = null): Response
    {
        return new RedirectResponse($this->urls->generate($this->loginRoute));
    }
}
