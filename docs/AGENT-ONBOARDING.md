# Give a coding agent its first UXor task

Start with one page in your Symfony application. This walkthrough uses a customer list with an edit dialog.
Choose a route you can open in your own app and give the agent its URL and the action you want to check.
If the application still needs the development package, follow [Set up UXor with Composer](../packages/uxor/README.md).

## Confirm which application the agent sees

Ask the agent to read the application's instructions and run these commands in its PHP environment,
from the directory containing its `composer.json`. These examples use Composer's default directories. For a
relocated `vendor-dir`, use `uxor mate` from the configured binary directory. The application's `.uxor/README.md`
shows the command for its layout.

```sh
vendor/bin/mate tools:call uxor_catalog --query=modal --format=json
vendor/bin/uxor inspect --format=json
```

A successful Composer installation registers UXor's tools with Mate. The catalog result should include `modal`.
The inspection result identifies the selected checkout in `data.root` and local files in `data.component_evidence`.
Compare that path with the application serving the page, using container paths when PHP runs in a container.
To inspect another checkout, pass its absolute path with `--project-root`.

## Give the agent a read-only assignment

> On our customer list, trace what happens when a keyboard user opens and closes the edit dialog. Identify the
> route, Twig template, installed dialog code and any existing test that covers it. Compare the local implementation
> with UXor's modal documentation. Report where focus lands after closing. Keep the application files unchanged.

The package catalog and reference provide the recipe contract.

```sh
vendor/bin/uxor catalog --query=modal --format=json
vendor/bin/uxor component modal --format=json
vendor/bin/uxor reference modal/README.md --format=json
```

`component` gives the exact document key in `data.documentation`. Compare the trigger, dialog and close action
with the copies used by the named template. For an edit flow that also submits a form and refreshes a list,
`vendor/bin/uxor workflow customer-management --format=json` describes that sequence. A long reference or workflow
can return `data.truncated`; pass its `data.next_offset` to `--offset` to continue.

To inspect the tool available to your agent, run `vendor/bin/mate tools:inspect uxor_project --format=json`.
If Mate discovery is incomplete, use the standalone UXor commands above while you [check the installation](../packages/uxor/README.md#install-in-a-symfony-application).
[Connect an agent client](../packages/uxor/README.md#connect-an-agent-client) covers optional Serena source queries.

## Check the result

Open the named page in a browser or run an existing interaction test. Activate its edit trigger with the keyboard,
close the dialog, and observe which control has focus. The agent's report should name the application files it found, the check it ran and what happened.
If the page has no dialog yet, a useful result is the actual template where it would belong and the missing recipe
or wiring. If the page could not be served, report the blocking step and what remains unverified.
[Testing an application using UXor](APPLICATION-TESTING.md) covers checking a change in the running app.
