# Testing an application using UXor

Choose one real page in your Symfony application and the result a user should see. Use the app's existing
checks, or exercise the page in a browser. The same approach works with recipes installed directly through
Symfony UX Toolkit and with the optional UXor Composer development package.

## Select the application and contract

Identify the checkout, its native or container PHP invocation and the served URL. Read the selected
[recipe's usage](RECIPES.md) and inspect the application's installed files for customizations. Record the recipe
release or revision from the project's installation history. If that history is unavailable, report the recipe revision
as unknown.

With the development package installed, run these read-only checks from the app's root in its PHP environment.
This example checks an app that uses the modal recipe.

```sh
vendor/bin/uxor inspect --format=json
vendor/bin/uxor doctor --component=modal --format=json
```

Confirm `data.root` in the inspection result. Read the doctor's individual `data.findings`. A missing controller
in the conventional asset layout gives you a file to inspect. If the app uses its own asset layout, select
`--asset-profile=custom` and check registration in that pipeline. The doctor can return exit code 2 for failing
or incomplete checks. Use a served page to settle runtime findings marked `unknown`.
[Project evidence and first-setup checks](../packages/uxor/OPERATIONS.md#project-evidence-and-first-setup-checks).

## Verify what changed

| Change | Check in the application | Observable result |
|---|---|---|
| A first Twig component | Build the app's styles and open the route using the template. | For a [Kbd](../kbd/README.md) displaying Ctrl, the page shows a styled `<kbd>` with that text. |
| A dialog's keyboard interaction | Open the [modal](../modal/README.md) from its trigger with the keyboard, close it and open it again. | The intended dialog opens, closing returns focus to the trigger and the next opening still works. |
| An editor that updates a list | Submit invalid input, correct it, save and reload the list. | The app shows its validation error, then the saved value and its intended feedback. The saved value survives reload. |

Exercise theme, viewport, Back/Forward, repeated mounting or empty states where the changed behavior depends on
them. A Frame's new content, a Stream's updated row or a Live Component's rendered state tells you when that
operation has finished. Check for failed requests, browser errors and Content Security Policy violations.
An expected validation response belongs to its invalid-input case.

For a first installation or a change to runtime dependencies, verify that a separate installation of the app
with development dependencies omitted can boot and render the selected component. Keep the project's working
environment intact. The [installation guide](../INSTALL.md) covers missing dependencies and the
[usage guide](GUIDE.md) covers Turbo, Live Components and the security contracts.

## Diagnose a failure and report the outcome

Start with the first failing response or UI observation. If markup renders but a control does nothing, check the
installed controller, asset requests and browser console. If the server returned an error, inspect the application's
logs or the Symfony profile for that request. With UXor's optional recorder configured, read the captured artifact
through `uxor_browser_diagnostics` or the standalone CLI, then open the returned `profileUri` in the Mate
environment that served it. [Browser diagnostics and fallback evidence](../packages/uxor/OPERATIONS.md#browser-diagnostics).

Report the route, runtime, steps, expected result and actual result, including any checks you could not run.
Review the application diff after a change. Redact sensitive URLs, profiler records and traces before sharing.
For existing browser tests, the testing reference has examples of [transition completion](TESTING.md#wait-for-the-operation-to-complete-not-for-content),
[history restoration](TESTING.md#back-after-the-cache-snapshot), [Live Components](TESTING.md#live-components)
and [accessibility](TESTING.md#accessibility).
