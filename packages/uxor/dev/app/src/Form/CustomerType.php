<?php

namespace App\Form;

use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\Extension\Core\Type\EmailType;
use Symfony\Component\Form\Extension\Core\Type\TextType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\Validator\Constraints as Assert;

final class CustomerType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder
            ->add('name', TextType::class, ['constraints' => [new Assert\NotBlank(), new Assert\Length(max: 100)]])
            ->add('email', EmailType::class, ['constraints' => [new Assert\NotBlank(), new Assert\Email(), new Assert\Length(max: 180)]]);
    }
}
