<?php

namespace App\Kit;

use League\CommonMark\Node\Node;
use League\CommonMark\Renderer\ChildNodeRendererInterface;
use League\CommonMark\Renderer\NodeRendererInterface;
use Symfony\Component\String\Slugger\AsciiSlugger;
use Symfony\UX\Toolkit\Markdown\Extension\Tabs\Node\Tab;
use Symfony\UX\Toolkit\Markdown\Extension\Tabs\Node\Tabs;
use Twig\Environment;

/**
 * A `::: tabs` block of a recipe's documentation (the install steps, an example's Preview and Code) through
 * Toolkit's own template, with an id prefix of its own: the kit's Tabs ids are `<idPrefix>-<value>`, and every
 * example's tabs have the same titles. One instance renders one document, numbering its tabs in order.
 */
final class DocTabsRenderer implements NodeRendererInterface
{
    private int $count = 0;

    public function __construct(
        private readonly Environment $twig,
    ) {
    }

    public function render(Node $node, ChildNodeRendererInterface $childRenderer): string
    {
        if (!$node instanceof Tabs) {
            throw new \InvalidArgumentException(\sprintf('Expected instance of "%s", got "%s"', Tabs::class, $node::class));
        }

        $slugger = new AsciiSlugger();
        $tabs = [];
        foreach ($node->children() as $child) {
            if ($child instanceof Tab) {
                $tabs[] = [
                    'id' => $slugger->slug($child->getTitle())->lower()->toString(),
                    'title' => $child->getTitle(),
                    'content' => $childRenderer->renderNodes($child->children()),
                ];
            }
        }

        if ([] === $tabs) {
            throw new \RuntimeException(\sprintf('The "%s" block must contain at least one "%s" block.', Tabs::class, Tab::class));
        }

        return $this->twig->render('@UXToolkit/markdown/tabs.html.twig', [
            'tabs' => $tabs,
            'active_tab_id' => $tabs[0]['id'],
            'id_prefix' => 'doc-tabs-'.(++$this->count),
        ]);
    }
}
