<?php

declare(strict_types=1);

namespace UXor\AnalysisEvaluation;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Response;

final class GroundTruthTest extends KernelTestCase
{
    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        foreach (['return_type', 'nullable_receiver', 'symfony_argument', 'phpunit_narrowing'] as $case) {
            require_once __DIR__.'/'.$case.'/good.php';
            require_once __DIR__.'/'.$case.'/bad.php';
        }
    }

    public function testReturnType(): void
    {
        self::assertSame(3, Good\ReturnType\countResults());
        $this->expectException(\TypeError::class);
        $this->expectExceptionMessage('Return value must be of type int');
        Bad\ReturnType\countResults();
    }

    public function testNullableReceiver(): void
    {
        self::assertNull(Good\NullableReceiver\formatDate(null));
        $this->expectException(\Error::class);
        $this->expectExceptionMessage('format() on null');
        Bad\NullableReceiver\formatDate(null);
    }

    public function testSymfonyArgument(): void
    {
        $container = self::getContainer();
        Good\SymfonyArgument\pushRequest($container);
        $stack = $container->get('request_stack');
        self::assertInstanceOf(RequestStack::class, $stack);
        self::assertInstanceOf(Request::class, $stack->pop());
        $this->expectException(\TypeError::class);
        $this->expectExceptionMessage('RequestStack::push()');
        Bad\SymfonyArgument\pushRequest($container);
    }

    public function testPhpunitNarrowing(): void
    {
        self::assertSame(201, Good\PhpUnitNarrowing\readStatus(new Response(status: 201)));
        $this->expectException(\Error::class);
        $this->expectExceptionMessage('Request::getStatusCode()');
        Bad\PhpUnitNarrowing\readStatus(new Request());
    }
}
