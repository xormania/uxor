---
name: uxor-build
description: Use when building a page or interaction in a consuming Symfony application with UXor components, Symfony Forms, Stimulus and Turbo, following that application's conventions.
---

# Build an application feature with UXor

Work in the consuming application's checkout, following its instructions and authorized task scope.
Preserve its customized components and business code.

## References

Search `uxor_catalog` using `query`; continue with `data.next_offset` as `offset`.
Read the selected `uxor://reference/<recipe>/README.md` and relevant
`uxor://reference/docs/GUIDE.md` sections for component, Turbo/Live and security contracts.
For a matching list/edit/save journey, use `uxor://workflow/customer-management` or the bounded
`uxor_workflow` tool. Its local file is
`vendor/xormania/uxor/packages/uxor/resources/workflows/customer-management.md`.

Use `resources:read <uri> --format=json` with the application's configured Mate invocation,
or `uxor_reference` for bounded pages. Reference files are also under
`vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` with the default Composer vendor
directory; use the application's actual directory. Packaged source digests identify guidance;
inspect the application's installed copies before relying on it.

## Procedure

1. Define the requested journey: initial, loading and empty states, inputs, validation, successful action, updated content, feedback, focus and Back/Forward behavior. Choose the relevant Turbo Drive, Frames, Streams or Live Component transitions.
2. Inspect the application and reuse suitable UXor components or blocks. Use `mate-uxor-setup` for missing components and their dependencies.
3. Reuse Symfony Forms, validation, routing and installed Makers for application wiring. Put business code in the application's classes. Inspect its actual autoloading and service configuration; installed UXor PHP commonly lives under `App\UXor\`.
4. Follow the selected version's contracts for stable identifiers, Stimulus behavior and cleanup, theme roles, icons and CSP. In the documented profile, Flowbite supplies CSS and Stimulus supplies behavior; avoid a second initialization system.
5. Complete validation responses, successful redirects and feedback across updates. Use the documented toast stream mechanism, including permanent regions. Match table history/update behavior to the journey, and follow upload/editor integration when used.
6. Run `mate-uxor-verify` against the served interaction and inspect the final change. After an interrupted edit, inspect the existing state before retrying.

Report the behavior delivered, components reused, checks performed and specific remaining failures or unknowns.
