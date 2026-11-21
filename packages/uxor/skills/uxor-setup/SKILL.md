---
name: uxor-setup
description: Use when installing UXor components or diagnosing installation and wiring in a consuming Symfony application, following its instructions and runtime.
---

# Set up UXor in an application

Work in the consuming application's checkout, following its instructions and authorized task scope.

## References

Read `uxor://reference/FOR-AGENTS.md` and `uxor://reference/INSTALL.md`. Search with
`uxor_catalog` using `query`; continue with `data.next_offset` as `offset`.
`uxor://catalog` shows the first page. Read the selected `uxor://reference/<recipe>/README.md`.

Use `resources:read <uri> --format=json` with the application's configured Mate invocation,
or `uxor_reference` for bounded pages. The local fallback is
`vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` with the default Composer vendor
directory; use the application's actual directory. Reference digests identify packaged guidance,
not the source of existing customized files.

## Procedure

1. Identify the application root and PHP/Composer invocation. Use its Docker or native runtime consistently. Inspect Composer metadata, required PHP extensions, bundles, assets and existing components before changing setup.
2. Pin the application's chosen UXor release. Test another supported source ref only when that is the task. Inspect application-owned files before replacement and preserve their customizations.
3. Use Symfony UX Toolkit's `ux:install` and follow the selected README and command output through Composer dependencies, importmap requirements, CSS imports and controller configuration. Keep packages needed by installed PHP, Twig and browser components in regular dependencies; keep development tooling in development dependencies.
4. Render the selected component through the served application. Check controller loading and request, console and CSP failures. Complete `mate-uxor-verify` for the actual interaction; copied files alone do not establish working integration.
5. After updating `xormania/uxor`, run Mate's `discover` to refresh package guidance and skills. Preserve the application's instructions around the managed block and its working configuration.

Discover optional diagnostics with `tools:list` and inspect relevant inputs with `tools:inspect`.
Native metadata discovery requires a trusted, authorized checkout; the package's `OPERATIONS.md`
explains the execution acknowledgement. Report the application/runtime, components and selected source,
changes, checks actually run and unresolved findings. Keep unknown installed provenance explicit.
