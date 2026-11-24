# Give a coding agent its first UXor task

Start with one page in your Symfony application. This walkthrough uses a customer list with an edit dialog.
Choose a route you can open in your own app and give the agent its URL and the action you want to check.
If the application still needs the development package, follow [Set up UXor with Composer](../packages/uxor/README.md).

## Confirm which application the agent sees

Ask the agent to read the application's instructions and run the following in its PHP environment, from the
directory containing its `composer.json`. These examples use Composer's default binary directory.

```sh
vendor/bin/uxor list --raw
vendor/bin/uxor inspect --format=json
```

The first command lists the installed CLI commands. The second reports the application directory in `data.root`
and local file evidence in `data.component_evidence`. Compare the root with the checkout serving the page.
Inside a container, compare container paths. If the root is wrong, change to the intended directory or repeat
`inspect` with `--project-root=/absolute/path/to/the/application`.

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

If the app uses Mate, its CLI lists the registered tools with `vendor/bin/mate tools:list --format=json`.
Inspect the bound project tool with `vendor/bin/mate tools:inspect uxor_project --format=json`. If the tool
is missing, the standalone UXor commands above still work. [Agent setup and troubleshooting](../packages/uxor/README.md#connect-an-agent-client).

## Check the result

Open the named page, activate its edit trigger with the keyboard, close the dialog and observe which control
has focus. The agent's report should name the application files it found, the check it ran and what happened.
If the page has no dialog yet, a useful result is the actual template where it would belong and the missing recipe
or wiring. If the page could not be served, report the blocking step and what remains unverified.
[Testing an application using UXor](APPLICATION-TESTING.md) covers checking a change in the running app.
