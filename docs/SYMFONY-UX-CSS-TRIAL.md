# Symfony UX CSS motion trial

Keep the kit's current motion CSS and its public custom properties. The direct custom-property form of experimental
UX CSS matches this panel's motion and override behavior. The named-token form misses subtree overrides, and the
direct form adds a Twig build dependency and generated atomic classes to express the same declarations. Keep the
bundle in the demo's opt-in `motion` environment for this probe.

## Reproduce

The trial uses Symfony 8.1.11 and `symfony/ux-css` 3.7.0, source
`9e719a197fff4ae9d4ed4b1749ead5a26227dbd1`. From the repository root, with PHP 8.4 or later and Composer:

```bash
tools/sync-demo
composer --working-dir=demo install
npm ci
php demo/bin/console tailwind:build
APP_ENV=motion APP_DEBUG=0 php demo/bin/console cache:clear
```

Start a Playwright 1.58.2 server on port 3000 if one is unavailable. Use the project's pinned browser image or run
`npx playwright install chromium` and `npx playwright run-server --host 127.0.0.1 --port 3000` locally.

In one terminal, serve the motion environment:

```bash
APP_ENV=motion APP_DEBUG=0 php -d variables_order=EGPCS -S 127.0.0.1:8003 -t demo/public
```

In another terminal:

```bash
node tools/experiments/ux-css/probe.mjs
```

Set `DEMO_URL` or `PW_WS_ENDPOINT` if the corresponding server uses a different address. The probe uses the kit's
compiled demo stylesheet alongside the generated stylesheet. Clearing the motion cache after fixture changes
regenerates `demo/var/ux_css/styles.css`. The environment serves AssetMapper files at its own URL prefix,
including after a standard asset build. Debug is off, so the trial uses the strict cache warmer and skips
generating editor metadata in `demo/config/`.

## Generated and computed styles

On PHP 8.4.27 and Chromium 145.0.7632.6, AssetMapper served 1,342 bytes of generated UX CSS. The stylesheet
contains a base `transition-property: none` rule and a `prefers-reduced-motion: no-preference` block with
the opacity, duration and easing utilities. The strict 3.7.0 validator rejects bare `opacity` and `none` for
`transitionProperty`. The bracketed spellings generate those native values. The kit reference is the dashboard
entrance rule, which lists opacity and translate in normal motion. Both experimental panels list opacity.

| Scenario | Kit entrance | UX CSS named tokens | UX CSS direct custom properties |
|---|---|---|---|
| Default | 150 ms, ease-out | 150 ms, ease-out | 150 ms, ease-out |
| Token override on the panel ancestor | 410 ms, ease-in | 150 ms, ease-out | 410 ms, ease-in |
| Token override on the document root | 240 ms, linear | 240 ms, linear | 240 ms, linear |
| Root override plus unlayered duration declaration on the direct panel | 240 ms, linear | 240 ms, linear | 520 ms, linear |
| Reduced motion | `all`, 0 ms, ease | `none`, 0 ms, ease | `none`, 0 ms, ease |
| Reduced motion with root, subtree and direct duration overrides active | `all`, 0 ms, ease | `none`, 0 ms, ease | `none`, 520 ms, ease |

In the named form, `--durations-normal` and `--easings-out` reference the UXor variables where the aliases are
defined on the root. A scope nested beneath the root inherits the resolved aliases. Direct declarations resolve
the UXor variables on the element. The unlayered duration declaration wins over UX CSS's `utilities` layer
even though its stylesheet comes first. Changing opacity on the direct panel starts an actual 150 ms transition
in normal motion. With reduced motion and all overrides active, the browser starts zero transitions.

The full probe covers the two static panel variants in Chromium. Spot checks in Firefox 146.0.1 and
WebKit 26.0 reproduced the defaults, the ancestor override results and reduced-motion styles. The existing
motion suite covers shipped recipes and their controllers. This trial leaves variant-class merging and broad
recipe migration for a future evaluation.

## DesignTokens readiness

The installed release reads `ux_css.tokens` and the two marked-up panel examples use its `css()` function. The 3.8
development changelog lists `cva()` and changes to `css()` and same-property overrides. The panel findings apply to
the locked release. [UX CSS 3.7.0 release](https://github.com/symfony/ux-css/releases/tag/v3.7.0) ·
[UX CSS development changelog](https://github.com/symfony/ux/blob/3.x/src/Css/CHANGELOG.md)

The open DesignTokens proposal covers DTCG tokens, typed values and CSS custom-property output. The proposed UX CSS
adapter closed without merging and depends on DesignTokens landing first. Revisit an adapter when a released pair
can preserve UXor's documented custom-property names, inherited subtree overrides and reduced-motion behavior. This
trial exercised the existing CSS variables and the bundle's own token configuration.
[DesignTokens proposal](https://github.com/symfony/ux/pull/3932) ·
[UX CSS adapter proposal](https://github.com/symfony/ux/pull/4181)

## Checks

The Chromium probe and all 36 tests in the Chromium motion suite passed. The demo's PHP suite passed all
446 tests. Composer validation, Twig and YAML lint, the route inventory and security policy passed. The probe
route was absent in the `dev` and `test` route collections. The standard static export built and checked 453 pages.
