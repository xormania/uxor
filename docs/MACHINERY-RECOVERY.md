# Reusable UX machinery: recovery record

Date: 2026-11-10. Status: implementation in progress; experimental package only.

## Baseline and recovered source

Development baseline: `89e607a4be48b2fd8f46f1b9e9465cba406fedee`.
Source experiment: `bb69211abe1e998fbc7272a569ce1633ac4c118a` on
`feat/upgradeable-components`. This slice recovers mechanisms before changing their public
identity or combining them with the currently published development tools.

| Mechanism | Recovered files | Disposition |
| --- | --- | --- |
| Canonical recipe assembly | `tools/build-package-pilot.mjs` and builder tests | Reused; generated output carries namespace transformations |
| Toolkit source selection | `tools/package-toolkit-plan.php` and tests | Adapted to the current demo's locked Toolkit 3.7.0 |
| Composer direct requirements | `tools/package-composer-contract.php` and tests | Reused against Composer semver 3.5.1 |
| Native registration | `packages/uxor-pilot/` | Experimental identity, explicit bundle recipe and build guard |
| Archive/Flex integration | `tools/tests/fixtures/package-flex/`, `tools/tests/package-flex.sh` | Recovered; Flex refreshed from 2.11 to 2.12 |
| Frontend policy/readers | `tools/tests/frontend-*` | Recovered before separating filesystem observations from policy |

The original broad CI profile, old archive exclusions, historical plan claims and table
focus feature are not part of this recovery. The published root Composer manifest stays
intact. Only the experimental package directory is excluded from the current distribution;
the builder reads it to create isolated fixture archives.

## Version reconciliation

The current demo lock selects Toolkit 3.7.0 at
`9b4cf5b2658ff32f3517b16f3a70f789a0d81387`. Source inspection confirms the adapter's
KitFactory/KitSynchronizer/RecipeSynchronizer constructors, recipe discovery and file
mapping API. Recipe file discovery now caches its result; the adapter creates fresh objects
per run. Actual API tests establish the adapted pin instead of assuming later versions work.

Flex 2.12 can remove an import when no remaining package declares it even if application
code still uses it. The recovered fixture retains its preservation assertion. A failure
is an unresolved ownership boundary, not proof that the application must stop using it.

## Verification and open work

The recovered Node builder cases run through the existing Tool tests glob. Native commands
are in [the package recovery README](../packages/uxor-pilot/README.md). Exact execution
results belong to the draft PR. Recovery does not establish full runtime delivery,
production dependency isolation, browser lifecycle or catalog-wide compatibility.

The existing Kit PHP job runs authoring, range, ownership and installed-reader checks using
the demo's installed libraries. Its npm oracle has an independent audit lane and weekly
updates. The separate native Flex lifecycle is not added as a passing CI requirement while
the application-import removal guarantee remains unresolved.

Synthetic metadata updates exercise actual archives, Flex and an isolated recipe endpoint.
They do not replace the later requirement for an observable component improvement across
PHP, Twig, JavaScript and CSS with unchanged application source.

Next: separate environment observations from compatibility policy; aggregate styles and
source roots; establish native runtime publication and tooling isolation; add themes,
table request separation, consumer upgrades and catalog adoption.

## Dialog quality profile dependency

The November 10 dialog research identifies the older quality profile's development pin
`56f3d967e50ad7200c3c19fe4dc05bfda5e29217` and its Toolkit-copied delivery assumptions.
The next revision needs the current baseline above and must label QD-16/RQ-10 evidence as
Toolkit-copied recipes or archive-installed runtime. One does not establish the other.

V1–V8 remain pending: Live re-render retention, Turbo morph interactivity, removing the
open attribute, consecutive Escape handling, nested close watchers, missing-invoker focus,
axe target-size selection and NVDA pending announcements. Findings and proposals are not
executed browser proof. This recovery changes no modal behavior or dismissal policy.
