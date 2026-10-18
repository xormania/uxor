# Searchable records with a modal editor

This workflow, written for the UXor package, connects normally installed UXor components to application business code. It demonstrates a searchable, sortable, paginated list; a modal editor; server validation; successful-save updates; feedback; focus; and browser history. Adapt the domain, persistence and access control to the consuming application.

**Reference context:** the example fixture installs UXor `40d957cd1ea7766ac0dee742816948ce5ae05bc3` and runs Symfony 7.4. The corresponding UXor component contracts are in the packaged `uxor://reference/<recipe>/README.md` resources. This workflow is maintained with the UXor package, separately from that generated reference snapshot. Inspect installed application files and the project's dependency locks before applying it.

Read this guide through `uxor://workflow/customer-management` or the bounded `uxor_workflow` tool. The same file ships in the Composer package at `packages/uxor/resources/workflows/customer-management.md`, which is `vendor/xormania/uxor/packages/uxor/resources/workflows/customer-management.md` in an application.

## Start with the intended behavior

List navigation owns search, sort and page history. Editing opens over that list without adding a history entry. An invalid form keeps the editor open and identifies the field error. A successful save refreshes the relevant list, closes the editor, adds feedback once and returns focus to a useful control. A direct edit URL also works as an ordinary server-rendered form.

| Responsibility | Existing capability or application code |
| --- | --- |
| List rendering, query normalization and pagination | Installed UXor `data-table` |
| List data, allowed sorting and persistence | Application table subclass and repository |
| Fields, validation and CSRF | Symfony Form and Validator with UXor `form-theme` |
| Dialog behavior and cleanup | Installed UXor `modal` |
| List/editor replacement and feedback delivery | Turbo Streams and UXor `toast` |
| Focus after the edited row moves or disappears | Small application Stimulus controller |
| Authentication and permission checks | The consuming application's security model |

Install the selected recipes through Toolkit and complete its printed dependency commands plus each README's CSS/configuration steps. The fixture uses `data-table`, `modal`, `form-theme` and `toast`; their recipe dependencies are installed with them. Keep the project's chosen UXor source explicit.

Installed PHP belongs in the application's normal `src/UXor/` tree under `App\UXor\`, using its `App\` PSR-4 mapping and service discovery. The UXor demo's sibling-directory mappings are unnecessary in this consumer. Runtime PHP/Twig/browser dependencies remain regular application requirements; Toolkit and the UXor package (`xormania/uxor`) can be development dependencies.

## Connect application data to the table

Create one application class extending `App\UXor\DataTable\AbstractDataTable`. Implement `columns()`, protected `countRows(TableQuery): int` and protected `loadRows(TableQuery): array`. Both data operations apply the same filters. Load only the requested page using `$query->offset()` and `$query->pageSize`.

Declare allowed sort fields in the columns and map normalized `$query->sortField` and `$query->direction` to the repository query. SQL identifiers are application-controlled; a query parameter is never an SQL column expression. The fixture sorts Name and Email through normalized allowed fields, with a stable record-ID tie-breaker before pagination. Its small session-backed store keeps tests isolated. A real application supplies its own persistence and querying.

The list controller passes `$table->handleRequest($request)` to its template. Render `<twig:DataTable :table="table" id="customers" />` and use `<twig:block name="cell_edit">` for the edit action. Give row actions stable IDs such as `edit-customer-42`.

Keep the list query in edit links and the form action. The successful refresh needs the original list's search, sort and page context. Build the refreshed table against the **list route's URL**, rather than the edit route: otherwise generated table links can start pointing at the editor.

## Put a regular form inside the editor frame

The list page contains an empty `<turbo-frame id="customer-editor">`. Edit links target that frame with `data-turbo-frame="customer-editor"`. The edit response includes the matching frame and an open UXor Modal with the Symfony form inside it.

Choose this framed representation when the request targets that editor frame. A direct request renders the same form as an ordinary page with a route back to the list. The edit frame does not use a promoted history action in this workflow; the table's navigation retains its own history behavior.

Use Symfony server-side constraints for the fields and the UXor form theme for labels, help and accessible errors. Bind and validate the form in the ordinary controller flow:

```php
$form->handleRequest($request);
if ($form->isSubmitted() && $form->isValid()) {
    // Persist through the application's repository and return the chosen response.
}
// A submitted invalid form renders with HTTP 422; an initial GET renders with 200.
```

Return the matching editor frame on HTTP 422 so Turbo can replace its contents while keeping the dialog interaction. Ensure the invalid field's error is visible and referenced by `aria-describedby`, with `aria-invalid` set. Direct focus to the first applicable invalid field; on initial opening, focus a useful form control. Reuse Modal's behavior instead of manually managing another dialog lifecycle.

## Return one coherent successful-save response

After persistence, an accepted Turbo Stream response can perform these operations:

```twig
<turbo-stream action="replace" target="customers">
    <template>{{ include('customer/_table.html.twig') }}</template>
</turbo-stream>
<turbo-stream action="replace" target="customer-editor">
    <template><turbo-frame id="customer-editor"></turbo-frame></template>
</turbo-stream>
<twig:Toast:Stream variant="success">Customer saved.</twig:Toast:Stream>
```

Set Symfony UX Turbo's stream request format when returning this representation so the response has the correct media type. The full table replacement retains its stable ID and the original list URL/query. Replacing the editor removes the dialog, letting its controller clean up. The toast stream delivers into the existing permanent toast region; rendering a new region containing the message during a later visit would not replace the retained region.

The fixture adds a small Stimulus controller to the replacement editor frame. On connection it focuses the edited row's action, falling back to the list's search control if the record no longer belongs on that filtered page. Keep that application-specific focus choice explicit. Test both destinations when the feature can remove or move a record.

For an ordinary browser submission, add a flash message and respond with HTTP 303 to the list route, preserving its query. The list renders that flash through `Toast:Stream` for the JavaScript-enhanced experience. The form itself still works without JavaScript. This is one composition pattern; a project can choose a successful redirect or other update strategy when its journey calls for it.

## Verify the interaction and its dependency boundary

Check the served application, including its real assets and security policy:

1. Search, change sort and change page. Back and Forward restore the intended list state without turning list controls into edit-route links.
2. Open the editor with the keyboard, inspect focus and submit invalid values. Assert HTTP 422, visible accessible errors and focus on the invalid field while the list URL stays unchanged.
3. Correct and submit the form. Observe the saved list content, removed dialog, one feedback message and useful restored focus. Reload to confirm persistence rather than accepting an optimistic DOM-only result.
4. Walk list history after saving. Confirm the editor does not reappear unexpectedly and updated content does not revert to stale cached data. Exercise the row-leaves-filter/page case where applicable.
5. Open the edit URL directly with JavaScript disabled. Verify server validation and a successful HTTP 303 redirect. In an isolated installation omitting development dependencies, boot the application and render its installed components.

Wait for the actual frame/stream response and resulting state. These updates do not require an unrelated `turbo:load` event. Capture console errors, page errors, failed requests and CSP violations during the journey. Reuse the application's existing browser helpers and avoid importing UXor's entire component suite for this integration check.

The example adapts the demo's request-scoped CSP nonce approach. A long-lived PHP service must obtain a fresh nonce for each main request. Ensure the rendered script tags and response header use that request's value. The reviewed component profile uses Stimulus behavior, theme CSS and no Flowbite JavaScript.

## Reference implementation

The fixture still lives in the former companion repository, xormania/uxorscient, until it moves into the UXor repository. These links are historical, pinned to a verified revision of the fixture there, so they keep working after the move:

- [Controller and response branches](https://github.com/xormania/uxorscient/blob/ebf5d4926927be88c735b888b096d24210a593d3/dev/app/src/Controller/CustomerController.php)
- [Application table subclass](https://github.com/xormania/uxorscient/blob/ebf5d4926927be88c735b888b096d24210a593d3/dev/app/src/Table/CustomersTable.php)
- [Symfony form and constraints](https://github.com/xormania/uxorscient/blob/ebf5d4926927be88c735b888b096d24210a593d3/dev/app/src/Form/CustomerType.php)
- [Templates and stream response](https://github.com/xormania/uxorscient/tree/ebf5d4926927be88c735b888b096d24210a593d3/dev/app/templates/customer)
- [Focus restoration controller](https://github.com/xormania/uxorscient/blob/ebf5d4926927be88c735b888b096d24210a593d3/dev/app/assets/controllers/customer_saved_controller.js)
- [Browser interaction checks](https://github.com/xormania/uxorscient/blob/ebf5d4926927be88c735b888b096d24210a593d3/tests/e2e/customer-workflow.spec.mjs)

The fixture's session store is a test/development choice. Its successful journey provides evidence about this selected composition on its tested environment; it does not establish all component or platform combinations.
