---
name: uxor-build
description: Use to understand, build or refactor a consuming Symfony application's feature with UXor components, Serena/Mago source tools, native Makers, Forms, Stimulus and Turbo.
---

# Understand and build an application feature

Follow the application's instructions and authorized task. Preserve its customized components and business code.

## Procedure

1. Define the requested journey: initial/loading/empty states, inputs, validation, successful action, updated
   content, feedback, focus and Back/Forward behavior. Select the relevant Turbo or Live transitions.
2. Inspect the application with its existing tools. Use `vendor/bin/mago` for native checks. For a Serena launch or a containerized Mago check, review the application and its extensions, then place
   `--trust-project-code` before the `vendor/bin/uxor-mago` subcommand. Use Serena
   for symbols, bodies, definitions and references.
   Use Mate for compiled service detail and a fresh prepared graph for concrete wiring when useful.
   Analysis dependencies do not establish measured calls or a complete application graph.
3. Search the UXor catalog and inspect installed/customized components. Use `mate-uxor-setup` for missing
   tools, components or dependencies. Discover installed Maker options before generation.
4. Implement application-owned classes and wiring with Symfony Forms, validation and routing.
   Use semantic edits when appropriate; the UXor wrapper mounts the checkout read-only by default. For an authorized edit, add `--write` before
   the `serena` or Mago subcommand in addition to execution trust. Writable access includes
   repository metadata. Re-query after edits instead of applying stale ranges.
5. Follow the selected component contracts for identifiers, Stimulus cleanup, theme roles, icons and CSP.
   Complete validation responses, redirects, feedback and the intended Turbo/Live update behavior.
6. Use native Mago PHP/Twig formatting, lint, analysis and supported fixes. Inspect the diff and native findings.
   Run focused application tests. Refresh with `uxor prepare --trust-project-code` before relying on stale
   compiled facts; environment changes and untracked imported configuration require an explicit refresh too.
7. Use `mate-uxor-verify` for the served interaction. After an interrupted mutation, inspect the actual state
   before retrying.

## References

Search `uxor_catalog`, continue with `data.next_offset` and read the selected
`uxor://reference/<recipe>/README.md`. Consult `uxor://reference/docs/GUIDE.md` for component,
Turbo/Live and security contracts. For a matching list/edit/save journey, read
`uxor://workflow/customer-management` or use bounded `uxor_workflow`.

Use the application's configured Mate CLI for `resources:read` and `tools:inspect`; use `uxor_reference`
for bounded pages. Packaged guidance is also under `vendor/xormania/uxor/packages/uxor/` with the
default vendor directory. Its `OPERATIONS.md` explains source operations, preparation scope and diagnosis.
Use the application's actual vendor directory and inspect its installed source before relying on references.

Report delivered behavior, reused components, checks performed and specific remaining failures or unknowns.

If Mate resources are unavailable, read bundled guides under
`vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` and append the indexed reference path.
Replace `vendor` with the application's configured Composer vendor directory.
