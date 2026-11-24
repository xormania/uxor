# Symfony UX CSS for motion

Should the kit express its motion CSS with experimental Symfony UX CSS? Not now: keep the kit's current motion CSS
and its public custom properties.

## Finding

On November 18, 2026, with Symfony 8.1.11 and `symfony/ux-css` 3.7.0 (source
`9e719a197fff4ae9d4ed4b1749ead5a26227dbd1`), the direct custom-property form of UX CSS matched the kit's motion and
override behavior on a test panel. The named-token form missed subtree overrides. The direct form added a Twig build
dependency and generated atomic classes to express the same declarations.

## Generated and computed styles

On PHP 8.4.27 and Chromium 145.0.7632.6, AssetMapper served 1,342 bytes of generated UX CSS. The stylesheet contained a
base `transition-property: none` rule and a `prefers-reduced-motion: no-preference` block with the opacity, duration
and easing utilities. The strict 3.7.0 validator rejects bare `opacity` and `none` for `transitionProperty`. The
bracketed spellings generate those native values. The kit reference is the dashboard entrance rule, which lists
opacity and translate in normal motion. Both experimental panels list opacity.

| Scenario | Kit entrance | UX CSS named tokens | UX CSS direct custom properties |
|---|---|---|---|
| Default | 150 ms, ease-out | 150 ms, ease-out | 150 ms, ease-out |
| Token override on the panel ancestor | 410 ms, ease-in | 150 ms, ease-out | 410 ms, ease-in |
| Token override on the document root | 240 ms, linear | 240 ms, linear | 240 ms, linear |
| Root override plus unlayered duration declaration on the direct panel | 240 ms, linear | 240 ms, linear | 520 ms, linear |
| Reduced motion | `all`, 0 ms, ease | `none`, 0 ms, ease | `none`, 0 ms, ease |
| Reduced motion with root, subtree and direct duration overrides active | `all`, 0 ms, ease | `none`, 0 ms, ease | `none`, 520 ms, ease |

In the named form, `--durations-normal` and `--easings-out` reference the UXor variables where the aliases are defined
on the root. A scope nested beneath the root inherits the resolved aliases. Direct declarations resolve the UXor
variables on the element. The unlayered duration declaration wins over UX CSS's `utilities` layer even though its
stylesheet comes first. Changing opacity on the direct panel started an actual 150 ms transition in normal motion.
With reduced motion and all overrides active, the browser started zero transitions.

The full probe covered the two static panel variants in Chromium. Spot checks in Firefox 146.0.1 and WebKit 26.0
reproduced the defaults, the ancestor override results and reduced-motion styles. Variant-class merging and broad
recipe migration were left for a future evaluation.

## DesignTokens readiness

The 3.7.0 release reads `ux_css.tokens`, and the two panel examples used its `css()` function. The 3.8 development
changelog lists `cva()` and changes to `css()` and same-property overrides. The findings apply to 3.7.0.
[UX CSS 3.7.0 release](https://github.com/symfony/ux-css/releases/tag/v3.7.0) ·
[UX CSS development changelog](https://github.com/symfony/ux/blob/3.x/src/Css/CHANGELOG.md)

The open DesignTokens proposal covers DTCG tokens, typed values and CSS custom-property output. The proposed UX CSS
adapter closed without merging and depends on DesignTokens landing first. Revisit an adapter when a released pair can
preserve UXor's documented custom-property names, inherited subtree overrides and reduced-motion behavior. The trial
exercised the existing CSS variables and the bundle's own token configuration.
[DesignTokens proposal](https://github.com/symfony/ux/pull/3932) ·
[UX CSS adapter proposal](https://github.com/symfony/ux/pull/4181)

## Checks at the time

The Chromium probe and all 36 tests in the Chromium motion suite passed. The demo's PHP suite passed all 446 tests.
Composer validation, Twig and YAML lint, the route inventory and the security policy passed. The probe route was
absent from the `dev` and `test` route collections. The standard static export built and checked 453 pages.

## Repeat the trial

The trial code is not on `dev`. It is on the branch `claude/wo-symfony-trials--ux-css` at commit
[`65f5820`](https://github.com/xormania/uxor/tree/65f582042ea791fc30bba555ed27f8052acdb5d4), from
[pull request 248](https://github.com/xormania/uxor/pull/248). That commit holds:

- the demo's Composer files requiring `symfony/ux-css` 3.7.0, with the bundle enabled only in an opt-in
  `motion` environment;
- that environment's UX CSS token configuration, mapping its `normal` duration and `out` easing to the kit's
  `--uxor-motion-duration-normal` and `--uxor-motion-ease-out`, and an AssetMapper path served under its own prefix;
- a development-only GET route, `/_experiments/ux-css/motion`, rendering a fixed Twig panel fixture;
- `tools/experiments/ux-css/`: the panel fixture, an override stylesheet and `probe.mjs`, a Playwright probe.

From a checkout of that commit with PHP 8.4 or later and Composer, sync and install the demo, build its Tailwind
stylesheet and clear the `motion` cache with debug off (clearing it regenerates the UX CSS stylesheet). Serve that
environment with the native PHP server on a loopback port, start a Playwright 1.58.2 server on port 3000, and run the
probe; it reads `DEMO_URL` and `PW_WS_ENDPOINT` for other addresses. The commit's own copy of this note gives the
exact commands.

To test a newer UX CSS release, change its version in the trial's Composer files and check the token configuration
against that release's changelog first.
