# Signup

A registration card rendering a Symfony form through the form theme.

```twig {"preview":true}
<div class="w-full max-w-sm">
    <twig:SignupForm :form="form" loginHref="#" />
</div>
```

## Installation

::: installation

## Usage

`SignupForm` applies the form theme (`form/flowbite_layout.html.twig`, from the `form-theme` recipe) to its own form, so you do not need a `twig.form_themes` setting. It renders every field of the form, in order.

```php
// src/Form/RegistrationType.php
final class RegistrationType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder
            ->add('name', TextType::class, ['constraints' => [new NotBlank()]])
            ->add('email', EmailType::class, ['constraints' => [new NotBlank(), new Email()]])
            ->add('plainPassword', PasswordType::class, ['label' => 'Password', 'help' => 'At least 12 characters.', 'constraints' => [new NotBlank(), new Length(min: 12)]])
            ->add('terms', CheckboxType::class, ['label' => 'I accept the terms', 'mapped' => false, 'constraints' => [new IsTrue()]]);
    }
}
```

```php
// src/Controller/RegistrationController.php
#[Route('/register', name: 'app_register')]
public function register(Request $request): Response
{
    $form = $this->createForm(RegistrationType::class);
    $form->handleRequest($request);

    if ($form->isSubmitted() && $form->isValid()) {
        // ... hash the password, persist the user, log them in
        return $this->redirectToRoute('app_home', [], Response::HTTP_SEE_OTHER);
    }

    // 422 lets Turbo render the errors
    return $this->render('registration/register.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
}
```

The page below extends the `layouts` recipe's `auth.html.twig` (`ux:install layouts`); extend your own base template otherwise.

```twig
{# templates/registration/register.html.twig #}
{% extends 'layouts/auth.html.twig' %}

{% block title %}Create an account{% endblock %}
{% block content %}
    <twig:SignupForm :form="form" loginHref="{{ path('app_login') }}" />
{% endblock %}
```
