# UX Inspector on the dashboard

Can a contributor use the Inspector activity panel to distinguish a Turbo visit from a reload under the demo's
Content Security Policy? Not yet: defer adoption.

## Finding

On November 18, 2026, with Symfony 8.1 and `symfony/ux-inspector` 3.7.0, Inspector injected a module script into the
dashboard without the nonce required by UXor. Chromium reported an enforced `script-src-elem` violation and the panel
never registered. The dashboard still navigated to Profile with Turbo. That link produced `turbo:visit`,
`turbo:render` and `turbo:load` in the original document. Reloading Profile produced just `turbo:load` in a new
document. An initial load event alone cannot tell the two apart.
[Inspector documentation](https://symfony.com/bundles/ux-inspector/current/index.html)

The probe also checked that the Inspector script was left out of Turbo Frame responses, and that its script route was
absent in ordinary development.

Defer adoption until the panel works with the application's per-response nonce and its docking styles also satisfy
the enforced policy.

## Repeat the trial

The trial code is not on `dev`. It is on the branch `claude/wo-symfony-trials--inspector` at commit
[`62e465d`](https://github.com/xormania/uxor/tree/62e465d37fb1bf3e560cb391c3a6fd9729e0f910), from
[pull request 246](https://github.com/xormania/uxor/pull/246). That commit holds:

- the demo's Composer files requiring `symfony/ux-inspector` 3.7.0;
- the bundle enabled only in an isolated `inspector` environment, with its routes loaded under `when@inspector`, so
  ordinary development, tests and static builds keep their behavior;
- `tools/experiments/inspect-turbo.mjs`, a Playwright probe that takes the Inspector server's URL and an ordinary
  development server's URL.

From a checkout of that commit, prepare the native demo and the repository's Playwright server as `CONTRIBUTING.md`
describes there. Serve the demo twice: once with `APP_ENV=inspector APP_DEBUG=1` and a throwaway `APP_SECRET`, once
with `APP_ENV=dev APP_DEBUG=1`, each with `php -d variables_order=EGPCS -S` on its own loopback port and the front
controller `demo/public/index.php`. Then run the probe with the two URLs. The probe checks the blocked module, the two
navigation traces, omission from Turbo Frame responses and absence of the script route in ordinary development.

To test a newer Inspector release, change its version in the trial's Composer files first.
