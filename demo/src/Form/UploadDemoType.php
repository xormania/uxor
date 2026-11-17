<?php

namespace App\Form;

use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\Extension\Core\Type\SubmitType;
use Symfony\Component\Form\Extension\Core\Type\TextType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\UX\Dropzone\Form\DropzoneType;

/**
 * A photo, attachments and a required title, for the lab's Turbo upload form: an empty title sends back valid files.
 */
final class UploadDemoType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder
            ->add('title', TextType::class, [
                'constraints' => [new Assert\NotBlank()],
            ])
            ->add('photo', DropzoneType::class, [
                'required' => false,
                'help' => 'PNG or JPG, up to 1 MB.',
                'attr' => ['accept' => 'image/png,image/jpeg'],
                'constraints' => [new Assert\Image(maxSize: '1M', mimeTypes: ['image/png', 'image/jpeg'])],
            ])
            ->add('attachments', DropzoneType::class, [
                'required' => false,
                'multiple' => true,
                // UX Dropzone 3.7 adds Count(max: 3) for it, and the zone takes no more than 3 files in the browser
                'max_files' => 3,
                'help' => 'Up to 3 files: PDF, TXT or PNG, 1 MB each.',
                'constraints' => [
                    new Assert\All([new Assert\File(maxSize: '1M', extensions: ['pdf', 'txt', 'png'])]),
                ],
            ])
            ->add('upload', SubmitType::class);
    }
}
