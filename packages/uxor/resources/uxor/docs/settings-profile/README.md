# Settings Profile

A profile settings card: avatar, name and a Symfony form rendered through the form theme.

```twig {"preview":true}
<div class="w-full max-w-xl">
    <twig:SettingsProfile :form="form" name="Bonnie Green" email="bonnie@example.com" />
</div>
```

## Installation

::: installation

## Usage

`SettingsProfile` applies the form theme (`form/flowbite_layout.html.twig`, from the `form-theme` recipe) to its own form, so you do not need a `twig.form_themes` setting. It renders every field of the form, so `ProfileType`, your own form type, decides the fields (for example `name` and `email`).

```php
// src/Controller/SettingsController.php
#[Route('/settings/profile', name: 'app_settings_profile')]
public function profile(Request $request): Response
{
    $user = $this->getUser();
    $form = $this->createForm(ProfileType::class, $user);
    $form->handleRequest($request);

    if ($form->isSubmitted() && $form->isValid()) {
        // ... flush
        $this->addFlash('success', 'Profile saved.');

        return $this->redirectToRoute('app_settings_profile', [], Response::HTTP_SEE_OTHER);
    }

    return $this->render('settings/profile.html.twig', ['form' => $form], new Response(null, $form->isSubmitted() ? 422 : 200));
}
```

The page below extends the `layouts` recipe's `settings.html.twig` (`ux:install layouts`); extend your own base template otherwise.

```twig
{# templates/settings/profile.html.twig #}
{% extends 'layouts/settings.html.twig' %}

{% block title %}Settings{% endblock %}
{% block page_title %}Settings{% endblock %}
{% block settings_content %}
    <twig:SettingsProfile :form="form" name="{{ app.user.name }}" email="{{ app.user.email }}" />
{% endblock %}
```

Without `avatarSrc`, the avatar shows the initials of `name`.
