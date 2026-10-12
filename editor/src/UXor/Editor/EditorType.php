<?php

namespace App\UXor\Editor;

use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\CallbackTransformer;
use Symfony\Component\Form\Exception\TransformationFailedException;
use Symfony\Component\Form\Extension\Core\Type\TextareaType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\Form\FormInterface;
use Symfony\Component\Form\FormView;
use Symfony\Component\OptionsResolver\OptionsResolver;

/**
 * A rich text field: the `editor` recipe's `Editor`, through the form theme. Its data is HTML sanitized with
 * {@see EditorHtmlPolicy} on every submit, or null when the text is empty (so `NotBlank` works). Longer than
 * `max_bytes` bytes of HTML or `max_chars` characters of text, the field gets an error and keeps its data: nothing is
 * cut.
 *
 * @extends AbstractType<string|null>
 */
final class EditorType extends AbstractType
{
    public function __construct(private readonly EditorHtmlPolicy $policy)
    {
    }

    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder->addModelTransformer(new CallbackTransformer(
            fn (?string $html): string => null === $html ? '' : $this->policy->sanitize($html),
            function (?string $html) use ($options): ?string {
                if (null === $html || '' === $html) {
                    return null;
                }
                if (\strlen($html) > $options['max_bytes']) {
                    throw new TransformationFailedException('Too many bytes of HTML.', 0, null, $options['max_bytes_message'], ['{{ limit }}' => $options['max_bytes']]);
                }
                $clean = $this->policy->sanitize($html);
                if (EditorHtmlPolicy::textLength($clean) > $options['max_chars']) {
                    throw new TransformationFailedException('Too many characters.', 0, null, $options['max_chars_message'], ['{{ limit }}' => $options['max_chars']]);
                }

                return '' === $clean ? null : $clean;
            },
        ));
    }

    public function buildView(FormView $view, FormInterface $form, array $options): void
    {
        $view->vars['max_chars'] = $options['max_chars'];
        $view->vars['placeholder'] = $options['attr']['placeholder'] ?? null;
    }

    public function finishView(FormView $view, FormInterface $form, array $options): void
    {
        // the editable element is not a form control: the label names it through its id
        $view->vars['label_attr']['id'] ??= $view->vars['id'].'_label';
    }

    public function configureOptions(OptionsResolver $resolver): void
    {
        $resolver->setDefaults([
            'max_bytes' => EditorHtmlPolicy::MAX_BYTES,
            'max_chars' => EditorHtmlPolicy::MAX_CHARS,
            'max_bytes_message' => 'This text is too long: it holds more than {{ limit }} bytes of formatting and text.',
            'max_chars_message' => 'This text is too long: it holds more than {{ limit }} characters.',
        ]);
        $resolver->setAllowedTypes('max_bytes', 'int');
        // longer input could not be sanitized whole
        $resolver->setAllowedValues('max_bytes', static fn (int $bytes): bool => $bytes > 0 && $bytes <= EditorHtmlPolicy::MAX_INPUT_BYTES);
        $resolver->setAllowedTypes('max_chars', 'int');
        $resolver->setAllowedTypes('max_bytes_message', 'string');
        $resolver->setAllowedTypes('max_chars_message', 'string');
    }

    public function getParent(): string
    {
        return TextareaType::class;
    }

    public function getBlockPrefix(): string
    {
        return 'flowbite_editor';
    }
}
