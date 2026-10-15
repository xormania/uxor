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
That initial slice also passed 219 Node tool tests and repository security, documentation and inventory checks.
Browser-computed styles and version-to-version upgrades were established by the subsequent upgrade slice below.

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

The Package pilot workflow runs the archive PHP/Symfony upgrade, rollback, production asset and fingerprint checks
on feature-branch pushes. Start it manually with `browsers` enabled (the manual default) to include the browser
sequence. Each run retains its own receipts and source/dependency records, plus failing traces when browsers ran;
push receipts explicitly record browser checks as unrun. The browser coverage remains available during PHP-first
feature development.

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
the bounded build used by development smoke checks and the separate upgrade/rollback fixture. The schema URL and upstream `version-added` metadata are separate from
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

The Toolkit/Flex fixture complements the upgrade/rollback fixture above and the
[abstraction research](RESEARCH-upgradeable-component-abstraction.md); each establishes a different boundary.
The *Kit PHP* job runs the Flex fixture as part of the PHP development profile. No additional service registry,
component superclass or configuration knobs are introduced without a concrete extension need. Automatic style
aggregation and shared-dependency conflict validation are the next separate implementation boundaries.

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

`tools/tests/package-toolkit-plan.php` checks actual Toolkit recipe closure, file mapping, raw requirement
provenance, content identity, inventory, repeatability and unsupported-version/missing-recipe failures.
`tools/tests/build-package-pilot.test.mjs` checks package name/controller mapping, canonical-source records,
plan freshness and destination validation, repeatability, and refusal of missing recipe/component dependencies.
`tools/tests/package-flex.sh` verifies native Symfony installation and ongoing Flex metadata synchronization.
`tools/tests/package-pilot.sh` performs isolated ZIP installation, consumer rendering and production asset checks,
with browser checks available through its explicit browser option.
The coordinated fixture upgrade, browser lifecycle and computed theme checks now have evidence. They do not establish
a supported version matrix, frontend dependency migrations, open-tab deployment behavior or theme accessibility across
all integrations. Existing kit checks also cover the sorting improvement in the recipe distribution.
