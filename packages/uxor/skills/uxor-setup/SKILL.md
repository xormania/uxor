---
name: uxor-setup
description: Use when configuring UXor development tools, installing UXor components, or diagnosing application setup and wiring in a consuming Symfony application.
---

# Set up UXor in an application

Follow the consuming application's instructions, authorized task and runtime. Preserve its configuration
and customized components. Start with the installed `uxor://reference/packages/uxor/README.md` guide for
the package workflow and its first rendered component. Use the package CLI if the client is not connected.

## Procedure

1. Identify the application root and PHP/Composer invocation. Keep application PHP
   commands in its actual runtime. Select `--project-root` explicitly across applications or worktrees.
2. Read `uxor setup --format=json` and `uxor environment --format=json`. Setup defaults to a plan.
   Apply authorized changes with `setup --apply`; installing development dependencies additionally requires
   `--install --trust-project-code`. Use existing task/session authorization when it covers native execution in
   this application and runtime. A configuration-only request does not authorize native execution.
3. Preserve existing files and integrate reported configuration. Composer uses available Flex recipes.
   The default development install requests Symfony’s full debug pack and the Monolog Mate extension.
   Without Flex, follow the application’s dev bundle registration and profiler route conventions. For a debugging
   task, follow the response’s exact token to its profile and inspect an available collector. The advanced
   guide listed below has the commands under “Diagnose a request.”
4. When a task needs Serena or Mago, prepare the providers on the Docker host.
   For generated client configuration use
   `--client=claude|codex` and, when setup runs in PHP Docker, the client's absolute `--host-project-root`.
   Authorize the current MCP launch explicitly after reviewing the application and launcher. Setup's execution
   flag never saves permission. Use `--save-project-trust` only when recurring execution is explicitly authorized;
   it covers later code at that path too. Do not infer this choice from setup, installation or editing permission.
   Setup preserves existing bindings; reconcile them explicitly if the intended permission changes. To revoke
   recurring permission, stop the provider and remove its saved launch flag before reconnecting.
   Connect and query a known application symbol; the generated registration is unverified.
   Mate 1.0.0-BETA1 supplies application CLI tools; Serena supplies MCP.
5. Run `uxor prepare --trust-project-code` in the application PHP runtime when compiled Symfony wiring is needed.
   Inspect its result and integrate `.uxor/mago/config.toml` into the root Mago configuration.
6. For UI components, select the application's chosen UXor release, search the catalog and read the recipe.
   Install with Toolkit's `ux:install` and complete its Composer, importmap, CSS and controller requirements.
   Runtime component dependencies belong in regular dependencies; development tools belong in require-dev.
7. Render and exercise the selected component through the served application, then use `mate-uxor-verify`.
   After package updates, refresh Mate discovery while preserving project-authored instructions.

## References

Read `uxor://reference/FOR-AGENTS.md`, `uxor://reference/INSTALL.md` and the selected
`uxor://reference/<recipe>/README.md`. Search `uxor_catalog` with `query` and continue with
`data.next_offset`. Reference digests identify packaged guidance, not installed source provenance.

Use the configured Mate CLI's `resources:read` or bounded `uxor_reference`. Inspect installed tool inputs
with `tools:inspect` before calling `uxor_setup`, `uxor_environment` or `uxor_prepare`.
The advanced guide is `uxor://reference/packages/uxor/OPERATIONS.md`. Read the installed `README.md`
and `OPERATIONS.md` directly under `vendor/xormania/uxor/packages/uxor/` when working offline.
Use the application's actual Composer vendor directory.

Report the selected application/runtime, changes, checks actually run and unresolved integration steps.

If Mate resources are unavailable, read bundled guides under
`vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` and append the indexed reference path.
Replace `vendor` with the application's configured Composer vendor directory.
