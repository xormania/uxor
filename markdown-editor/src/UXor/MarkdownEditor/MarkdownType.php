<?php

namespace App\UXor\MarkdownEditor;

use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\CallbackTransformer;
use Symfony\Component\Form\Exception\TransformationFailedException;
use Symfony\Component\Form\Extension\Core\Type\TextareaType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\Form\FormInterface;
use Symfony\Component\Form\FormView;
use Symfony\Component\OptionsResolver\OptionsResolver;

/**
 * A Markdown field: the `markdown-editor` recipe's `MarkdownEditor`, through the form theme. Its data is the Markdown
 * source with Windows line breaks made `\n`, or null when blank (so `NotBlank` works). Longer than `max_bytes` bytes or
 * `max_chars` characters, the field gets an error and keeps its data: nothing is cut. Print the stored Markdown with
 * the `flowbite_markdown_html` filter.
 *
 * @extends AbstractType<string|null>
 */
final class MarkdownType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder->addModelTransformer(new CallbackTransformer(
            static fn (?string $markdown): string => $markdown ?? '',
            static function (?string $markdown) use ($options): ?string {
                $markdown = str_replace("\r\n", "\n", $markdown ?? '');
                if ('' === trim($markdown)) {
                    return null;
                }
                if (\strlen($markdown) > $options['max_bytes']) {
                    throw new TransformationFailedException('Too many bytes of Markdown.', 0, null, $options['max_bytes_message'], ['{{ limit }}' => $options['max_bytes']]);
                }
                if (mb_strlen($markdown) > $options['max_chars']) {
                    throw new TransformationFailedException('Too many characters.', 0, null, $options['max_chars_message'], ['{{ limit }}' => $options['max_chars']]);
                }

                return $markdown;
            },
        ));
    }

    public function buildView(FormView $view, FormInterface $form, array $options): void
    {
        $view->vars['max_chars'] = $options['max_chars'];
        $view->vars['placeholder'] = $options['attr']['placeholder'] ?? null;
        $view->vars['rows'] = $options['attr']['rows'] ?? 8;
    }

    public function configureOptions(OptionsResolver $resolver): void
    {
        $resolver->setDefaults([
            'max_bytes' => MarkdownRenderer::MAX_BYTES,
            'max_chars' => MarkdownRenderer::MAX_CHARS,
            'max_bytes_message' => 'This text is too long: it holds more than {{ limit }} bytes.',
            'max_chars_message' => 'This text is too long: it holds more than {{ limit }} characters.',
        ]);
        $resolver->setAllowedTypes('max_bytes', 'int');
        // longer Markdown could not be rendered
        $resolver->setAllowedValues('max_bytes', static fn (int $bytes): bool => $bytes > 0 && $bytes <= MarkdownRenderer::MAX_INPUT_BYTES);
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
        return 'flowbite_markdown';
    }
}
