# Optional UXor guidance for applications

This is a short starting point for a Symfony application using UXor recipes. Adapt it only when adding persistent
UXor guidance is part of the application's setup, and merge it with existing project-owned instructions.
The application's workflow and permissions remain authoritative for work in that application.

If the optional Composer helper already supplies [package-managed guidance](https://github.com/xormania/uxor/blob/0.3.5/packages/uxor/README.md), use its
integration rather than duplicating this block. Component details belong in the recipe READMEs; use
[FOR-AGENTS.md](../FOR-AGENTS.md) and [application testing](APPLICATION-TESTING.md) as reference guides.

````markdown
## UI: UXor

This application uses UXor recipes from https://github.com/xormania/uxor.
Installed recipe revision: unknown (replace with a tag or full commit SHA only when the application's records establish it).
The helper package's version does not prove the origin of copied or customized recipe files.

- The application owns its copied templates, PHP classes, controllers and styles. Preserve local adaptations;
  review and reconcile the diff when reinstalling a recipe. Follow this application's workflow and permissions.
- Use the application's chosen tagged release for recipe installs. An explicitly requested unreleased test uses a
  full commit SHA; record that revision and the test results. Keep an unknown existing recipe revision explicit.
- Read the relevant recipe README and UXor's guide at the chosen revision when the task needs them.
  Prefer the installed components and their documented extension points before adding a parallel implementation.
- Keep UXor behavior in Stimulus controllers; do not load Flowbite JavaScript or call initFlowbite().
  Preserve Turbo and Live Component lifecycle behavior and use stable ids in re-rendered markup.
- Use UXor's semantic color roles, including on-fill text roles, and its documented CSS import order.
  Check light and dark themes when changing presentation.
- Preserve the recipes' accessibility, URL, escaping and rich-text sanitization contracts. Validate input and
  enforce authorization on the server; browser controls are not a security boundary.
- Avoid inline scripts, styles and event handlers so the components work with the application's CSP.
  Read each component's form, Turbo and Live Component requirements before integrating it.
- Verify the changed application behavior with its own tests and relevant browser checks. UXor's
  docs/APPLICATION-TESTING.md supplies integration examples; select checks for the components actually used.
````
