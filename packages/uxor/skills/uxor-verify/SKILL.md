---
name: uxor-verify
description: Use to diagnose a failed Symfony request or verify UXor setup, feature changes and component updates using the consuming application's runtime, profiles, logs and tests.
---

# Diagnose and verify application behavior

Follow the consuming application's instructions and authorized task. Use its actual code, runtime and tests.

## Procedure

1. Identify the application root, PHP invocation, served URL and changed behavior. Inspect `uxor environment`;
   use authorized execution probes when needed. Configuration presence does not prove runtime readiness.
2. Reproduce the request or interaction. Record its URL, time, response status and `X-Debug-Token` when present.
   Read that exact profile with the configured Mate CLI and inspect relevant exception, database, request and
   logger collectors. Discover installed schemas before calling tools. Do not assume the newest profile is yours.
3. If no token exists, use available logs, request evidence or browser traces. An early boot failure can precede
   profiling. Preserve historical profiles/logs before a cache reset; current source changes do not invalidate
   their value as historical observations.
4. Trace the defect with Serena/Mago and current compiled bindings when available. Their application commands
   require `--trust-project-code` before the command; `--write` is a separate grant for an authorized repair.
   Add or select a regression
   that fails on the defect, repair it and verify it passes. Keep existing test coverage and inspect diagnostic
   changes; equal finding counts alone do not establish an unchanged report.
5. Verify a fresh request after repair and exercise the relevant browser journey: validation, submission, content,
   feedback, keyboard/focus behavior, history, return visits and repeated mounting.
6. Wait for the observable final state appropriate to Drive, Frames, Streams or Live updates. A generic
   `turbo:load` wait, arbitrary delay or running container does not prove completion.
7. For a quick headless visit, run `vendor/bin/uxor-browser URL`. Use `--wait-for SELECTOR` when a visible
   element signals readiness. Pass the printed path to `uxor_browser_diagnostics` to inspect page errors,
   failed requests and any exact profiler tokens. Use the application's Playwright tests for multi-step
   interactions, console and CSP checks. Read each profile in the environment that served it.
8. Inspect the final diff and actual state. Report checks, failures, skipped checks and concrete limits separately.
   Review diagnostic output and traces for sensitive application data before sharing them.

For initial installation or runtime-dependency changes, check boot and selected-component rendering with
development dependencies omitted in an isolated install. Scale verification to the change and the application's tests.

## References

Read the selected `uxor://reference/<recipe>/README.md`,
`uxor://reference/docs/APPLICATION-TESTING.md` and relevant `uxor://reference/docs/GUIDE.md` sections.
Use `uxor://workflow/customer-management` for a matching list/edit/save journey.

Use the application's Mate CLI's `resources:read` and installed `tools:inspect`. Bounded reference tools
support continuation offsets. Detailed preparation limits, the request-diagnosis sequence and optional recorder
setup are in `vendor/xormania/uxor/packages/uxor/OPERATIONS.md`; use the actual vendor directory.
Compiled graph facts, historical profiles and a fresh successful request establish different things.

If Mate resources are unavailable, read bundled guides under
`vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` and append the indexed reference path.
Replace `vendor` with the application's configured Composer vendor directory.
