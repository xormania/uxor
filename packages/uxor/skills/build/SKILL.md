---
name: build
description: Build a complete Symfony application interaction with existing UXor components, forms, Stimulus and Turbo, preserving the project's customized code.
---

# Build with UXor

Use this skill when implementing an application page or interaction with UXor.

## Find guidance on demand

Read `uxor://catalog` to select relevant components and `uxor://reference/<recipe>/README.md` for their contracts, examples and follow-up integration. Read `uxor://reference/docs/GUIDE.md` for the relevant Turbo, Live Component and security behavior. `uxor://reference/docs/PROJECT-AGENTS-SNIPPET.md` contains UXor's practical project conventions.

With Mate, use the project's invocation of `vendor/bin/mate resources:read <uri> --format=json`. Without that surface, locate the same documents at `vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` (the default Composer vendor directory; use the application's actual one). The source revision is recorded in the package's `packages/uxor/resources/uxor/index.json`. These documents describe reference behavior; inspect the application's installed copies too.

For bounded sections of long documents, inspect and use the installed `uxor_reference` tool. Keep catalog selection compact, then load detail for the chosen components.

For a searchable list with an editor, validation and save feedback, read `uxor://workflow/customer-management` or use the bounded `uxor_workflow` tool. This guide, written for the UXor package rather than generated from the recipe READMEs, shows how the components connect to application code. It also ships at `vendor/xormania/uxor/packages/uxor/resources/workflows/customer-management.md`.

## Procedure

1. State the complete user journey: initial page, loading/empty state, inputs, validation, successful action, affected content, feedback, focus and intended Back/Forward behavior. Choose how Turbo Drive, Frames, Streams and Live Components participate in that journey.
2. Inspect the existing application and choose the smallest existing UXor components or block that cover it. Read their docs before composing them. Use the project's `setup` procedure to install missing components and complete their dependencies.
3. Reuse Symfony Forms, validation, routing and installed Makers for application wiring. Add business code in the application's own classes. Installed UXor PHP commonly lives under `App\UXor\`; inspect its actual autoloading and service configuration rather than relying on the demo's sibling-directory wiring.
4. Follow the selected components' contracts. Preserve stable identifiers where Turbo/Live needs them. Use their Stimulus behavior and cleanup; avoid a second initialization system. For the reviewed reference profile, Flowbite supplies CSS while component behavior lives in Stimulus. Follow the selected version's theme roles, icon handling and CSP requirements.
5. Complete the interaction across updates. Handle invalid submitted forms and successful redirects with the documented response behavior. Deliver toast feedback through the documented stream mechanism, including when its region is permanent. For record lists, choose the table variant whose history and update behavior match the journey. Review file-upload and editor-specific integration when those components are used.
6. Run the `verify` procedure against the served page and inspect the actual change before declaring completion.

## Use source and runtime tools together

Serena can navigate and edit PHP/JavaScript source when available. Inspect Twig, YAML, route attributes, service identifiers and Stimulus conventions with text search as needed: an empty semantic-reference result does not establish that these entry points are unused. Mate supplies application/runtime evidence from the selected project. Confirm both tools address the same checkout and runtime.

After an interrupted edit or failed REPL cell, inspect resulting files and changes before retrying. A reconnect can lose session variables while filesystem changes remain.

Report what the journey now does, the components reused, checks performed and specific remaining failures or unknowns.
