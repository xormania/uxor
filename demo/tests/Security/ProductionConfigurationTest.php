<?php

namespace App\Tests\Security;

use App\Kernel;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Symfony\UX\Toolkit\UXToolkitBundle;

final class ProductionConfigurationTest extends TestCase
{
    #[DataProvider('unsafeProductionEnvironment')]
    public function testProductionRefusesAnAccidentalDeployment(bool $allowed, ?string $secret, string $message): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage($message);

        self::withEnvironment($allowed, $secret, static function (): void {
            (new Kernel('prod', false))->boot();
        });
    }

    /** @return iterable<string, array{bool, string|null, string}> */
    public static function unsafeProductionEnvironment(): iterable
    {
        $strong = str_repeat('a', 64);

        yield 'no explicit opt-in' => [false, $strong, 'development-only'];
        yield 'no secret' => [true, null, 'unique APP_SECRET'];
        yield 'short secret' => [true, str_repeat('a', 31), 'unique APP_SECRET'];
        yield 'committed development secret' => [true, '0d57f3e17626b19cb216c7778f384038', 'unique APP_SECRET'];
        yield 'committed test secret' => [true, '$ecretf0rt3st', 'unique APP_SECRET'];
    }

    public function testAnExplicitProductionBootHasNoDevelopmentToolkitOrProfiler(): void
    {
        self::withEnvironment(true, str_repeat('production-secret-', 4), static function (): void {
            $kernel = new Kernel('prod', false);
            $kernel->boot();

            try {
                self::assertSame('prod', $kernel->getEnvironment());
                self::assertNotContains(UXToolkitBundle::class, array_map('get_class', $kernel->getBundles()));
                self::assertFalse(self::hasService($kernel->getContainer(), 'profiler'));
            } finally {
                $kernel->shutdown();
            }
        });
    }

    /**
     * The prod image's build boots the kernel in prod (post-install-cmd's cache:clear, asset-map:compile): its step must
     * give those commands the opt-in and a secret, after dump-env so neither is written into the image.
     */
    public function testTheProdImageBuildGivesItsConsoleCommandsTheOptInWithoutBakingIt(): void
    {
        $dockerfile = (string) file_get_contents(\dirname(__DIR__, 2).'/Dockerfile');
        self::assertMatchesRegularExpression('/AS frankenphp_prod_builder\b(.*?)\nFROM /s', $dockerfile);
        preg_match('/AS frankenphp_prod_builder\b(.*?)\nFROM /s', $dockerfile, $stage);
        $builder = $stage[1];

        $export = strpos($builder, 'export UXOR_DEMO_ALLOW_PRODUCTION=1 APP_SECRET="$(php -r \'echo bin2hex(random_bytes(32));\')"');
        self::assertNotFalse($export, 'the prod builder exports the opt-in and a random secret for its console step');
        $dumpEnv = strpos($builder, 'composer dump-env prod');
        self::assertNotFalse($dumpEnv);
        self::assertGreaterThan($dumpEnv, $export, 'after dump-env, so neither value is written into the image');
        foreach (['post-install-cmd', 'asset-map:compile'] as $command) {
            $at = strpos($builder, $command);
            self::assertNotFalse($at, $command);
            self::assertLessThan($at, $export, "before {$command}, which boots the kernel in prod");
        }
        self::assertStringNotContainsString('ENV UXOR_DEMO_ALLOW_PRODUCTION', $dockerfile, 'never a persistent opt-in');
    }

    private static function hasService(ContainerInterface $container, string $id): bool
    {
        return $container->has($id);
    }

    private static function withEnvironment(bool $allowed, ?string $secret, \Closure $callback): void
    {
        $values = [
            'UXOR_DEMO_ALLOW_PRODUCTION' => $allowed ? '1' : '0',
            'APP_SECRET' => $secret,
        ];
        $previous = [];
        foreach ($values as $name => $value) {
            $previous[$name] = [
                'server' => array_key_exists($name, $_SERVER) ? $_SERVER[$name] : null,
                'server_exists' => array_key_exists($name, $_SERVER),
                'env' => array_key_exists($name, $_ENV) ? $_ENV[$name] : null,
                'env_exists' => array_key_exists($name, $_ENV),
                'process' => getenv($name),
            ];
            if (null === $value) {
                unset($_SERVER[$name], $_ENV[$name]);
                putenv($name);
            } else {
                $_SERVER[$name] = $_ENV[$name] = $value;
                putenv("{$name}={$value}");
            }
        }

        try {
            $callback();
        } finally {
            foreach ($previous as $name => $value) {
                if ($value['server_exists']) {
                    $_SERVER[$name] = $value['server'];
                } else {
                    unset($_SERVER[$name]);
                }
                if ($value['env_exists']) {
                    $_ENV[$name] = $value['env'];
                } else {
                    unset($_ENV[$name]);
                }
                false === $value['process'] ? putenv($name) : putenv("{$name}={$value['process']}");
            }
        }
    }
}
