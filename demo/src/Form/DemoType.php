<?php

namespace App\Form;

use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\Extension\Core\Type\CheckboxType;
use Symfony\Component\Form\Extension\Core\Type\ChoiceType;
use Symfony\Component\Form\Extension\Core\Type\DateType;
use Symfony\Component\Form\Extension\Core\Type\EmailType;
use Symfony\Component\Form\Extension\Core\Type\IntegerType;
use Symfony\Component\Form\Extension\Core\Type\PasswordType;
use Symfony\Component\Form\Extension\Core\Type\SubmitType;
use Symfony\Component\Form\Extension\Core\Type\TextareaType;
use Symfony\Component\Form\Extension\Core\Type\TextType;
use Symfony\Component\Form\Extension\Core\Type\UrlType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\UX\Dropzone\Form\DropzoneType;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Every field type the form theme styles, with constraints so that an empty submit shows errors.
 */
final class DemoType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder
            ->add('name', TextType::class, [
                'help' => 'As it appears on your invoices.',
                'constraints' => [new Assert\NotBlank(), new Assert\Length(min: 2)],
            ])
            ->add('email', EmailType::class, [
                'attr' => ['placeholder' => 'name@example.com'],
                'constraints' => [new Assert\NotBlank(), new Assert\Email()],
            ])
            ->add('password', PasswordType::class, [
                'constraints' => [new Assert\NotBlank(), new Assert\Length(min: 8)],
            ])
            ->add('age', IntegerType::class, [
                'required' => false,
                'constraints' => [new Assert\Range(min: 18, max: 120)],
            ])
            ->add('website', UrlType::class, [
                'required' => false,
                'help' => 'Shown on your profile.',
                'label_attr' => ['title' => 'Your public site'],
                'help_attr' => ['data-testid' => 'website-help'],
                'default_protocol' => null,
                'attr' => ['placeholder' => 'https://example.com'],
                'constraints' => [new Assert\Url(requireTld: true)],
            ])
            ->add('birthday', DateType::class, [
                'required' => false,
                'widget' => 'single_text',
            ])
            // the date-picker recipe's widget, opted in per field; the bounds guide the calendar, the constraint decides
            ->add('startsOn', DateType::class, [
                'required' => false,
                'widget' => 'single_text',
                'block_prefix' => 'flowbite_date_picker',
                'help' => 'The first day of your subscription.',
                'attr' => ['min' => '2026-01-01'],
                'constraints' => [new Assert\GreaterThanOrEqual('2026-01-01')],
            ])
            ->add('bio', TextareaType::class, [
                'required' => false,
                'help' => 'At most 200 characters.',
                'attr' => ['rows' => 3],
                'constraints' => [new Assert\Length(max: 200)],
            ])
            // the dropzone recipe's widget, for every DropzoneType
            ->add('photo', DropzoneType::class, [
                'required' => false,
                'help' => 'PNG or JPG, up to 1 MB.',
                'placeholder' => 'Drop a photo or browse',
                'attr' => ['accept' => 'image/png,image/jpeg'],
                'constraints' => [new Assert\Image(maxSize: '1M', mimeTypes: ['image/png', 'image/jpeg'])],
            ])
            ->add('attachments', DropzoneType::class, [
                'required' => false,
                'multiple' => true,
                'help' => 'Up to 3 files: PDF, TXT or PNG, 1 MB each.',
                'constraints' => [
                    new Assert\Count(max: 3),
                    new Assert\All([new Assert\File(maxSize: '1M', extensions: ['pdf', 'txt', 'png'])]),
                ],
            ])
            ->add('country', ChoiceType::class, [
                'placeholder' => 'Choose a country',
                'choices' => ['France' => 'fr', 'Germany' => 'de', 'Japan' => 'jp', 'United States' => 'us'],
                'constraints' => [new Assert\NotBlank()],
            ])
            ->add('plan', ChoiceType::class, [
                'expanded' => true,
                'choices' => ['Free' => 'free', 'Pro' => 'pro', 'Team' => 'team'],
                'help' => 'You can change it later.',
                'constraints' => [new Assert\NotBlank()],
            ])
            ->add('interests', ChoiceType::class, [
                'expanded' => true,
                'multiple' => true,
                'required' => false,
                'choices' => ['Design' => 'design', 'Engineering' => 'engineering', 'Marketing' => 'marketing'],
                'constraints' => [new Assert\Count(min: 1, minMessage: 'Pick at least one interest.')],
            ])
            ->add('terms', CheckboxType::class, [
                'label' => 'I accept the terms',
                'label_attr' => ['data-testid' => 'terms-label'],
                'constraints' => [new Assert\IsTrue(message: 'You must accept the terms.')],
            ])
            ->add('save', SubmitType::class, ['label' => 'Create account']);
    }
}
