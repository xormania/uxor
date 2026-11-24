<?php

namespace App\Command;

use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Output\OutputInterface;
use UXor\Kit\KitReader;

/**
 * Lists every README example of the kit as JSON, for the Playwright screenshot suite.
 */
#[AsCommand('app:examples', description: 'Lists the README examples of the kit as JSON')]
final class ExamplesCommand
{
    public function __construct(
        private readonly KitReader $kit,
    ) {
    }

    public function __invoke(OutputInterface $output): int
    {
        $examples = [];
        foreach ($this->kit->getRecipes() as $recipe) {
            foreach ($this->kit->getExamples($recipe) as $example) {
                $examples[] = ['recipe' => $recipe->name, 'id' => $example['id']];
            }
        }

        $output->writeln(json_encode($examples, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES));

        return Command::SUCCESS;
    }
}
