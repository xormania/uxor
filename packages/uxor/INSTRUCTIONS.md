# Building with UXor

Use the UXor package when a Symfony task involves UXor components, layouts, forms,
Turbo interactions or an incomplete installation. Load `mate-uxor-setup`,
`mate-uxor-build` or `mate-uxor-verify` for the task, then read the relevant
component references on demand.

UXor is independently maintained. The official Symfony UX flowbite-4 kit was an
initial reference only; it does not govern UXor's design, names, behavior or tests.
Toolkit installation support, Flowbite CSS and the icon set are current integrations
that can evolve with UXor's requirements and compatibility commitments. Use UXor's
guidance and the application's installed code, rather than imposing parity with the reference kit.

Run `tools:list` with the application's configured Mate invocation and inspect tool
inputs before calling them. The UXor package provides component search/detail, bounded documentation reads,
bound-project inspection, first-setup findings and native Maker/Mate metadata.
For a browser failure, use the application's Playwright diagnostic run with the
package recorder. Read the resulting browser-diagnostics.json with
uxor_browser_diagnostics using the application-relative path, and open the
exact Symfony request through the returned profileUri in Mate. The installed
packages/uxor/OPERATIONS.md explains how to enable recording in a consumer app.
Native metadata discovery executes the selected project's PHP/autoload code.
It defaults to blocked. For a checkout already trusted and authorized for
execution, pass trustProjectCode=true to uxor_tools or --trust-project-code
to the standalone tools command; existing session authorization is sufficient.
The tools have the uxor_ prefix. The uxor://catalog resource shows the first page.
Use uxor_catalog to search or browse more results. The uxor://reference/INSTALL.md
and component README resources provide detail. Use the reference tool's continuation
offsets for long documents.

Reference results identify their UXor sources by digest. Project inspection reports
observed metadata and explicit unknowns; application-owned files may differ from
the reference. Use Toolkit for source installation and native Makers/Mate for
framework work. Complete dependency, asset and configuration requirements before
verifying the actual browser journey, including its Turbo behavior.

Run all project operations in the application's configured PHP environment. The
standalone vendor/bin/uxor CLI exposes the same services and accepts
--format=json. Project inspection defaults to the current directory there; select
--project-root explicitly when working across applications or worktrees.

After updating xormania/uxor with Composer, run `discover` with the application's
configured Mate invocation to refresh its agent instructions and skills. Preserve the
project-authored content around Mate's managed instruction block.
