<?php

namespace App\Form;

use App\UXor\Editor\EditorType;
use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\Extension\Core\Type\SubmitType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * A rich text body for the lab: required, at most 200 characters, so an empty or long submit shows its error.
 */
final class EditorDemoType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder
            ->add('body', EditorType::class, [
                'help' => 'At most 200 characters.',
                'max_chars' => 200,
                'attr' => ['placeholder' => 'Write the announcement…'],
                'constraints' => [new Assert\NotBlank()],
            ])
            ->add('save', SubmitType::class, ['label' => 'Publish']);
    }
}
