<?php

namespace App\Form;

use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\Extension\Core\Type\CheckboxType;
use Symfony\Component\Form\FormBuilderInterface;

/**
 * The notification preferences of the demo's settings (/demo/settings/notifications).
 */
final class NotificationsType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder
            ->add('orders', CheckboxType::class, ['required' => false, 'label' => 'New orders', 'help' => 'An email for every order placed.'])
            ->add('mentions', CheckboxType::class, ['required' => false, 'label' => 'Mentions', 'help' => 'An email when someone mentions you in a comment.'])
            ->add('newsletter', CheckboxType::class, ['required' => false, 'label' => 'Product news', 'help' => 'At most one email a month.']);
    }
}
