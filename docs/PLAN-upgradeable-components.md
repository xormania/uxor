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

## Deterministic upgrade direction

Deterministic upgrades are the default goal. Each generated UXor release should identify its canonical recipe
contents, the Toolkit implementation used to interpret them, its package contents and supported runtime ranges.
Compatible upgrades should use Composer and documented extension points without rewriting application source.
Breaking changes need explicit version transitions and checks; an agent can assist with application-specific
migration when a deterministic transform is not available, with the consumer's tests validating the proposed edit.
Agent interpretation must not become a requirement for ordinary compatible updates.

The first implementation of that boundary is `tools/package-toolkit-plan.php`. It uses the real Toolkit 3.5.1
parser, recipe discovery and file mapping, selecting `data-table` and `theme` explicitly and deriving their
transitive closure. Toolkit's internal API is isolated behind an exact-version check. The deterministic JSON plan
records Toolkit version/reference, recipe/manifests, mapped source hashes and every original requirement with its
owner. It preserves conflicting declarations instead of using Toolkit Pool's range-string winner selection.
Selected recipe inventories catch added/deleted files and reject symlinks; selected content hashes catch edits.

The package builder consumes that plan in CI and records source/output hashes, including its package overlay.
Copy mappings are honored; unsupported destinations and collisions stop assembly. The no-plan Node path remains
only a bounded development smoke check. The schema URL and upstream `version-added` metadata are separate from
UXor release identity. These records establish reproducible source selection, not a supported upgrade matrix:
Composer-range intersection, shared importmap conflict checks and release-to-release migration declarations still
need implementation. Composer installs use the consumer lock after the initial solve; test downloads are not a
pinned upstream ecosystem snapshot.

## Native Symfony installation

The PHP foundation uses the existing bundle, TwigComponent renderer and application service container. The
package now declares `symfony-ux`, and its separate recipe explicitly registers `UXor\Pilot\UXorBundle`; Flex's
fallback naming cannot infer that class from the package namespace. The recipe copies no implementation or
application provider. Mapped assets and icons remain registered by the bundle's existing prepend hook.

`tools/tests/package-flex.sh` exercises real Composer/Flex operations against distribution archives and a local
recipe endpoint. A prepared Twig/Tailwind application's controller receives its table through autowiring, and the table receives
an application-owned data-source interface. PHP requests verify namespaced Twig components and container wiring.
Lifecycle checks verify metadata synchronization, preserved application choices, removal and reinstallation.
The application's existing Tailwind bridge registration remains app-owned. Synthetic fixture versions exercise
metadata discovery; they are not released component versions.

This work is independent of the browser upgrade slice in PR 139 and the broader abstraction research in PR 140.
The *Kit PHP* job runs the Flex fixture as part of the PHP development profile. No additional service registry,
component superclass or configuration knobs are introduced without a concrete extension need. Automatic style
aggregation and shared-dependency conflict validation are the next separate implementation boundaries.

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

`tools/tests/package-toolkit-plan.php` checks actual Toolkit recipe closure, file mapping, raw requirement
provenance, content identity, inventory, repeatability and unsupported-version/missing-recipe failures.
`tools/tests/build-package-pilot.test.mjs` checks package name/controller mapping, canonical-source records,
plan freshness and destination validation, repeatability, and refusal of missing recipe/component dependencies.
`tools/tests/package-pilot.sh` performs isolated ZIP installation, consumer rendering and production asset checks.
These checks do not establish a supported version matrix, browser interaction, an N-to-N+1 upgrade, or theme
accessibility across all integrations. Existing kit checks continue to cover the unchanged recipe implementation.
