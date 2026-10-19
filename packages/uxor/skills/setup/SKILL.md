---
name: setup
description: Set up UXor in a Symfony application, or diagnose an incomplete installation, using the project's actual runtime and the packaged UXor reference.
---

# Set up UXor

Use this skill when a Symfony application needs UXor or when installed components do not render or behave correctly.

## Read the relevant references

Read the resources with the project's Mate invocation, for example:

```bash
vendor/bin/mate resources:read uxor://reference/INSTALL.md --format=json
vendor/bin/mate resources:read uxor://reference/FOR-AGENTS.md --format=json
```

The same files are available under `vendor/xormania/uxor/packages/uxor/resources/uxor/docs/` with Composer's default vendor directory. A project can customize that directory; use Composer's actual configuration. Resources are reference facts about the UXor files identified (by digest) in the package's `packages/uxor/resources/uxor/index.json`, not proof of the application's installed code.

For bounded sections of long documents, inspect and use the installed `uxor_reference` tool rather than loading every reference page.

After updating xormania/uxor with Composer, run `vendor/bin/mate discover` in the
application to refresh its instructions and skills. Existing project instructions
outside Mate's managed block and application-owned component files remain intact.

## Procedure

1. Identify the application root, its project instructions and its PHP/Composer invocation. Use its existing Docker or native runtime consistently. Inspect `composer.json`, `composer.lock`, bundle configuration, importmap/assets and existing component files before changing setup.
2. Read the installation reference. Reuse working project configuration. Establish the required PHP extensions, regular runtime dependencies, Toolkit development dependencies, Stimulus discovery, styling and theme. Keep packages needed by installed PHP, Twig or browser components in the application's regular dependencies.
3. Select components from `uxor://catalog`, then read only their `uxor://reference/<recipe>/README.md` resources. Choose an explicit UXor release or revision compatible with the application and record it. The package version describes the supplied guidance; it does not establish the origin of existing customized files.
4. Use Symfony UX Toolkit's supported `ux:install` command. Follow its output and the component README through Composer dependencies, importmap requirements, CSS imports and controller configuration. Copied files alone do not establish completed integration. Existing application files and customizations need inspection before replacement.
5. Render a small page using the selected component and exercise its behavior through the served application. Confirm controller loading and inspect request, console and CSP failures. Complete the `verify` skill for the actual interaction.

## Deliver useful completion evidence

Report the selected application/runtime, installed components and source selection, files/configuration changed, checks actually run and remaining work. Record unknown installed provenance as unknown. Repeating setup should preserve existing project instructions and working configuration.

For available project diagnostics, discover Mate tools with `vendor/bin/mate tools:list`, then inspect a relevant tool's inputs with `tools:inspect` before calling it. An unavailable diagnostic is a specific remaining check, not evidence that setup passed.
