# Packaged component experiment

This is an unpublished distribution experiment on `feat/upgradeable-components`, not a new installation target
or a supported alternative to the kit. See [the experiment plan](../../docs/PLAN-upgradeable-components.md).

The first slice packages the existing data table and its primitives. Recipe files remain the canonical
implementation. The author build resolves the `data-table` and `theme` roots with Symfony UX Toolkit 3.5.1,
then packages Toolkit's transitive recipe closure and `copy-files` mappings. Generated copies are build output
and must not be maintained by hand. Package namespace and controller transformations remain deliberately bounded.

```bash
php tools/package-toolkit-plan.php demo/vendor/autoload.php . /tmp/uxor-toolkit-plan.json
node tools/build-package-pilot.mjs /tmp/uxor-package --plan /tmp/uxor-toolkit-plan.json
```

Both output paths must be new. The adapter isolates Toolkit's internal API and rejects untested Toolkit versions.
The plan records the exact Toolkit version/reference, selected source content identity, recipe manifests, file
mappings and every original dependency declaration with its owner. Recipe directory inventories and file hashes
reject stale plans before assembly. Every `--plan` build rederives dependency declarations from those manifests
and runs the PHP Composer contract check before creating the output directory. It uses the actual pinned
`composer/semver` 3.5.1 through `demo/vendor/autoload.php`; set `PILOT_COMPOSER_AUTOLOAD` for another installation
with that version, and `PHP` for another PHP executable. `pilot-build.json` embeds the plan, source/output hashes,
and the Composer contract report tied to the exact emitted manifest hash.

A build without `--plan` uses the original bounded selection for Node smoke tests and the separate historical
upgrade/rollback fixture. It does not validate the Composer contract and is not the author path. The Flex fixture
tests the Toolkit-derived, validated author path in CI.

These records distinguish the Toolkit implementation, UXor recipe contents and generated package contents. The
manifest schema URL and upstream `version-added` fields do not define UXor release compatibility. For each recipe
Composer dependency, the author build requires a direct entry in the emitted `composer.json`, a nonempty
intersection of the owners' requirements, and an emitted range contained within that intersection. Missing,
conflicting or overly broad requirements fail with owner-aware diagnostics. `provide` and `replace` do not
substitute for these direct requirements. Development branches remain opaque branch constraints; inline aliases,
explicit stability flags and source-reference suffixes are rejected by this bounded check.

This validates direct declared ranges, not the full dependency graph: the isolated Flex consumer still exercises
Composer's transitive solve. Frontend requirements are recorded but not enforced. Published release identity,
supported upgrade transitions and migration rules remain follow-up work.

The archive has its own PHP namespace (`UXor\Pilot\DataTable`), bundle (`UXor\Pilot\UXorBundle`), Twig component
namespace (`UXor:*`), icon prefix (`uxor-pilot:`) and controller identifier (`xormania--uxor-pilot--data-table`).
The package's small icon set does not replace an application's `flowbite:` set. These are experimental names.
The only declared runtime baseline is PHP 8.4+ with Symfony 8.1 and UX 3.5. Local checks use PHP 8.5; CI uses PHP 8.4.

The package declares the `symfony-ux` keyword so Flex reads its controller and import metadata. Its separate
[`recipe/manifest.json`](recipe/manifest.json) registers `UXor\Pilot\UXorBundle`; that explicit name preserves the
`UXor:*` component namespace. Flex's fallback bundle discovery does not infer this class name from `UXor\Pilot\`.
The recipe only registers the bundle. It copies no component, template, provider or other maintained implementation
into the application. The recipe source is excluded from Composer distribution archives and is not published yet.

The bundle registers its mapped asset path and icon set through Symfony's normal extension configuration.
TwigComponent resolves its anonymous components through the bundle's template namespace. Application tables and
data sources are ordinary application services: Symfony autowires them into the app's controller; the package
does not need a second service registry or a universal component base class.

CSS setup remains explicit in this slice: import Flowbite's stylesheet followed by the packaged theme, and make
Tailwind scan the installed package's templates. Flowbite's JavaScript runtime is not imported. Automatic stylesheet
aggregation and validation of conflicting shared frontend requirements remain separate follow-up work.

## Experimental extension contract

- An app extends `AbstractDataTable` and implements `columns()`, `countRows()` and `loadRows()`; existing optional
  methods keep their recipe behavior. Queries, authorization and business actions belong to the app.
- Register the concrete table and its application-owned collaborators as autowired services. An application can
  bind its own data-source interface to its chosen implementation without package container internals or tags.
- `UXor:DataTable` accepts `table`, a unique `id`, an optional accessible `label`, and forwarded HTML attributes.
- `cell_<column key>` blocks receive the current `row`. Their rendered, escaped output is reused by the table;
  callers remain responsible for any trusted HTML they explicitly introduce.
- The app uses public slots and primitives for composition. Nested package components are namespaced so an app's
  `Button` does not replace the table's button accidentally.
- The package provides the current theme defaults. App-owned CSS overrides follow them. The fixture exercises
  brand color in light/dark modes, font family and base radius. Density, layout structure, named presets and
  runtime preset selection are not established by this slice.

## Validation

Run the builder and release-export checks from the repository root:

```bash
node --test tools/tests/build-package-pilot.test.mjs tools/tests/package-pilot-releases.test.mjs
```

With the installed Toolkit and pinned Composer semver library, run the PHP and author-build integration checks:

```bash
php tools/tests/package-toolkit-plan.php demo/vendor/autoload.php .
php tools/tests/package-composer-contract.php demo/vendor/autoload.php
PILOT_COMPOSER_AUTOLOAD=demo/vendor/autoload.php node --test tools/tests/package-composer-build.mjs
```

The final suite explicitly requires PHP and runs in *Kit PHP*, outside the Node-only test glob. The contract CLI
is `php tools/package-composer-contract.php AUTOLOAD`, with its JSON input read from standard input; normal author
builds invoke it automatically.

The native Symfony/Flex fixture uses PHP 8.4+, Composer, Node 22, Python 3 and the OpenSSL CLI:

```bash
PILOT_TOOLKIT_PLAN=/tmp/uxor-toolkit-plan.json bash tools/tests/package-flex.sh
```

It installs the real Flex plugin and the package ZIP into an isolated application, using a temporary loopback
HTTPS recipe endpoint. The prepared Twig/Tailwind application starts with its existing Tailwind bridge registered,
and no UXor bundle or controller registration. A real kernel then renders
the package through an autowired controller, table and application data-source implementation. Composer lifecycle
checks cover metadata updates, preserved application choices, removal and reinstallation. This fixture is also
part of the *Kit PHP* CI job, using a freshly generated Toolkit plan. Set `PILOT_TOOLKIT_PLAN` to a generated plan
when running that same author path locally; no browser or CSS compiler is required.

To use the prepared cloud PHP image instead of host PHP/Composer:

```bash
PILOT_TOOLKIT_PLAN=/tmp/uxor-toolkit-plan.json \
PILOT_IMAGE=uxor-cloud-php:c271b1f78c7b bash tools/tests/package-flex.sh
```

With a plan and an image, the author build runs inside that image using the author installation's autoloader.
The subsequent consumer receives only its fixtures and archives, not the author checkout or installed vendor tree.

The recipe endpoint is local test infrastructure, not a public installation service. Synthetic fixture versions
exercise Flex's metadata lifecycle; they do not establish released component compatibility or frontend conflict
resolution. App code that references package classes still depends on the package after recipe removal.

For the independent consumer, supply a development image with PHP, Composer, Node, Python, and Tailwind 4.3.3:

```bash
PILOT_IMAGE=uxor-cloud-php:c271b1f78c7b \
PILOT_BROWSER_CONTAINER=uxor-cloud-browser-1 \
bash tools/tests/package-pilot.sh
```

That image tag refers to the prepared local cloud toolchain; other hosts must supply their own suitable image.
An existing trusted Composer download cache can be supplied with `PILOT_COMPOSER_CACHE_DIR`; this reuses archives,
not another application's installed vendor tree. Download trust verification and dist-only installation remain enabled.
The test container defaults to your user and group IDs. Set `PUID` and `PGID` when the Docker daemon sees mounted
files under different IDs, such as when the invoking shell uses a separate user namespace.
The test creates two ZIP distributions, uses Composer's dist installation, and mounts distributions, the consumer
fixture, reports and an optional archive cache. Neither the checkout nor `demo/vendor` is available. The fixture tests custom
data loading, cell markup and app actions, attribute forwarding, component-name collisions, escaping, sorting,
search, pagination, preserved URL state, and a production Tailwind/AssetMapper build.

The baseline 0.0.1 is assembled from the immutable first-pilot commit in `releases.json`; 0.0.2 uses current canonical
sources. The consumer installs 0.0.1, updates to 0.0.2 and rolls back using normal Composer resolution. It fingerprints
its PHP, templates, CSS sources, controllers, manifest and importmap before/after each phase, and checks that unrelated
dependency versions and references remain unchanged. CSS builds write generated files without replacing app-owned CSS.

The compatible change adds `DataTableView::sortLabel()`, next-direction labels, sort-focus restoration and a branded
keyboard-focus outline using the existing focus-color role. Both visual identities and color modes, sorting, no focus theft
during delayed responses or paused renders, Turbo history and repeated
visits run in Chromium at every phase. `PILOT_BROWSER_CONTAINER` shares the selected browser server's network only;
no checkout files are made available to the consumer. Its server must speak Playwright 1.58.2 on port 3000, or set
`PILOT_BROWSER_WS` to its endpoint. Without the browser setting, browser checks are explicitly reported as unrun.
The upgraded outline is also measured against the default header background in both modes, with a 3:1 minimum.

Each run writes a fresh `test-results/package-pilot.*` directory with an upgrade receipt, source/dependency records,
browser reports and failing traces. The dedicated Package pilot workflow runs the PHP, production asset and fingerprint checks on feature-branch
pushes using the pinned published toolchain. Its manual `browsers` option adds the project's pinned browser image
and Chromium sequence; browsers remain unrun on pushes. These are local fixture releases; no packages
have been published. Broader runtime support, actual consumer migration and live deployments with old tabs remain unverified.
