# Upgradeable components: Symfony integration and asset ownership

Research date: 2026-10-14. Status: recommendation; the APIs and commands proposed below are not implemented.
This extends the [component pilot plan](PLAN-upgradeable-components.md) and considers the supplied
`uxor-upgradeable-component-system-research-2026-10-14.md` and
`uxor-theme-proposal-and-context-2026-10-13.md` as design context. It also examines the
[upgrade/rollback checks in PR 139](https://github.com/xormania/uxor/pull/139) at
`f2e2360be79bf67fcbe4912662ec4e0685c01c39`; that work is separate from this research branch.

## Recommendation

Build a Symfony bundle that owns coordinated PHP, Twig, JavaScript and CSS. Use Flex for initial application
setup and its existing UX metadata synchronization, native TwigComponent rendering, and configured services
with autowired application adapters. Ship browser-ready JavaScript with the Composer package. Package genuinely
private JavaScript dependencies together with that code; keep shared framework runtimes as explicit peers.

The useful new abstraction is **a package contribution and compatibility contract**: which assets and styles
a module contributes, which shared dependencies it accepts, and which application interfaces it extends.
Start with existing Symfony UX metadata and add only missing fields. A second renderer, universal component
superclass, or general JavaScript dependency solver is not needed to prove this design.

Two gaps deserve focused implementation:

1. **Shared dependency validation before frontend changes.** Flex already updates imports, but its AssetMapper
   path does not reconcile every package's requirements together. Fix that at the synchronization boundary.
2. **Automatic stylesheet and Tailwind source discovery.** An installed module must be able to add a stylesheet
   or a class used only in its templates without a consumer editing its application CSS.

An AssetMapper entry-provider extension is worthwhile if package-owned import entries must stay out of the
application's writable map. Full browser import scopes are a larger, optional follow-up, driven by an actual
need for independent incompatible versions.

## Toolkit coupling and deterministic upgrades

Keep three identities separate: the exact Symfony UX Toolkit implementation, the canonical UXor recipe contents,
and the versioned Composer release generated from those contents. Use Toolkit's parser, recipe closure and
`copy-files` mappings through a small pinned adapter; preserve each dependency declaration and its owner before
solving compatibility. The upstream schema URL and `version-added` fields are not UXor release versions.

[PR 142](https://github.com/xormania/uxor/pull/142) implements the source-plan adapter and a real Flex consumer
against Toolkit 3.5.1. The author-build contract now adds actual `composer/semver` 3.5.1 to intersect recipe
Composer requirements and require each emitted direct range to be contained in that intersection. The builder
rederives the declarations from source manifests and validates the exact emitted `composer.json` before creating
output; its provenance records the contract report and manifest hash. Missing direct requirements, conflicts and
overly broad ranges fail with their owners identified. `provide`/`replace` are not substitutes for direct
requirements. Branch names remain opaque; aliases, explicit stability flags and source references are rejected
instead of being treated as plain version intervals.

Every `--plan` build invokes that check. No-plan smoke builds and the historical upgrade fixture do not validate
this author contract. The isolated Flex consumer exercises the actual transitive Composer solve; direct-range
validation does not solve the full graph. Frontend requirements remain recorded but unenforced, and a supported
release-transition matrix remains open.

Deterministic upgrades are the default goal: compatible package updates preserve application-owned source, and
breaking transitions declare their migration requirements. Agent-assisted edits are a fallback for app-specific
migrations when a deterministic transform is unavailable; the consumer's tests must validate those edits. An agent
should not be needed to interpret an ordinary compatible release. A separate repository remains an option if the
resulting compatibility or asset layer becomes reusable beyond UXor; extraction is not needed for this pilot.

## What the existing pilot proves

The pilot packages selected canonical recipe sources through `tools/build-package-pilot.mjs`. The upgrade checks
exercise version 0.0.1, a changed 0.0.2, and rollback in an independent consumer: PHP, Twig, controller behavior,
CSS, application branding and provider subclasses. This supports keeping maintained implementation in Composer
while preserving application-owned policy. It does not establish every installation or deployment guarantee.

At that revision, the consumer fixture does not require Flex and sets `allow-plugins` to false. Its import map,
controller configuration and vendor CSS imports are wired manually, and the package lacked the `symfony-ux`
Composer keyword. PR 142 adds that keyword and a real recipe-enabled consumer separately; the historical
upgrade checks do not prove that workflow or the planned-build Composer contract.

The current source fingerprint includes `importmap.php` and `assets/controllers.json`. A dependency-changing
upgrade needs a precise contract: business PHP, Twig, controllers and application CSS remain unchanged; declared
dependency records may change; existing controller enablement, loading and autoimport choices remain protected.
Document and assert allowed changes explicitly instead of dropping those files from verification without a replacement.

## Use Symfony's existing extension points

| Concern | Existing mechanism | UXor's responsibility |
|---|---|---|
| Initial installation | Flex recipe, bundle registration, configuration and Composer-script configurators | Install stable application entrypoints, example adapters and workflow hooks once; do not copy maintained implementation |
| Ongoing controller/import metadata | `assets/package.json` under a Composer package with the `symfony-ux` keyword | Declare controllers, autoimports and shared requirements through existing UX conventions |
| Package configuration | `AbstractBundle::configure()`, `loadExtension()` and `prependExtension()` | Validate options, register owned services and asset paths, configure Twig namespaces and defaults |
| Application policy and data | Interface aliases, autowiring, autoconfiguration tags and tagged service locators | Keep table providers and identity-store boundaries; introduce more interfaces where an actual application extension needs one |
| Component rendering | TwigComponent namespaces, anonymous/PHP components, props, slots, blocks, attributes and variants | Version the supported public component contract; reuse the current renderer |
| Forms | Symfony Form themes | Coordinate widget markup with component tokens and behavior without replacing the Form component |
| Asset transformations | `AssetCompilerInterface`, tagged `asset_mapper.compiler` | Generate or transform a stable mapped module if discovery needs it; keep resolution out of request-time compilation |
| Production output | Explicit preparation, Tailwind build, then `asset-map:compile` | Make preparation deterministic and validate the full result before publication |

Bundle services need explicit registration; consumer application adapters can be autowired and tagged. Avoid
making all container services public or adding inheritance solely to discover a component. The existing abstract
table provider and OAuth identity-store interface already express useful boundaries.

Lifecycle order matters. `prependExtension()` runs before extension configuration is loaded; compiler passes run
later. A compiler pass cannot discover providers and then retroactively prepend their asset paths. Each feature
bundle can register its own paths early, or an early declarative manifest reader can do so and add the manifests
as container file resources. Tagged services can subsequently build a read-only registry. Container compilation
should neither download dependencies nor rewrite application source.

`PreAssetsCompileEvent` is useful for production compilation but does not cover normal development requests.
StimulusBundle's concrete `UxPackageReader` and `ControllersMapGenerator` are internal classes; prefer metadata
and public configuration. If an adapter must use them, isolate it and test the supported Symfony versions.

## Flex already does more than scaffolding

Source inspection of Flex 2.11.0 confirms that ordinary Composer package updates do not reapply installed recipe
scaffolding; explicitly running `composer recipes:update` can apply recipe patches. Separately, Flex runs package
metadata synchronization during Composer updates, including updates with no new
recipe. With Flex active in the root project, synchronization enabled and an AssetMapper import map present:

- A newly declared import is passed to `importmap:require`.
- An existing remote version is retained if it satisfies the selected requirement; otherwise an update is requested.
- An existing local-path entry is skipped rather than assigned an inferred upstream version.
- Newly declared controllers are added. Existing enablement and fetch choices are retained; declared autoimports
  merge with previous choices. Controller declarations removed from installed packages disappear.
- Remote import entries whose package requirement disappeared are not automatically garbage-collected.

The problem is aggregation. `PackageJsonSynchronizer::synchronizeForAssetMapper()` assigns requirements to an
array keyed by import name while iterating installed packages. For duplicate names, the later requirement wins.
It then compares the application version with that one requirement.

### Reproduced conflict

The [isolated PHP probe](research/flex-importmap-conflict.php) runs the actual Flex synchronizer with a recording
script executor. Two packages require the same synthetic `shared-peer`; the root map selects version 1.5.0.

| Package iteration order | Requirements | Recorded action with Flex 2.11.0 |
|---|---|---|
| one, then two | one accepts `^1.0`; two accepts `^2.0` | Requests `importmap:require shared-peer@^2.0` |
| two, then one | The same two incompatible requirements | Requests no command; 1.5.0 satisfies the last requirement |

Neither order reports the incompatible set. This demonstrates order-dependent planning, not a downloaded upgrade:
the recording executor runs no console command and makes no network request. The fixture and its import map live
in a temporary directory and are removed after the probe. The application installation is only used to load Flex.

Run from the repository root with installed demo dependencies and a Composer PHAR:

```bash
php docs/research/flex-importmap-conflict.php demo/vendor/autoload.php /usr/local/bin/composer
```

The probe prints the installed Flex version and both command lists. The observation above was reproduced with
Flex 2.11.0, Composer 2.10.3 and PHP 8.5.11. It is a manual research probe, not a CI assertion that this defect must
continue to exist. A future corrected Flex can legitimately report a conflict instead.

### Put validation before the relevant write

A recipe can install a root validation/build script, but this alone cannot stop Flex's earlier import-map
updates. Composer plugin listeners run before the root script listeners at the same default priority. Flex's
post-update listener performs synchronization before those root scripts and recipe auto-scripts.

The cleanest fix is inside Flex: collect every owner and requirement, validate the complete proposed result,
then make frontend changes. A targeted Composer plugin with a higher event priority could instead preflight
the newly installed metadata before Flex. That adds a plugin installation/trust boundary and must cover both
install and update lifecycles. At post-update time, Composer has already changed vendor packages and its lock;
even a successful preflight guard is not an atomic rejection by Composer's dependency solver.

Keep a validation command in CI and before asset compilation as well. Its purpose is to prevent an invalid
build from being published, including when Composer scripts were skipped. Dependency packages' own Composer
scripts do not automatically run in the consuming application; recipes must configure root hooks explicitly.

## Ownership and dependency policy

| State | Owner | Upgrade behavior |
|---|---|---|
| Maintained PHP/Twig/controllers/CSS and private JS artifacts | Composer package | Replace together; version and roll back together |
| Business providers, composition, branding, theme choice, app controllers | Application | Preserve through package updates |
| Public props, slots, blocks, variants, events and semantic tokens | Package API, used by the application | Apply compatibility/versioning rules and test consumer examples |
| Shared remote selections in `importmap.php` | Application dependency record | Permit reviewed, compatible updates; distinguish selected version from allowed policy |
| `assets/controllers.json` | Package declarations plus application choices | Add/remove declarations while preserving existing application choices |
| Aggregated style source, compiled CSS, asset maps | Generated build output | Recreate deterministically from packages and app configuration |

A selected exact version is not a declaration that the application permits arbitrary upgrades. A richer peer
policy must record allowed ranges or explicit overrides. A local file's upstream version is unknown unless the
application supplies compatibility metadata. Report that uncertainty rather than treating a path override as
verified compatible. Removal also needs provenance: an import can be used directly by the application even when
no remaining package declares it. Do not delete such entries on assumption alone.

Keep genuinely private helpers inside the package: ship a closed tree of relative ESM files or prebundle them
when publishing. This lets a package add, change or remove a private helper without a consumer resolving it.
Maintainers own the build, licenses, audit and payload budget; consumers need not install Node solely for that
build. Symfony UX's own author build demonstrates this pattern by bundling idiomorph while externalizing its
declared dependencies and peers.

Stimulus, Turbo and PHP-coupled Live Component assets need one coordinated document runtime. Libraries whose
objects cross component/plugin boundaries can also require a shared identity. Import scopes do not isolate
global variables, CSS, DOM effects or registries. Make the private/shared decision from behavior, not library size.

Use `composer.lock` for shipped artifacts and the existing root import map for selected remote versions initially.
If byte-for-byte browser reproducibility is promised, capture content hashes and retain the resolved build
artifacts: an exact CDN package version alone does not prove that transformed response bytes never change.
A separate frontend lock is justified when it records missing provenance, graph or content information, rather
than merely repeating selected versions.

## CSS and themes need their own integration

Tailwind does not normally scan ignored vendor dependencies. The pilot explicitly imports package CSS and names
vendor source roots. That proves the current styles compile, but cannot discover a new module automatically.

Proposed addition: one deterministic generated CSS input with package stylesheet imports and Tailwind `@source`
roots for declared class-bearing sources: templates, controllers and any PHP variant maps. The recipe gives the application one stable import of that
generated file. Package metadata supplies contributions; a preparation command sorts them deterministically,
validates paths/order, and regenerates the file after additions and removals. It must declare how import order,
cascade layers, duplicate stylesheets and package-disabled controllers interact.

This is a filesystem input to Tailwind. AssetMapper logical names are not automatically resolvable CSS paths to
the Tailwind CLI. Preparation must run before Tailwind, then AssetMapper must compile the finished CSS. In
development, prepare on startup and after package metadata changes before starting/restarting the watcher.
SymfonyCasts TailwindBundle's asset compiler substitutes already-built CSS; it does not perform this discovery
or run the Tailwind build itself.

Source CSS preserves the application's utilities and semantic roles, with an explicit Tailwind compatibility
contract. Precompiled CSS is an alternative for isolated widgets, provided namespace, cascade and Preflight/reset
ownership are defined. Shipping a second global utility stylesheet with its own reset needs deliberate testing.

Retain the theme proposal's separation of **theme identity** and **light/dark mode**. Version semantic tokens
for colors, typography and radii; let the app select identity using its user/tenant/default policy. Runtime CSS
custom properties cover many tokens, but build-time breakpoints, new utilities and loading fonts have separate
requirements. Use Tailwind's static token output when JavaScript consumes otherwise-unused tokens, and check
alias resolution for nested theme scopes when choosing inline theme declarations.

Density and structure need documented variants, props and slots: current Button spacing contains literal
utilities, so a color-token switch alone cannot prove density support. The chart controller currently observes
the root `class` attribute; changing identity through another attribute will need a theme event or equivalent
adapter. Verify first paint and cleanup/reconnection through Turbo and Live updates. Isolate the existing Turbo
helper's access to internal navigation state behind its tested adapter.

Applications can use native bundle template overrides and inheritance for deeper customization, but overridden
blocks become application-owned code. An arbitrary full template fork cannot automatically receive every markup
fix. Supported slots/variants/tokens should cover normal customization, with the ownership tradeoff documented.
No theme catalog or picker names are selected by this research.

## Where extending AssetMapper is useful

AssetMapper 8.1.8's configuration reader accepts a flat map with `path`, `version`, `type`, `entrypoint` and
`package_specifier`. It also writes that application file. Its generator tracks dependencies by global import
name, the renderer emits an `imports` object, and remote storage derives filenames from package specifier/type
without version. Aliasing two versions or adding a `scopes` object in Twig does not fix those earlier identity
and storage constraints.

| Approach | Useful outcome | Cost and decision |
|---|---|---|
| Existing Flex + package-private ESM + aggregate peer validation | Coordinated upgrades through the current Symfony workflow | Recommended first implementation; root dependency records can change explicitly |
| Read-only package entry providers, separate from the writable root | Package-owned entries and provenance without copying them into app config | Small, useful upstream design if immutable root maps or managed ownership are requirements |
| Version-aware graph and browser scopes | Coexisting incompatible versions of independent libraries | Requires resolver, storage, compiler, dependency/preload graph, audit and renderer changes; prove a concrete need first |
| JSPM Generator as an optional resolver backend | Existing resolution, scopes, provider hooks and lock/reinstall machinery | Consider for the graph case instead of implementing all JavaScript resolution semantics in PHP |

The proposed provider seam should separate **effective read-only entries** from **writable application entries**.
Simply decorating `getEntries()` to merge generated entries risks `importmap:require` or `update` writing those
contributions into the application's map. Define precedence, conflict reporting, ownership, removal, cache
invalidation and missing-provider behavior before adding the interface. A narrow adapter can prototype it with
pinned-version tests; it is not an existing documented generic AssetMapper API.

The first upstream candidate is Flex's aggregate validation, including owner-aware diagnostics and application
policy. Use the supported npm range semantics deliberately; Composer's range grammar is not a complete substitute
for JavaScript resolution. The second candidate is AssetMapper's read/write separation for entry providers.
Neither requires a full scopes implementation. Rails engine import-map composition is a useful precedent for
contributed maps, but composition itself does not resolve incompatible requirements.

## Next implementation sequence and acceptance evidence

The immediate priority is the PHP/Symfony foundation. Use PHP unit and integration tests, container boot checks,
Twig rendering and Composer lifecycle fixtures while developing those contracts. The full browser matrix is not
the feedback loop for this phase. Add focused browser checks once a complete component uses the foundation,
then run the full regression suite before promoting the integration branch into `dev`. The feature's PHP
development CI profile and promotion procedure are tracked in [PR 141](https://github.com/xormania/uxor/pull/141).

1. **Build and verify the PHP integration.** Define bundle configuration and the minimal package-contribution
   metadata, register services and early asset paths, and prove app provider autowiring and Twig namespaces in a
   booted consumer container. Add the UX keyword, a minimal recipe and a real Flex consumer using the supported
   recipe test workflow. Check install/update/remove through Composer. Retain the simple no-plugin fixture as a
   separate packaging test. These are PHP/container/lifecycle checks; broad browser coverage is not a prerequisite.
2. **Prove shared frontend compatibility enforcement in PHP.** Reuse the two-package conflict case in both iteration orders.
   Prototype aggregate planning at the Flex boundary, with an explicit app pin/override policy. A conflict must
   identify all owners and fail before frontend dependency records change. Separately assert that build validation
   catches invalid state when installation scripts were skipped; describe the earlier Composer mutation boundary.
3. **Complete automatic assets and a component slice.** Prepare package styles automatically. Prove that a new
   component, controller, stylesheet and a utility used only in vendor templates work after update without editing
   application business source or CSS. Use generation/build assertions first, then targeted browser checks for
   actual controller behavior, computed styling of the vendor-only utility and preserved application overrides.
4. **Extend the existing upgrade/rollback scenario.** Add/change/remove a private helper; add/change a shared
   requirement; remove a module; exercise a local override with declared and unknown compatibility. Assert exactly
   which dependency records change, preserve app controller choices, avoid deleting app-used imports, verify one
   shared runtime, and restore the prior selections and package assets on rollback.
5. **Exercise an application and deployment in separate follow-on checks.** Migrate one real table/provider and
   two theme identities, testing light/dark independently. Add density coverage when its variants exist; test chart
   recoloring and Turbo/Live reconnection separately. Verify locked/offline builds from retained artifacts. Then
   keep an old Turbo tab open across a deployment and rollback; retain its hashed assets and require full navigation
   when the shared asset contract changes.

The browser needs one coherent effective import map before module execution. Later import maps cannot replace
already-resolved or previously mapped shared imports. Installation/rollback tests alone do not establish that
old tabs survive deployments. The existing tracked-importmap reload test is useful coverage to extend.

Keep the canonical-source/export approach: adding a Composer product does not automatically track upstream
changes to code copied from the UX Toolkit. Any optional source-export product should be generated and tested
from the same maintained source. Choose final package splits after these boundaries work, before moving every recipe.

## Evidence and primary references

Installed source examined: AssetMapper and FrameworkBundle 8.1.8, Flex 2.11.0, StimulusBundle/TwigComponent/
LiveComponent 3.5.1, SymfonyCasts TailwindBundle 1.0.0, Tailwind 4.3.3 and Composer semver 3.5.1. The Flex conflict
probe is executable evidence; the source-plan adapter, direct Composer contract and native Flex lifecycle now
have separate implementation checks. The proposed entry-provider API, style aggregation and shared frontend
compatibility enforcement remain unimplemented. The internal-source findings apply to these versions.

- [Symfony: creating UX bundles](https://symfony.com/doc/8.1/frontend/create_ux_bundle.html),
  [AssetMapper](https://symfony.com/doc/8.1/frontend/asset_mapper.html),
  [bundle extensions](https://symfony.com/doc/8.1/bundles/extension.html) and
  [autoconfigured tags](https://symfony.com/doc/8.1/service_container/tags.html#autoconfiguring-tags): native integration surfaces.
- [Bundle configuration](https://symfony.com/doc/8.1/bundles/configuration.html) and
  [reusable-bundle practices](https://symfony.com/doc/8.1/bundles/best_practices.html): configuration and explicit service registration.
- [Flex 2.11.0 synchronizer](https://github.com/symfony/flex/blob/v2.11.0/src/PackageJsonSynchronizer.php#L81-L193),
  [import/controller updates](https://github.com/symfony/flex/blob/v2.11.0/src/PackageJsonSynchronizer.php#L260-L405) and
  [Flex update lifecycle](https://github.com/symfony/flex/blob/v2.11.0/src/Flex.php#L494-L579): verified current behavior.
- [Composer 2.10.3 listener ordering](https://github.com/composer/composer/blob/2.10.3/src/Composer/EventDispatcher/EventDispatcher.php#L583-L595),
  [plugin priorities](https://getcomposer.org/doc/articles/plugins.md#event-handler),
  [root scripts](https://getcomposer.org/doc/articles/scripts.md) and
  [Flex recipe script configurator](https://github.com/symfony/recipes#composer-scripts-configurator): hook placement.
- AssetMapper 8.1.8 source:
  [config reader/writer](https://github.com/symfony/asset-mapper/blob/81047481894c6b074372b43c3e28ca9c882ef19e/ImportMap/ImportMapConfigReader.php),
  [generator](https://github.com/symfony/asset-mapper/blob/81047481894c6b074372b43c3e28ca9c882ef19e/ImportMap/ImportMapGenerator.php),
  [renderer](https://github.com/symfony/asset-mapper/blob/81047481894c6b074372b43c3e28ca9c882ef19e/ImportMap/ImportMapRenderer.php) and
  [remote storage](https://github.com/symfony/asset-mapper/blob/81047481894c6b074372b43c3e28ca9c882ef19e/ImportMap/RemotePackageStorage.php).
- [Stimulus controller generation](https://github.com/symfony/stimulus-bundle/blob/328b92cdf33a21267ee47904f8f5e330da356ce6/src/AssetMapper/ControllersMapGenerator.php),
  [Live Component package metadata](https://github.com/symfony/ux-live-component/blob/4570565b1199df6201d3edf5db5149e6c1afee80/assets/package.json) and
  [Symfony UX author build](https://github.com/symfony/ux/blob/3.x/bin/build_package.ts): shared contracts and private bundling
  (the author-build link is a moving branch inspected on the research date).
- [TwigComponent documentation](https://symfony.com/bundles/ux-twig-component/current/index.html),
  [bundle overrides](https://symfony.com/doc/current/bundles/override.html) and
  [Form themes](https://symfony.com/doc/current/form/form_themes.html): component extension and ownership.
- Tailwind: [source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files),
  [theme variables](https://tailwindcss.com/docs/theme), [Preflight](https://tailwindcss.com/docs/preflight), and
  [TailwindBundle's asset compiler](https://github.com/SymfonyCasts/tailwind-bundle/blob/9b0afba9144e5f8fbffe01282c054e835bedd0a0/src/AssetMapper/TailwindCssAssetCompiler.php).
  Tailwind's official documentation repository was inspected because direct website access was unavailable.
- MDN: [import scopes](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap#scoped_module_specifier_maps)
  and [merging import maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap#merging_multiple_import_maps).
- [JSPM Generator source](https://github.com/jspm/generator/blob/main/src/generator.ts) (`getLock`, `reinstall`, provider hooks;
  moving source inspected on the research date) and
  [Rails import-map composition](https://github.com/rails/importmap-rails#composing-import-maps): alternatives, not UXor dependencies.
