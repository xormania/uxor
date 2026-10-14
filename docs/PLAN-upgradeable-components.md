---
status: open
recipes: none
---

# Plan: upgradeable components and application themes

Status: experiment started. Branch: `feat/upgradeable-components`, from `dev` at `40d957c`.

Individual feature increments use sibling work branches and pull requests into `feat/upgradeable-components`.
The owner requested this PR target; the repository's normal `dev` target does not apply to these increments.

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

### Upgrade slice result

The baseline archive is assembled from immutable commit `813b5c2c39f06c20a8f05ac45fc8a42fcea5f644` as 0.0.1;
the current recipes produce 0.0.2. A real improvement spans PHP (`sortLabel()`), Twig (next-direction labels and
sort targets), JavaScript (focus restoration after frame replacement) and CSS (a brand-colored focus outline).
The same independent consumer installs, upgrades and rolls back without source edits or unrelated dependency changes.
Source fingerprints include its business PHP, templates, source CSS, controllers, manifest and importmap. Generated
assets and selected lock records are separate. Source CSS is preserved throughout every production build.

Six Chromium scenarios execute at each phase, 18 checks with no skipped cases: computed color/font/radius values
in two app-owned identities and both modes; labels, keyboard focus and custom cells; no focus theft during a delayed
response or a paused render; pagination/search history plus repeated visits and controller cleanup; and default-theme focus contrast
of at least 3:1 in the upgraded release. The unchanged baseline shows
the missing sorting improvement, the upgrade gains it and rollback restores the baseline. This is a fixture proof,
not a published-release compatibility promise or an audit of every possible customization.

The Package pilot workflow runs the complete archive and browser sequence on feature-branch pushes and retains
run-specific receipts, source/dependency records and failing traces. Existing kit behavior suites remain in CI.

## Theme boundary to prove next

The existing theme supplies semantic colors, fonts, radii and native control mode behavior. The fixture imports
those defaults before its own overrides and explicitly scans vendor templates. The current slice checks both
emitted CSS and browser-computed overrides; wider component-state checks remain open.

Light/dark values, font/radius precedence and focus are now checked with two contrasting fixture identities.
Invalid-control states and wider integration coverage remain open before choosing supplied product themes. Keep density and layout
changes separate until their actual controls have been inventoried. Future runtime preset selection also needs
first paint, Turbo/Live restoration and chart repaint; the current chart observer watches `class`, not a new attribute.

## Remaining milestones

1. Test frontend dependency additions, changed requirements and incompatible existing importmap pins.
2. Measure migration against an actual customized application. No real consumer inventory has been supplied yet;
   the current fixture represents common changes, not measured downstream adoption.
3. Decide canonical source location and package splits after the pilot. Editor/form integration follows the table;
   OAuth policy and credential integration need their own scenarios.

A compatible release promises the documented extension contract, not every DOM wrapper or utility class. Define
which appearance changes are allowed in patches/minors before claiming stable releases. Full template/controller
forks remain application-owned. Ordinary dependency updates must not routinely replace consumer source files.

## Coverage and limits

`tools/tests/build-package-pilot.test.mjs` checks package name mapping, controller mapping, canonical-source records,
refusal to overwrite outputs, and refusal of missing recipe/component dependencies.
`tools/tests/package-pilot.sh` performs isolated ZIP installation, consumer rendering and production asset checks.
The coordinated fixture upgrade, browser lifecycle and computed theme checks now have evidence. They do not establish
a supported version matrix, frontend dependency migrations, open-tab deployment behavior or theme accessibility across
all integrations. Existing kit checks also cover the sorting improvement in the recipe distribution.
