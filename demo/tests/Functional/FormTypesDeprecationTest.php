<?php

namespace App\Tests\Functional;

use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Form\FormFactoryInterface;

/**
 * Every form type of the demo builds, and gives its view, without a deprecation: a package update that deprecates an
 * option the demo passes (UX Dropzone 3.7's `attr.placeholder`) fails here, not only in a log. The deprecation is
 * triggered inside the vendor's option normalizer, which PHPUnit counts as indirect and this suite ignores
 * (`ignoreIndirectDeprecations`), so the test collects them itself.
 */
final class FormTypesDeprecationTest extends KernelTestCase
{
    /** @return iterable<string, array{class-string}> */
    public static function formTypes(): iterable
    {
        foreach (glob(\dirname(__DIR__, 2).'/src/Form/*.php') ?: [] as $file) {
            $class = 'App\\Form\\'.basename($file, '.php');
            yield basename($file, '.php') => [$class];
        }
    }

    /** @param class-string $class */
    #[DataProvider('formTypes')]
    public function testTheFormTypeBuildsWithoutADeprecation(string $class): void
    {
        $factory = static::getContainer()->get('form.factory');
        self::assertInstanceOf(FormFactoryInterface::class, $factory);

        $deprecations = [];
        set_error_handler(static function (int $level, string $message) use (&$deprecations): bool {
            $deprecations[] = $message;

            return true;
        }, \E_USER_DEPRECATED | \E_DEPRECATED);
        try {
            $factory->create($class)->createView();
        } finally {
            restore_error_handler();
        }

        self::assertSame([], $deprecations, $class);
    }
}
