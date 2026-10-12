<?php

namespace App\Twig\Lab;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\Form\Extension\Core\Type\ChoiceType;
use Symfony\Component\Form\FormInterface;
use Symfony\UX\LiveComponent\Attribute\AsLiveComponent;
use Symfony\UX\LiveComponent\Attribute\LiveAction;
use Symfony\UX\LiveComponent\Attribute\LiveProp;
use Symfony\UX\LiveComponent\ComponentWithFormTrait;
use Symfony\UX\LiveComponent\DefaultActionTrait;

/**
 * The value matrix's widgets bound to Live properties (tests/e2e/lab.value-matrix.spec.ts), rendered with the values
 * the matrix's pages render. `serverValues` sets every property to another value, as a save or another record would:
 * each widget must then show the server's value, not the one the user left. The autocomplete is a form field with
 * the `autocomplete` option (its README's way in a Live Component); the editor's content is replaced through its
 * `reset` prop.
 */
#[AsLiveComponent]
final class LiveValues extends AbstractController
{
    use ComponentWithFormTrait;
    use DefaultActionTrait;

    #[LiveProp(writable: true)]
    public string $name = 'Ada';

    #[LiveProp(writable: true)]
    public bool $agree = false;

    #[LiveProp(writable: true)]
    public bool $notify = false;

    #[LiveProp(writable: true)]
    public ?string $day = '2026-03-10';

    #[LiveProp(writable: true)]
    public ?string $due = '2026-03-10';

    #[LiveProp(writable: true)]
    public string $body = '<p>Draft.</p>';

    /** The autocomplete form's data. */
    #[LiveProp]
    public string $fruit = 'apple';

    #[LiveProp]
    public int $resets = 0;

    #[LiveProp]
    public int $renders = 0;

    protected function instantiateForm(): FormInterface
    {
        return $this->createFormBuilder(['fruit' => $this->fruit])
            ->add('fruit', ChoiceType::class, [
                'choices' => ['Apple' => 'apple', 'Banana' => 'banana', 'Cherry' => 'cherry'],
                'autocomplete' => true,
                'label' => 'Fruit',
            ])
            ->getForm();
    }

    #[LiveAction]
    public function serverValues(): void
    {
        ++$this->renders;
        $this->name = 'Server';
        $this->agree = false;
        $this->notify = false;
        $this->day = '2026-03-20';
        $this->due = '2026-03-20';
        $this->body = '<p>Set by the server.</p>';
        ++$this->resets;
        $this->fruit = 'cherry';
        $this->resetForm();
    }
}
