<?php

namespace App\Tests\Kit;

use App\Kit\KitReader;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\UX\Toolkit\Recipe\Recipe;

/**
 * Reading a recipe's README examples (KitReader::getExamples()): a PCRE error, such as its backtrack limit on a long
 * README, fails naming the step, where it read as "no examples" or gave the example the id "default".
 */
final class KitReaderPcreTest extends KernelTestCase
{
    private const LIMIT = '5000';

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function failingSteps(): iterable
    {
        // an info string's JSON object never closed: the examples' pattern scans on for its closing brace
        yield 'the examples' => ["# Button\n\n```twig {".str_repeat('a', 20000)."\n", 'find the README examples'];
        // a fence never closed above a valid example: only the id's pattern, which drops the fenced blocks before the
        // example, scans it (the examples' pattern stops at its info string, which carries no JSON object)
        yield 'the example id' => ["# Button\n\n## Sizes\n\n```x\n".str_repeat(str_repeat('a', 200)."\n", 100)."\n```twig {\"preview\": true}\n<twig:Button/>\n```\n", 'name the README example'];
    }

    #[DataProvider('failingSteps')]
    public function testAPcreErrorFailsNamingTheStep(string $doc, string $step): void
    {
        $reader = self::getContainer()->get(KitReader::class);
        $button = $reader->getRecipe('button');
        self::assertNotNull($button);
        $recipe = new Recipe($button->name, $button->absolutePath, $button->manifest, $doc);

        $limit = ini_get('pcre.backtrack_limit');
        ini_set('pcre.backtrack_limit', self::LIMIT);
        try {
            $reader->getExamples($recipe);
            self::fail(\sprintf('no exception: the step "%s" passed a PCRE error on', $step));
        } catch (\RuntimeException $exception) {
            self::assertStringContainsString($step, $exception->getMessage());
            self::assertStringContainsString('button', $exception->getMessage());
            self::assertStringContainsString('Backtrack limit exhausted', $exception->getMessage());
        } finally {
            ini_set('pcre.backtrack_limit', (string) $limit);
        }
    }

    public function testTheSameReadmeGivesItsExamplesWithinTheLimit(): void
    {
        $reader = self::getContainer()->get(KitReader::class);
        $button = $reader->getRecipe('button');
        self::assertNotNull($button);
        $doc = "# Button\n\n## Sizes\n\n```x\n".str_repeat(str_repeat('a', 200)."\n", 100)."```\n\n```twig {\"preview\": true}\n<twig:Button/>\n```\n";

        $examples = $reader->getExamples(new Recipe($button->name, $button->absolutePath, $button->manifest, $doc));

        self::assertSame([['id' => 'sizes', 'language' => 'twig', 'code' => '<twig:Button/>', 'options' => ['preview' => true]]], $examples);
    }
}
