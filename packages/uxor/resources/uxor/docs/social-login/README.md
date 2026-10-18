# Social login

A provider login or registration card with authentication feedback and optional password-form content.

```twig {"preview":true}
<div class="w-full max-w-sm">
    <twig:SocialLogin :providers="[
        {provider: 'google', href: '#'},
        {provider: 'facebook', href: '#'},
        {provider: 'github', href: '#'}
    ]" alternativeHref="#" />
</div>
```

## Installation

::: installation

## Usage

`SocialLogin` owns the authentication card: a page heading, provider choices, feedback, optional password form and a link to the other authentication mode. The `oauth-provider-button` recipe supplies every provider link's full browser navigation and prefetch policy.

The `providers` prop is a list of rows prepared by the application:

| Field | Required | Meaning |
|---|---|---|
| `provider` | yes | Configured provider key; Google, Facebook and GitHub have built-in display names. |
| `href` | yes | The same-origin server route that starts this provider's authentication flow. |
| `label` | no | Complete visible button label. |
| `providerLabel` | no | Display name for a provider without a built-in name. |

```twig
<twig:SocialLogin :providers="[
    {provider: 'google', href: path('uxor_oauth_start', {provider: 'google'})},
    {provider: 'github', href: path('uxor_oauth_start', {provider: 'github'})}
]" alternativeHref="{{ path('app_register') }}" />
```

Render the block in the application's authentication layout. The OAuth integration configures the clients, validates callbacks, resolves local users and creates the Symfony session. The block receives only presentation data. The static previews use placeholder links; the application's functional demo exercises the installed authentication integration with mock providers.

## Registration

`mode="signup"` changes the default heading, explanation, provider-list name and bottom link. It describes the journey; the application's registration policy still decides whether a new local account may be created. `title`, `description` and `alternativeLabel` can replace the defaults.

```twig {"preview":true}
<div class="w-full max-w-sm">
    <twig:SocialLogin mode="signup" :providers="[
        {provider: 'google', href: '#'},
        {provider: 'github', href: '#'}
    ]" alternativeHref="#" />
</div>
```

## Authentication feedback

The application translates cancellation, rejected callbacks and account conflicts into a useful message. Pass that message through `feedback`, with `feedbackVariant="danger"`, `"warning"` or `"success"`. Provider responses, exceptions, authorization codes and tokens must not be displayed. Feedback is escaped as text and announced through the existing Alert component.

```twig
<div class="w-full max-w-sm">
    <twig:SocialLogin :providers="[
        {provider: 'google', href: '#'},
        {provider: 'github', href: '#'}
    ]" feedback="Sign-in was cancelled. Choose a provider to try again." feedbackVariant="warning" />
</div>
```

## Password and provider sign-in

The content slot renders below the provider choices, after a separator. Give it the actual Symfony password form rather than nesting another authentication card. An empty provider list hides both the provider list and separator, so the same block can present password-only sign-in.

```twig
{% form_theme form 'form/flowbite_layout.html.twig' %}
<twig:SocialLogin :providers="providers">
    {{ form_start(form) }}
        {{ form_row(form._username) }}
        {{ form_row(form._password) }}
        <twig:Button type="submit" class="w-full">Sign in with email</twig:Button>
    {{ form_end(form) }}
</twig:SocialLogin>
```

Install `form-theme` and `button` when the slot uses them. The password form keeps Symfony's field names and CSRF configuration from the `login` recipe. `separatorLabel` replaces the default separator copy.

```twig {"preview":true}
<div class="w-full max-w-sm">
    <twig:SocialLogin :providers="[{provider: 'github', href: '#'}]" feedback="Sign-in was cancelled. Choose a provider to try again." feedbackVariant="warning">
        <p class="text-center text-sm text-body">Your application's email sign-in form appears here.</p>
    </twig:SocialLogin>
</div>
```
