---
name: uxor-verify
description: Use after UXor setup, feature changes or component updates to verify behavior in the consuming Symfony application's runtime and tests.
---

# Verify UXor in an application

Follow the consuming application's instructions and authorized task scope. Verify its actual
installed/customized code using its runtime and existing tests.

## References

Read the selected `uxor://reference/<recipe>/README.md` and
`uxor://reference/docs/APPLICATION-TESTING.md`. Consult relevant
`uxor://reference/docs/GUIDE.md` sections for behavior and security contracts.
For a matching list/edit/save journey, use `uxor://workflow/customer-management` or
the bounded `uxor_workflow` tool. Its local file is
`vendor/xormania/uxor/packages/uxor/resources/workflows/customer-management.md`.

Use `resources:read <uri> --format=json` with the application's configured Mate invocation,
or `uxor_reference` for bounded pages. The local fallback is
`vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` with the default Composer vendor
directory; use the application's actual directory. Reference digests identify packaged guidance,
not the installed application's source or behavior.

## Procedure

1. Identify the application root, PHP invocation, served URL and expected changed behavior. Select checks that exercise this change; record unavailable checks and their concrete cause.
2. Check runtime dependencies, Twig/PHP services, assets/controllers and CSS. Confirm a real application request succeeds. Inspect diagnostic inputs and artifact freshness before interpreting results.
3. Exercise the changed browser journey: applicable validation errors, successful submission, refreshed content, feedback, keyboard/focus behavior and intended Back/Forward state. Cover the Turbo/Live transitions, return visits and repeated mounting relevant to this page.
4. Wait for the transition's completion evidence: Drive, Frame, Stream and Live updates differ. Use application helpers or observable final state. A generic `turbo:load` wait, arbitrary delay or running container does not establish completion.
5. Capture console, request and CSP failures with the application's diagnostics. If the package recorder is configured, read its `browser-diagnostics.json` through `uxor_browser_diagnostics` and open a returned `profileUri` when available. Use an available browser trace for timing; the package's `OPERATIONS.md` explains optional setup.
6. Inspect the final diff and actual state before retrying an interrupted mutation. Report findings separately from command execution success, including failed or skipped checks and remaining unknowns. Review diagnostic output, traces and attachments for sensitive content before sharing.

For initial installation or runtime-dependency changes, also verify boot and selected-component rendering
with development dependencies omitted in an isolated install. Report the journey tested, application/runtime,
source/package revisions and results. Scale checks to the change; UXor's full component suite is maintained in UXor.
