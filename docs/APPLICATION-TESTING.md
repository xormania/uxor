# Testing an application using UXor

For developers and agents checking a Symfony application that uses UXor recipes, with or without the optional
Composer development package. Work under the application's instructions, permissions and test conventions.
UXor's demo routes, repository CI, release process and package-development fixture are contributor infrastructure;
they are not requirements for your application.

## Select the application and contract

Identify the application root, its PHP/Composer invocation and the served URL before running diagnostics.
Use its configured native or container runtime consistently. Read the selected components' READMEs and inspect
their installed copies: the application owns and may customize those files. A package reference describes the
bundled source, not proof of what is installed. Record a known recipe release or revision; otherwise report it
as unknown.

Use [installation guidance](../INSTALL.md) for missing setup and the [usage guide](GUIDE.md) for component,
Turbo, Live Component and security contracts. When using the Composer package, select the application explicitly
when crossing projects or worktrees; [package operations](../packages/uxor/OPERATIONS.md) describes root binding.

## Verify integration

Reuse the application's existing checks and choose those that exercise the change. Check required dependencies,
autoloading and services, asset/controller discovery, CSS and theme integration, then render a real request.
Keep packages used by installed PHP, Twig and browser components in the application's runtime dependencies.
The optional UXor helper package remains a development dependency.

For a first installation or runtime-dependency change, verify that an isolated installation with development
dependencies omitted can boot and render the selected components. Do not remove dependencies from the working
application just to perform that check. A file-presence check or a running container alone does not establish
successful integration.

## Exercise the changed journey

Test the actual page and the behavior changed: initial and empty states, inputs, validation, successful actions,
updated content, visible feedback, keyboard/focus behavior and intended Back/Forward state. Check the themes and
viewport sizes the application supports. Exercise Turbo or Live transitions, return visits and repeated mounting
where that page uses them.

Wait for an observable result appropriate to the operation. Drive visits, Frames, Streams and Live updates have
different completion signals; a universal navigation event or a fixed delay does not prove all of them finished.
Capture console errors, failed requests and Content Security Policy violations. Allow an intentionally invalid
form response only in the scenario that expects it, while continuing to reject unexpected failures.

Reusable examples are in UXor's testing reference: [transition completion](TESTING.md#wait-for-the-operation-to-complete-not-for-content),
[history restoration](TESTING.md#back-after-the-cache-snapshot), [Live Components](TESTING.md#live-components)
and [accessibility](TESTING.md#accessibility). Adapt the selected pattern to your application; the surrounding
repository commands, demo paths and CI configuration describe how UXor itself is maintained.

## Use available diagnostics

Use the application's existing browser and server diagnostics. If the optional package recorder is configured,
read its artifact through `uxor_browser_diagnostics` or the standalone CLI and open a returned `profileUri`
in the Mate environment that served the request. Inspect the installed tool's inputs before calling it.
A missing recorder, trace or Symfony response token is a missing evidence source, not a passing result.

[Browser diagnostics](../packages/uxor/OPERATIONS.md#browser-diagnostics) explains the opt-in Playwright fixture,
artifact paths and fallback when no profile is available. Installing the helper package does not create a browser
suite or require the application's asset pipeline to use Node.js.

## Report results in the application's context

Inspect the final application diff, including deliberate changes to copied recipe code. Report the journey tested,
application/runtime, known source versions, checks and actual outcomes, plus failures or checks not run.
Keep the application's customizations and instruction files intact unless the task calls for changing them.

Review diagnostic material before sharing it: URLs, profiler data, error messages, stacks and traces can contain
application data or secrets. Follow the receiving project's disclosure and publication rules. UXor's contributor
policies apply when submitting work to UXor; the consuming application retains its own development governance.
