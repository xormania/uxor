# Forgot Password

A card asking for an email address to send a password reset link, then confirming it was sent.

```twig {"preview":true}
<div class="w-full max-w-sm">
    <twig:ForgotPasswordForm :form="form" loginHref="#" />
</div>
```

## Installation

::: installation

## Usage

`ForgotPasswordForm` applies the form theme (`form/flowbite_layout.html.twig`, from the `form-theme` recipe) to its own form, so you do not need a `twig.form_themes` setting.

```php
// src/Controller/ResetPasswordController.php
#[Route('/forgot-password', name: 'app_forgot_password')]
public function request(Request $request): Response
{
    $form = $this->createFormBuilder()
        ->add('email', EmailType::class, ['constraints' => [new NotBlank(), new Email()]])
        ->getForm();
    $form->handleRequest($request);

    if ($form->isSubmitted() && $form->isValid()) {
        // ... send the link (symfonycasts/reset-password-bundle), whether or not the account exists
        return $this->redirectToRoute('app_forgot_password', ['sent' => 1], Response::HTTP_SEE_OTHER);
    }

    return $this->render('reset_password/request.html.twig', [
        'form' => $form,
        'sent' => $request->query->getBoolean('sent'),
    ], new Response(null, $form->isSubmitted() ? 422 : 200));
}
```

The page below extends the `layouts` recipe's `auth.html.twig` (`ux:install layouts`); extend your own base template otherwise.

```twig
{# templates/reset_password/request.html.twig #}
{% extends 'layouts/auth.html.twig' %}

{% block title %}Forgot your password?{% endblock %}
{% block content %}
    <twig:ForgotPasswordForm :form="form" :sent="sent" loginHref="{{ path('app_login') }}" />
{% endblock %}
```

The confirmation never says whether the account exists, so the form cannot be used to find out who has one. Turbo Drive needs the redirect after a successful submit (and a 422 to show errors).
