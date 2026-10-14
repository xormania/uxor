---
status: open
recipes: none
---

# Plan: upgradeable components and application themes

Status: experiment started. Branch: `feat/upgradeable-components`, from `dev` at `40d957c`.

The goal is coordinated updates to reusable PHP, Twig, JavaScript and styles while applications retain their
data access, workflows, branding and supported customizations. The current recipe kit must continue to work.

The October 14 component-system research and October 13 theme proposal inform this experiment. Their proposed
package names, theme designs and selection features are research, not approved project policy. The theme proposal
assumed source-copy delivery; this experiment tests maintained package defaults with app-owned branding overrides.
Theme identity and light/dark mode are separate concerns. No theme catalogue or runtime picker is promised here.

## First slice

- Assemble a real package archive from the canonical data-table recipes and the existing theme. Keep one source
  implementation rather than maintaining kit and bundle copies by hand.
- Give package PHP, nested Twig references and Stimulus attributes their own names; retain the current behavior.
- Install the ZIP into an independent Symfony consumer without recipe directories or demo service wiring.
- Exercise app-owned row loading, cell blocks and actions, unrelated query state, and a local component-name collision.
- Compile vendor templates and package assets through the real production pipeline. Preserve app-owned light/dark
  brand color, typography and shape overrides in emitted CSS.

The first slice is a packaging feasibility check. Generated namespace transformations are deliberately bounded
and validated; they are not a consumer migration tool. The experimental package is excluded from the kit archive.

### First slice result

The isolated ZIP consumer passes four request scenarios on PHP 8.5, with FrameworkBundle/AssetMapper 8.1.8,
TwigBundle 8.1.7, Twig 3.30.0 and Symfony UX 3.5.1. Its custom cells and action links, escaping, forwarded attributes,
query state, sorting, search and pagination work without recipe directories or the demo's installed dependencies.
Tailwind 4.3.3 and AssetMapper compile 19 assets, including vendor classes, the controller/helper and app-owned
light/dark brand values, typography and radius. The package's icon prefix is separate from application icon sets.
The 219 Node tool tests and repository security, documentation and inventory checks pass. Browser-computed styles
and version-to-version upgrades remain unverified.

## Theme boundary to prove next

The existing theme supplies semantic colors, fonts, radii and native control mode behavior. The fixture imports
those defaults before its own overrides and explicitly scans vendor templates. Emitted CSS is necessary evidence;
computed styles and component states still need browser checks.

The next theme checks must cover light/dark values, font/radius precedence, focus and invalid states. Add two
contrasting fixture identities to expose gaps before choosing supplied product themes. Keep density and layout
changes separate until their actual controls have been inventoried. Future runtime preset selection also needs
first paint, Turbo/Live restoration and chart repaint; the current chart observer watches `class`, not a new attribute.

## Remaining milestones

1. Two installable releases, N and N+1, with a meaningful shared change across PHP, Twig, JavaScript and styling.
2. Upgrade the same consumer with unchanged business source, templates and custom controllers. Preserve customizations
   and prove they receive the shared improvement; dependency records and generated assets may change.
3. Browser checks for keyboard behavior, Turbo history, reconnection and cleanup, plus computed theme values.
4. Test frontend dependency additions, changed requirements and incompatible existing importmap pins.
5. Measure migration against an actual customized application. No real consumer inventory has been supplied yet;
   the current fixture represents common changes, not measured downstream adoption.
6. Decide canonical source location and package splits after the pilot. Editor/form integration follows the table;
   OAuth policy and credential integration need their own scenarios.

A compatible release promises the documented extension contract, not every DOM wrapper or utility class. Define
which appearance changes are allowed in patches/minors before claiming stable releases. Full template/controller
forks remain application-owned. Ordinary dependency updates must not routinely replace consumer source files.

## Coverage and limits

`tools/tests/build-package-pilot.test.mjs` checks package name mapping, controller mapping, canonical-source records,
refusal to overwrite outputs, and refusal of missing recipe/component dependencies.
`tools/tests/package-pilot.sh` performs isolated ZIP installation, consumer rendering and production asset checks.
These checks do not establish a supported version matrix, browser interaction, an N-to-N+1 upgrade, or theme
accessibility across all integrations. Existing kit checks continue to cover the unchanged recipe implementation.
