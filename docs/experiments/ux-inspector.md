# UX Inspector on the dashboard

Can a contributor use the Inspector activity panel to distinguish a Turbo visit from a reload under the demo's Content Security Policy?

Inspector 3.7.0 injects a module script into the dashboard without the nonce required by UXor. Chromium reports an enforced `script-src-elem` violation and the panel never registers. The dashboard still navigates to Profile with Turbo. That link produced `turbo:visit`, `turbo:render` and `turbo:load` in the original document. Reloading Profile produced just `turbo:load` in a new document. An initial load event alone cannot tell the two apart. [Inspector documentation](https://symfony.com/bundles/ux-inspector/current/index.html)

## Repeat the comparison

Prepare the native demo and the repository's Playwright server as described in CONTRIBUTING.md. Run each command below in a separate terminal at the repository root. The trial uses an isolated debug environment so ordinary development, tests and static builds keep their existing behavior.

```sh
APP_ENV=inspector APP_DEBUG=1 APP_SECRET="$(openssl rand -hex 32)" php -d variables_order=EGPCS -S 127.0.0.1:8167 -t demo/public demo/public/index.php
```

```sh
APP_ENV=dev APP_DEBUG=1 php -d variables_order=EGPCS -S 127.0.0.1:8161 -t demo/public demo/public/index.php
```

```sh
node tools/experiments/inspect-turbo.mjs http://127.0.0.1:8167 http://127.0.0.1:8161
```

The probe checks the blocked module, the two navigation traces, omission from Turbo Frame responses, and absence of the script route in ordinary development. Defer adoption until the panel works with the application's per-response nonce and its docking styles also satisfy the enforced policy.
