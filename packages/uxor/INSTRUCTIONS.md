# Building with UXor

Use the UXor package when a Symfony task involves UXor components, layouts, forms,
Turbo interactions or an incomplete installation. Load the setup, build or verify
skill for the task, then read the relevant component references on demand.

Discover installed tools with Mate's tools:list and inspect inputs before calling
them. The UXor package provides component search/detail, bounded documentation reads,
bound-project inspection, first-setup findings and native Maker/Mate metadata.
Native metadata discovery executes the selected project's PHP/autoload code.
It defaults to blocked. For a checkout already trusted and authorized for
execution, pass trustProjectCode=true to uxor_tools or --trust-project-code
to the standalone tools command; existing session authorization is sufficient.
The tools have the uxor_ prefix. The uxor://catalog resource is a
starting page; uxor://reference/INSTALL.md and component README resources
provide detail. Use the reference tool's continuation offsets for long documents.

Reference results identify their UXor sources by digest. Project inspection reports
observed metadata and explicit unknowns; application-owned files may differ from
the reference. Use Toolkit for source installation and native Makers/Mate for
framework work. Complete dependency, asset and configuration requirements before
verifying the actual browser journey, including its Turbo behavior.

Run all project operations in the application's configured PHP environment. The
standalone vendor/bin/uxor CLI exposes the same services and accepts
--format=json. Project inspection defaults to the current directory there; select
--project-root explicitly when working across applications or worktrees.

After updating xormania/uxor with Composer, run vendor/bin/mate discover in
the application to refresh its agent instructions and skills. Preserve the
project-authored content around Mate's managed instruction block.
