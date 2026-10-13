# Connected accounts

An account settings card with connection forms, identity summaries and explicit unavailable-action feedback.

```twig {"preview":true}
<div class="w-full max-w-xl">
    <twig:ConnectedAccounts :accounts="[
        {
            provider: 'google', connected: true, identity: 'alex@example.com', subject: 'demo-google',
            disconnectAction: '#', disconnectToken: 'preview-only'
        },
        {provider: 'facebook', connected: false, connectAction: '#', connectToken: 'preview-only'},
        {provider: 'github', connected: true, identity: 'alex-code', cannotRemove: true}
    ]" />
</div>
```

## Installation

::: installation

## Usage

`ConnectedAccounts` presents the authenticated user's connections. Connecting and disconnecting use native POST forms with application-supplied actions and CSRF tokens. They use `data-turbo="false"` and `data-turbo-prefetch="false"`, so connecting can continue directly into the external provider flow and every action returns through a full browser navigation.

The application prepares one `accounts` row per available provider:

| Field | Required | Meaning |
|---|---|---|
| `provider` | yes | Configured provider key; Google, Facebook and GitHub have built-in display names. |
| `label` | no | Display name replacing the provider's built-in name. |
| `connected` | yes | Whether this provider identity is linked to the current user. |
| `identity` | no | Human-readable name or email for a connected identity; escaped as text. |
| `connectAction` | for an enabled connection | Same-origin route handling authenticated connection requests. |
| `connectToken` | for an enabled connection | CSRF token generated for the connection action. |
| `disconnectAction` | for an enabled disconnection | Same-origin route handling authenticated disconnection requests. |
| `disconnectToken` | for an enabled disconnection | CSRF token generated for the disconnection action. |
| `subject` | for an enabled disconnection | The stored provider subject to disconnect, submitted as the hidden `subject` field. |
| `cannotRemove` | no | Disables disconnection when it would remove the last usable sign-in method. |
| `cannotRemoveReason` | no | Explanation for `cannotRemove`; defaults to keeping at least one sign-in method. |

```twig
<twig:ConnectedAccounts :accounts="[
    {
        provider: 'github', connected: false,
        connectAction: path('uxor_oauth_link', {provider: 'github'}),
        connectToken: csrf_token('uxor_oauth_link')
    },
    {
        provider: 'google', connected: true, identity: account.displayName,
        subject: account.subject,
        disconnectAction: path('uxor_oauth_unlink', {provider: 'google'}),
        disconnectToken: csrf_token('uxor_oauth_unlink'),
        cannotRemove: cannotRemoveGoogle
    }
]" />
```

Actions must come from trusted server route generation. A form action with a scheme other than relative or HTTP(S), a missing CSRF token, or a missing disconnection subject makes the button unavailable and omits the form. Supply `idPrefix` when a page has several instances so each explanation has a unique id. Disabled buttons reference their explanation with `aria-describedby`.

The component supplies the forms and feedback. The installed OAuth integration authenticates the user, checks the `_csrf_token`, binds the callback to that user and intended operation, and rechecks disconnection policy when a POST arrives. `cannotRemove` explains the current policy to the user; it never replaces server enforcement. Do not silently connect users by a matching email address.

## Keep a usable sign-in method

The row stays visible and explains why its action is unavailable. A disabled action renders no mutation form or token.

```twig {"preview":true}
<div class="w-full max-w-xl">
    <twig:ConnectedAccounts idPrefix="last-sign-in" :accounts="[
        {
            provider: 'github', connected: true, identity: 'alex-code',
            cannotRemove: true,
            cannotRemoveReason: 'Add another sign-in method before disconnecting GitHub.'
        }
    ]" />
</div>
```

## Feedback

Pass safe, human-readable text through `feedback`. `feedbackVariant` accepts `danger`, `warning` or `success`, and uses the existing Alert component. Never display provider exception messages or tokens.

```twig
<div class="w-full max-w-xl">
    <twig:ConnectedAccounts idPrefix="connection-feedback" :readOnly="true" feedback="GitHub was connected. You can now use it to sign in." feedbackVariant="success" :accounts="[
        {provider: 'github', connected: true, identity: 'alex-code'}
    ]" />
</div>
```

`readOnly="true"` disables all connection actions with `readOnlyReason`. The static previews have placeholder actions and tokens; they illustrate the forms and cannot change account data. The application's functional demo uses the installed integration and real POST routes with a mock external provider.
