<?php

namespace App\EventListener;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/** Per-request nonces and policy follow the UXor demo's AssetMapper/Turbo integration. */
final class SecurityHeadersListener
{
    #[AsEventListener(KernelEvents::REQUEST, priority: 256)]
    public function initializeNonce(RequestEvent $event): void
    {
        if ($event->isMainRequest()) {
            $event->getRequest()->attributes->set('csp_nonce', base64_encode(random_bytes(18)));
        }
    }

    #[AsEventListener(KernelEvents::RESPONSE)]
    public function addHeaders(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $headers = $event->getResponse()->headers;
        $headers->set('X-Content-Type-Options', 'nosniff');
        $headers->set('Referrer-Policy', 'same-origin');
        // Symfony debug error documents have their own inline scripts; errors still fail browser checks.
        if ($event->getResponse()->getStatusCode() >= 500) {
            return;
        }
        $nonce = $event->getRequest()->attributes->get('csp_nonce');
        $headers->set('Content-Security-Policy', "default-src 'self'; script-src 'nonce-$nonce' 'strict-dynamic'; style-src 'self' 'nonce-$nonce'; script-src-attr 'none'; style-src-attr 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    }
}
