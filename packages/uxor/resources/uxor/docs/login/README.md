# Login

A sign-in card rendering a Symfony login form through the form theme, with the last authentication error.

```twig {"preview":true}
<div class="w-full max-w-sm">
    <twig:LoginForm :form="form" forgotPasswordHref="#" signupHref="#" />
</div>
```

## Installation

::: installation

## Usage

`LoginForm` applies the form theme (`form/flowbite_layout.html.twig`, from the `form-theme` recipe) to its own form, so you do not need a `twig.form_themes` setting.

The form posts back to the login page, which the `security.yaml` below sets as the firewall's `check_path`: Symfony's `form_login` authenticator reads it there. So the fields keep the names `form_login` expects: `_username`, `_password`, `_remember_me`, and a `_csrf_token` checked against the `authenticate` token id.

```php
// src/Form/LoginType.php
final class LoginType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder
            ->add('_username', EmailType::class, ['label' => 'Email', 'attr' => ['autocomplete' => 'email']])
            ->add('_password', PasswordType::class, ['label' => 'Password', 'attr' => ['autocomplete' => 'current-password']])
            ->add('_remember_me', CheckboxType::class, ['label' => 'Remember me', 'required' => false]);
    }

    public function configureOptions(OptionsResolver $resolver): void
    {
        $resolver->setDefaults(['csrf_field_name' => '_csrf_token', 'csrf_token_id' => 'authenticate']);
    }

    public function getBlockPrefix(): string
    {
        return ''; // _username, not login[_username]
    }
}
```

`_remember_me` only works when the firewall has a `remember_me` section, and the `security.yaml` below has none: add one, or drop the field. `LoginForm` shows the checkbox only when the form has it.

```php
// src/Controller/SecurityController.php
#[Route('/login', name: 'app_login')]
public function login(AuthenticationUtils $authenticationUtils): Response
{
    $form = $this->createForm(LoginType::class, ['_username' => $authenticationUtils->getLastUsername()]);

    return $this->render('security/login.html.twig', [
        'form' => $form,
        'error' => $authenticationUtils->getLastAuthenticationError(),
    ]);
}
```

```yaml
# config/packages/security.yaml
security:
    firewalls:
        main:
            form_login:
                login_path: app_login
                check_path: app_login
                enable_csrf: true
```

The page below extends the `layouts` recipe's `auth.html.twig` (`ux:install layouts`); extend your own base template otherwise.

```twig
{# templates/security/login.html.twig #}
{% extends 'layouts/auth.html.twig' %}

{% block title %}Sign in{% endblock %}
{% block content %}
    <twig:LoginForm :form="form" :error="error" forgotPasswordHref="{{ path('app_forgot_password') }}" signupHref="{{ path('app_register') }}" />
{% endblock %}
```

`forgotPasswordHref` and `signupHref` are optional: without one, its link is left out. The routes above are those of the `forgot-password` and `signup` READMEs.
