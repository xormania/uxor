# OAuth

An opinionated OAuth2/OIDC sign-in journey using Symfony Security, with Google, Facebook and GitHub adapters, single-use attempts and explicit account connections.

```twig
<div class="w-full max-w-sm">
    <twig:SocialLogin :providers="[{provider: 'github', href: '#'}, {provider: 'google', href: '#'}, {provider: 'facebook', href: '#'}]" />
</div>
```

## Installation

::: installation

## Usage

The recipe copies PHP into `src/UXor/OAuth/`, an authentication layout into `templates/layouts/`, and
`config/uxor_oauth.example.yaml`. It chooses the browser journey and callback handling; your application supplies
provider credentials, its user provider and an `IdentityStoreInterface` implementation for its own persistence.
The classes that require configuration are excluded from automatic service discovery, so installing the recipe
before configuring a provider does not break your application's container.

Start with GitHub:

1. Register a provider application and its exact callback URL, `https://your-app.example/oauth/github/check`.
2. Set `OAUTH_GITHUB_ID` and `OAUTH_GITHUB_SECRET` through your deployment's secret configuration.
3. Copy `config/uxor_oauth.example.yaml` to `config/uxor_oauth.yaml` and import it from `config/services.yaml`.
4. Bind the identity store interface and activate the authenticator on the firewall that covers both login and callbacks.
5. Render your login page with `layouts/oauth-auth.html.twig` and the `SocialLogin` block.

```yaml
# config/services.yaml (add to your existing imports and services)
imports:
    - { resource: uxor_oauth.yaml }
services:
    App\UXor\OAuth\IdentityStoreInterface: '@App\Security\AccountIdentityStore'
```

`AccountIdentityStore` is your application's implementation of the interface below. Keep your existing user provider,
firewall, password authentication and access rules. The example's `app_login` and `app_home` are configurable route
names; use your application's login and default destination routes in `uxor_oauth.yaml`.

```yaml
# config/packages/security.yaml (add inside your existing firewall)
security:
    firewalls:
        main:
            custom_authenticators:
                - App\UXor\OAuth\OAuthAuthenticator
            entry_point: App\UXor\OAuth\OAuthAuthenticator
```

If this firewall already has an entry point, choose the one that displays your combined login page. Symfony's
configured user provider must reload the users returned by your identity store on subsequent requests. The default
attribute-controller route loader discovers `OAuthController`; an application with custom route loading imports
`src/UXor/OAuth/OAuthController.php` as attribute routes.

```twig
{# templates/security/login.html.twig #}
{% extends 'layouts/oauth-auth.html.twig' %}
{% block title %}Sign in{% endblock %}
{% block content %}
    <twig:SocialLogin
        :providers="providers"
        :feedback="error ? error.messageKey|trans(error.messageData, 'security') : null"
    />
{% endblock %}
```

The application's login controller gets `providers` from `OAuthClient::loginLinks()` and `error` from Symfony's
`AuthenticationUtils`. Only configured providers are offered; optionally pass an app-local return path to
`loginLinks($returnTo)`. For a password-plus-provider
page, put your existing Symfony login form in `SocialLogin`'s `content` block, as its README demonstrates.

## User and account contract

`RemoteIdentity` carries `provider`, stable `subject`, nullable `email`, `emailVerified`, `displayName` and a nullable
HTTPS `avatarUrl`. Tokens are exchanged and used server-side; they are never handed to Twig or stored as user identity.
The default integration does not retain access or refresh tokens after authentication.

Your `IdentityStoreInterface` implementation provides these methods:

| Method | Required behavior |
|---|---|
| `resolve(RemoteIdentity): UserInterface` | Find the unique provider-and-subject association, or perform the application's first-use registration policy. Return the local user whose identifier the configured Symfony user provider can reload. |
| `link(UserInterface, RemoteIdentity): void` | Associate the identity with this user. Reject an identity already owned by another local user. Enforce this with a unique database constraint on provider and subject. |
| `unlink(UserInterface, string provider, string subject): void` | Verify that the association belongs to this user and that removing it leaves another usable sign-in method. Perform the check and deletion atomically. |

A matching email never proves ownership of an existing account. To connect to that account, sign in to it first and
use the explicit connection flow. GitHub exposes a verified primary email when available; Facebook's email is treated
as unverified. Email can be absent. If the application requires an email or an invitation before registration,
`resolve()` applies that rule and returns a safe `CustomUserMessageAuthenticationException` for the login block.
Applications can instead allow registration without an email, then collect and verify it in their own profile flow.

The demo's `DemoIdentityStore` is a complete session-backed example of this contract, for local demonstrations and
tests. Production applications implement their own durable account store and transaction boundaries.

## Providers

Use a `LeagueProvider` per configured provider. Google and GitHub use S256 PKCE. Google also validates the ID-token
signature against its pinned signing-key endpoint and checks issuer, client audience, presenter, expiry, issued-at,
nonce and subject. The signing-key cache refreshes on key rotation. Facebook uses the confidential authorization-code
flow and League's app-secret proof; this recipe does not claim Facebook PKCE support.

The provider registry accepts `ProviderInterface` implementations for additional providers. They share the same
callback, attempts and blocks; application-specific identity rules remain in the store.

For Google, add these services and add `@uxor.oauth.google` to the registry's `$providers` array:

```yaml
services:
    uxor.oauth.http:
        class: GuzzleHttp\Client
        arguments: [{timeout: 10, connect_timeout: 5}]
    uxor.oauth.requests:
        class: GuzzleHttp\Psr7\HttpFactory
    uxor.oauth.google.client:
        class: League\OAuth2\Client\Provider\Google
        arguments:
            $options:
                clientId: '%env(OAUTH_GOOGLE_ID)%'
                clientSecret: '%env(OAUTH_GOOGLE_SECRET)%'
            $collaborators: {httpClient: '@uxor.oauth.http'}
    uxor.oauth.google.verifier:
        class: App\UXor\OAuth\GoogleIdTokenVerifier
        arguments:
            $clientId: '%env(OAUTH_GOOGLE_ID)%'
            $httpClient: '@uxor.oauth.http'
            $requestFactory: '@uxor.oauth.requests'
            $cache: '@cache.app'
    uxor.oauth.google:
        class: App\UXor\OAuth\LeagueProvider
        arguments:
            $providerKey: google
            $client: '@uxor.oauth.google.client'
            $googleVerifier: '@uxor.oauth.google.verifier'
```

Register `https://your-app.example/oauth/google/check` and configure both Google credential variables. The provider
button uses Google's unmodified official local artwork; its accessible name follows that artwork.

For Facebook, add the client and adapter and include it in the registry:

```yaml
services:
    uxor.oauth.facebook.client:
        class: League\OAuth2\Client\Provider\Facebook
        arguments:
            $collaborators: {httpClient: '@uxor.oauth.http'}
            $options:
                clientId: '%env(OAUTH_FACEBOOK_ID)%'
                clientSecret: '%env(OAUTH_FACEBOOK_SECRET)%'
                graphApiVersion: '%env(OAUTH_FACEBOOK_GRAPH_VERSION)%'
                fields: [id, name, email, picture]
    uxor.oauth.facebook:
        class: App\UXor\OAuth\LeagueProvider
        arguments: { $providerKey: facebook, $client: '@uxor.oauth.facebook.client' }
```

Configure an explicitly supported Graph API version (`OAUTH_FACEBOOK_GRAPH_VERSION=v26.0` is the example verified
against Meta's SDK), credentials and `https://your-app.example/oauth/facebook/check`. Keep that version current with
Meta's supported versions. This configured fields list avoids deprecated profile fields.

## Browser and account journey

| Route | Behavior |
|---|---|
| GET `uxor_oauth_start` | Start a sign-in attempt for `provider`; optional `returnTo` must be an app-local absolute path. Without it, preserve Symfony's same-origin protected-page destination or use the default route. |
| GET `uxor_oauth_check` | Consume and validate the attempt, exchange the authorization code, resolve or explicitly link the user, establish the Symfony session and redirect to the saved destination. |
| POST `uxor_oauth_link` | Require full authentication and `_csrf_token` for `uxor_oauth_link`. Bind the attempt to this user's identifier and check it again on callback. |
| POST `uxor_oauth_unlink` | Require full authentication, `_csrf_token` for `uxor_oauth_unlink` and the association's `subject`. The identity store enforces ownership and a remaining sign-in method. |

Attempts are server-side, expire after ten minutes and are consumed before code exchange, including cancelled and
failed callbacks. Up to eight simultaneous attempts remain independent. An expired, reused or mismatched attempt
returns useful feedback to the login page. A cancelled or failed account connection returns feedback to the saved
settings destination when the same user remains fully authenticated. Unknown providers return an unavailable-provider message.

Provider links and connection forms use native full navigation. The OAuth authentication layout forces an expired
session's login response out of a Turbo Frame and prevents login-page snapshots. Successful callbacks load a fresh
application document, whose normal Turbo navigation works again. Use an ordinary application layout after sign-in;
apply appropriate cache controls to authenticated pages, and invalidate authenticated browser snapshots on logout.

The mock demo at `/oauth-demo/login` exercises the installed classes through a dedicated real Symfony firewall. Its
local consent page and one-use mock grants replace remote providers; they never accept an arbitrary callback user.
Provider adapter tests separately exercise real League exchanges through mocked HTTP and real signed Google tokens.

## References

- [League OAuth2 Client](https://oauth2-client.thephpleague.com/)
- [GitHub OAuth authorization and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google sign-in branding](https://developers.google.com/identity/branding-guidelines)
- [Turbo authentication-page recovery](https://turbo.hotwired.dev/handbook/frames#breaking-out-from-a-frame)
