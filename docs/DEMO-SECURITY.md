# Demo security contract

The public gallery is the output of `app:export-static`, not the dynamic Symfony application. The dynamic demo is a
development and test fixture: it compiles the repository's preview-enabled README examples as Twig, exposes routes
that exercise Live Components and uploads, and uses a known demonstration login. Run it only from a trusted checkout
and keep its Compose ports on loopback.

Production mode therefore fails closed. `App\Kernel` refuses to boot in `prod` unless both conditions hold:

- `UXOR_DEMO_ALLOW_PRODUCTION=1` explicitly acknowledges that the dynamic fixture is being deployed;
- `APP_SECRET` is an uncommitted, unique value of at least 32 characters. The committed development and test values
  are refused.

This guard prevents an accidental `APP_ENV=prod` deployment; it is not a production-hardening switch. A deliberate
dynamic deployment must also remove or authenticate the lab and preview routes, replace the demonstration user,
review uploads and Live actions for its own authorization rules, restrict outbound traffic, and put the app behind a
maintained TLS reverse proxy. Prefer the static export whenever interaction with a Symfony server is unnecessary.

## Route inventory

Every route whose controller belongs to the demo declares an `uxor_security` option. `RouteSecurityTest` fails when
a new route has no category, when a non-lab route accepts every HTTP method, when a read-only route accepts anything
other than GET, or when a public reference route accepts POST without a named CSRF mechanism.

| Category | Paths | Contract |
|---|---|---|
| `public-read` | `/`, `/r/{recipe}` | Reads kit metadata and README examples; GET only. |
| `public-reference` | `/demo/*`, `/forms*`, `/oauth-demo/*` | Reference forms and layouts. POST is handled by a Symfony form or by the firewall, with CSRF enabled; effects stay in the demo session. |
| `trusted-code-preview` | `/preview/{recipe}/{example}` | GET only. Compiles Twig from the checked-out repository; the repository is trusted code, not user content. |
| `development-only` | `/lab/*` | Test scenarios, including uploads, Live actions and Turbo Stream endpoints. Never a public application surface. |

Framework routes such as `/_components` and `/autocomplete` are owned by their Symfony UX packages. Their access and
authorization follow the application route that renders the component; an application using UXor must enforce its
own object-level authorization in every Live action and autocomplete endpoint.

## Executable evidence

- `ProductionConfigurationTest` tries the missing opt-in, missing/short/committed secrets, then boots a valid
  production kernel and proves debug, the UX Toolkit bundle and the profiler are off.
- `RouteSecurityTest` reads Symfony's compiled route collection, so inherited route options and actual HTTP methods
  are checked as the router sees them.
- `tests/e2e/csp.spec.ts` requests the running application and checks its production-style browser headers and nonce
  policy.
- `tools/build-static.sh` exports the public copy and checks every saved page, link and form.

## OAuth reference fixture

The `/oauth-demo` consent pages replace remote providers with session-bound, expiring, one-use grants. A dedicated
`oauth_demo` firewall covers `/oauth` and `/oauth-demo`; its callback uses the installed kit authenticator. The account
and private-content routes require ROLE_USER, and later requests reload the local fixture user through the user
provider. These protected routes prove authentication rather than relying on the existing public dashboard.

Consent POSTs use Symfony forms. Core connection and disconnection POSTs require full authentication and their named
CSRF tokens; identity ownership and remaining-sign-in rules are enforced by the example store. The fixture's records
live in the demo session and are not a durable production account store. The public static export includes recipe
presentation examples and explanations, never the protected demonstration routes or executable mock callbacks.
