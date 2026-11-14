<?php

namespace App\UXor\Dropzone;

use Symfony\Component\Form\AbstractTypeExtension;
use Symfony\Component\Form\FormInterface;
use Symfony\Component\Form\FormView;
use Symfony\Component\OptionsResolver\Options;
use Symfony\Component\OptionsResolver\OptionsResolver;
use Symfony\UX\Dropzone\Form\DropzoneType;

/**
 * Tells the dropzone recipe's form widget when a `DropzoneType` was given `placeholder: false`, as the view variable
 * `placeholder_disabled`, so its box shows no main line; a field that sets no placeholder keeps the kit's default
 * phrase, custom `attr` or not.
 *
 * UX Dropzone resolves a field with custom `attr` and no placeholder to `false` as well, so the resolved value cannot
 * tell the two apart. This extension does not change it: it wraps the option's default, which the resolver calls only
 * when the field sets no placeholder, notes that it ran for this resolution, and returns UX Dropzone's value as it was.
 * Every option resolves, and every other extension sees it, as without this extension. Its own option,
 * `uxor_placeholder_defaulted`, is that note for buildView, not a setting: a value a field gives it is replaced.
 */
final class DropzonePlaceholderExtension extends AbstractTypeExtension
{
    /**
     * The resolutions whose placeholder came from its default, not from the field: keyed by the resolver resolving it.
     *
     * @var \WeakMap<object, true>|null
     */
    private static ?\WeakMap $defaulted = null;

    public static function getExtendedTypes(): iterable
    {
        return [DropzoneType::class];
    }

    public function configureOptions(OptionsResolver $resolver): void
    {
        $resolver->setDefault('placeholder', static function (Options $options, mixed $previousValue): mixed {
            self::$defaulted ??= new \WeakMap();
            self::$defaulted[$options] = true;

            return $previousValue;
        });
        // the kit's own bookkeeping, read by buildView only: a normalizer, so a value a field sets by hand is replaced; it
        // resolves the placeholder first, so its default has run when the field set none
        $resolver->setDefault('uxor_placeholder_defaulted', false);
        $resolver->setAllowedTypes('uxor_placeholder_defaulted', 'bool');
        $resolver->setInfo('uxor_placeholder_defaulted', 'Internal to the dropzone recipe (DropzonePlaceholderExtension): whether the placeholder came from its default. Do not set it; any value is replaced.');
        $resolver->setNormalizer('uxor_placeholder_defaulted', static function (Options $options): bool {
            $options->offsetGet('placeholder');

            return isset(self::$defaulted[$options]);
        });
    }

    /** @param array<string, mixed> $options */
    public function buildView(FormView $view, FormInterface $form, array $options): void
    {
        $view->vars['placeholder_disabled'] = false === $options['placeholder'] && !$options['uxor_placeholder_defaulted'];
    }
}
