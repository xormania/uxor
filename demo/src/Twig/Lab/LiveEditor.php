<?php

namespace App\Twig\Lab;

use App\UXor\Editor\EditorHtmlPolicy;
use Symfony\UX\LiveComponent\Attribute\AsLiveComponent;
use Symfony\UX\LiveComponent\Attribute\LiveAction;
use Symfony\UX\LiveComponent\Attribute\LiveProp;
use Symfony\UX\LiveComponent\DefaultActionTrait;

/**
 * An Editor bound to `body` (`data-model`): `note` re-renders the component for nothing, `save` stores the sanitized
 * body, `reset` replaces it from the server and bumps `resets`, the Editor's `reset` prop.
 */
#[AsLiveComponent]
final class LiveEditor
{
    use DefaultActionTrait;

    #[LiveProp(writable: true)]
    public string $body = '<p>Draft from the server.</p>';

    #[LiveProp(writable: true)]
    public string $note = '';

    #[LiveProp]
    public string $saved = '';

    #[LiveProp]
    public int $resets = 0;

    public function __construct(private readonly EditorHtmlPolicy $policy)
    {
    }

    #[LiveAction]
    public function save(): void
    {
        $this->saved = $this->policy->sanitize($this->body);
    }

    #[LiveAction]
    public function reset(): void
    {
        $this->body = '<p>Reset by the server.</p>';
        ++$this->resets;
    }
}
