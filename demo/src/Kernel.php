<?php

namespace App;

use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\HttpKernel\Kernel as BaseKernel;

class Kernel extends BaseKernel
{
    use MicroKernelTrait;

    /**
     * The dynamic demo compiles README examples as Twig and exposes development-only lab routes. Its public copy is
     * the static export; a production server must opt in deliberately and supply its own secret.
     */
    public function boot(): void
    {
        if ('prod' === $this->environment) {
            $allowed = self::environmentValue('UXOR_DEMO_ALLOW_PRODUCTION');
            if ('1' !== $allowed) {
                throw new \LogicException('The dynamic UXor demo is development-only. Publish its static export, or set UXOR_DEMO_ALLOW_PRODUCTION=1 to acknowledge the production risk.');
            }

            $secret = self::environmentValue('APP_SECRET');
            $known = ['', '0d57f3e17626b19cb216c7778f384038', '$ecretf0rt3st', '!ChangeMe!', '!ChangeThisSecret!'];
            if (null === $secret || \strlen($secret) < 32 || \in_array($secret, $known, true)) {
                throw new \LogicException('A dynamic production demo needs a unique APP_SECRET of at least 32 characters; the committed development and test values are refused.');
            }
        }

        parent::boot();
    }

    private static function environmentValue(string $name): ?string
    {
        $value = $_SERVER[$name] ?? $_ENV[$name] ?? getenv($name);

        return \is_string($value) ? $value : null;
    }
}
