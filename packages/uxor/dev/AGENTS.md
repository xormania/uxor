# Package consumer fixture

This subtree is UXor's repository-only consumer test harness. Follow the
[root contributor guidance](../../../AGENTS.md), [project boundaries](../../../CONTRIBUTING.md#project-boundaries)
and [fixture guide](README.md).

- The application root is `packages/uxor/dev/app/`; its Composer dependencies, cache and Mate installation are
  independent of `demo/` and of the repository's root dependencies.
- Use `run.py` in the selected native or Docker mode for this application. Do not diagnose it with the demo's
  runtime, tools or request profiles.
- The customer workflow installs recipes from the committed archive with `install-uxor.py`; it does not use
  `tools/sync-demo`. Follow the fixture guide for preparation, browser checks and diagnostics.
- Mate-generated instructions, discovered skills and installed dependencies under `app/` are local outputs.
  Edit the package's source guidance when testing a product change; do not commit the generated copies.
