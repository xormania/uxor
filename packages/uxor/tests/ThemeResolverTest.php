<?php

declare(strict_types=1);

namespace Xormania\UXor\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Xormania\UXor\Theme\InMemoryThemeCatalog;
use Xormania\UXor\Theme\ThemeContext;
use Xormania\UXor\Theme\ThemeDefinition;
use Xormania\UXor\Theme\ThemeResolver;

final class ThemeResolverTest extends TestCase
{
    public function testApplicationThenSelectedThemeThenDefaultPresentation(): void
    {
        $resolved = $this->resolver()->resolve(new ThemeContext('editorial', 'dark'), [
            'Button' => 'app/button.html.twig',
            'CustomerSummary' => 'app/customer.html.twig',
        ]);

        self::assertSame('editorial', $resolved->themeId);
        self::assertSame('2', $resolved->revision);
        self::assertSame('dark', $resolved->mode);
        self::assertSame([
            'Button' => 'app/button.html.twig',
            'Card' => 'editorial/card.html.twig',
            'CustomerSummary' => 'app/customer.html.twig',
            'Input' => 'default/input.html.twig',
        ], $resolved->templates);
        self::assertSame([
            'Button' => ['source' => 'application', 'theme' => null, 'revision' => null],
            'Card' => ['source' => 'theme', 'theme' => 'editorial', 'revision' => '2'],
            'CustomerSummary' => ['source' => 'application', 'theme' => null, 'revision' => null],
            'Input' => ['source' => 'default', 'theme' => 'default', 'revision' => '1'],
        ], $resolved->templateOrigins);
        self::assertSame([], $resolved->fallbacks);
    }

    public function testUnavailablePreferencesExplainFallbackAndDoNotAffectTheNextRequest(): void
    {
        $resolver = $this->resolver();
        $first = $resolver->resolve(new ThemeContext('editorial', 'dark'), ['Input' => 'app/input.html.twig']);
        $stale = $resolver->resolve(new ThemeContext('removed-theme', 'removed-mode'));
        $next = $resolver->resolve(new ThemeContext());

        self::assertSame(['theme_unavailable', 'mode_unavailable'], $stale->fallbacks);
        self::assertSame('default', $stale->themeId);
        self::assertSame('light', $stale->mode);
        self::assertSame('default/input.html.twig', $stale->templates['Input']);
        self::assertSame([], $next->fallbacks);
        self::assertSame('light', $next->mode);
        self::assertSame('default/card.html.twig', $next->templates['Card']);
        self::assertSame('app/input.html.twig', $first->templates['Input']);
    }

    public function testSelectedThemeOwnsItsModeDefault(): void
    {
        $resolver = $this->resolver();
        self::assertSame('dark', $resolver->resolve(new ThemeContext('editorial'))->mode);
        $unavailable = $resolver->resolve(new ThemeContext('editorial', 'sepia'));
        self::assertSame('editorial', $unavailable->themeId);
        self::assertSame('dark', $unavailable->mode);
        self::assertSame(['mode_unavailable'], $unavailable->fallbacks);
    }

    public function testMissingConfiguredDefaultIsAnInstallationError(): void
    {
        $resolver = new ThemeResolver(new InMemoryThemeCatalog([]), 'missing');
        $this->expectException(\LogicException::class);
        $resolver->resolve(new ThemeContext('editorial'));
    }

    public function testDuplicateInstalledIdentitiesAreRejectedRegardlessOfRevision(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new InMemoryThemeCatalog([
            new ThemeDefinition('default', '1', ['light'], 'light'),
            new ThemeDefinition('default', '2', ['dark'], 'dark'),
        ]);
    }

    public function testCatalogOrderDoesNotChangeResolution(): void
    {
        $default = new ThemeDefinition('default', '1', ['light'], 'light', ['Z' => 'z.twig', 'A' => 'a.twig']);
        $alternative = new ThemeDefinition('alternative', '1', ['light'], 'light', ['B' => 'b.twig']);
        $first = new ThemeResolver(new InMemoryThemeCatalog([$default, $alternative]), 'default');
        $second = new ThemeResolver(new InMemoryThemeCatalog([$alternative, $default]), 'default');
        self::assertEquals($first->resolve(new ThemeContext('alternative')), $second->resolve(new ThemeContext('alternative')));
        self::assertSame(['A', 'B', 'Z'], array_keys($first->resolve(new ThemeContext('alternative'))->templates));
    }

    #[DataProvider('invalidDefinitions')]
    public function testInvalidInstalledDefinitionsAreRejected(array $arguments): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new ThemeDefinition(...$arguments);
    }

    public static function invalidDefinitions(): iterable
    {
        yield 'blank identity' => [[' ', '1', ['light'], 'light']];
        yield 'blank revision' => [['default', '', ['light'], 'light']];
        yield 'no modes' => [['default', '1', [], 'light']];
        yield 'modes are a list' => [['default', '1', ['named' => 'light'], 'light']];
        yield 'mode is a string' => [['default', '1', [true], 'light']];
        yield 'blank mode' => [['default', '1', ['light', ' '], 'light']];
        yield 'duplicate mode' => [['default', '1', ['light', 'light'], 'light']];
        yield 'undeclared default' => [['default', '1', ['light'], 'dark']];
        yield 'blank component' => [['default', '1', ['light'], 'light', ['' => 'button.twig']]];
        yield 'blank template' => [['default', '1', ['light'], 'light', ['Button' => ' ']]];
        yield 'non-string template' => [['default', '1', ['light'], 'light', ['Button' => false]]];
    }

    public function testAnInvalidOverrideCannotSilentlyRemoveADefault(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->resolver()->resolve(new ThemeContext(), ['Button' => '']);
    }

    public function testCallerOwnedReferencesCannotMutateValidatedDefinitions(): void
    {
        $mode = 'light';
        $template = 'default/button.html.twig';
        $definition = new ThemeDefinition('default', '1', [&$mode], 'light', ['Button' => &$template]);
        $resolver = new ThemeResolver(new InMemoryThemeCatalog([$definition]), 'default');
        $before = $resolver->resolve(new ThemeContext());

        $mode = false;
        $template = false;

        self::assertSame(['light'], $definition->modes);
        self::assertSame(['Button' => 'default/button.html.twig'], $definition->templates);
        self::assertEquals($before, $resolver->resolve(new ThemeContext()));
    }

    private function resolver(): ThemeResolver
    {
        return new ThemeResolver(new InMemoryThemeCatalog([
            new ThemeDefinition('default', '1', ['light', 'dark'], 'light', [
                'Button' => 'default/button.html.twig',
                'Card' => 'default/card.html.twig',
                'Input' => 'default/input.html.twig',
            ]),
            new ThemeDefinition('editorial', '2', ['light', 'dark'], 'dark', [
                'Button' => 'editorial/button.html.twig',
                'Card' => 'editorial/card.html.twig',
            ]),
        ]), 'default');
    }
}
