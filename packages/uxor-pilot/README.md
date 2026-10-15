# Packaged component experiment

This is an unpublished distribution experiment on `feat/upgradeable-components`, not a new installation target
or a supported alternative to the kit. See [the experiment plan](../../docs/PLAN-upgradeable-components.md).

The first slice packages the existing data table and its primitives. Recipe files remain the canonical
implementation. `node tools/build-package-pilot.mjs NEW_OUTPUT_DIRECTORY` assembles PHP, Twig, controller code,
theme CSS, the required locked Flowbite icons, and license notices with this package's metadata. Generated copies
are build output and must not be maintained by hand. The builder checks recipe dependencies and explicitly maps
the selected component names and table controller attributes; it is not a general migration tool.

The archive has its own PHP namespace (`UXor\Pilot\DataTable`), bundle (`UXor\Pilot\UXorBundle`), Twig component
namespace (`UXor:*`), icon prefix (`uxor-pilot:`) and controller identifier (`xormania--uxor-pilot--data-table`).
The package's small icon set does not replace an application's `flowbite:` set. These are experimental names.
The only declared runtime baseline is PHP 8.4+ with Symfony 8.1 and UX 3.5. Testing currently uses PHP 8.5.

The consumer registers the bundle and its declared dependencies, enables the package controller in
`assets/controllers.json`, installs its pinned importmap entries, and imports Flowbite's stylesheet followed by
the packaged theme CSS. Flowbite's JavaScript runtime is not imported. Tailwind
must scan the installed package's templates. These setup steps are explicit; no Flex recipe or automatic
application rewrites are implemented.

## Experimental extension contract

- An app extends `AbstractDataTable` and implements `columns()`, `countRows()` and `loadRows()`; existing optional
  methods keep their recipe behavior. Queries, authorization and business actions belong to the app.
- `UXor:DataTable` accepts `table`, a unique `id`, an optional accessible `label`, and forwarded HTML attributes.
- `cell_<column key>` blocks receive the current `row`. Their rendered, escaped output is reused by the table;
  callers remain responsible for any trusted HTML they explicitly introduce.
- The app uses public slots and primitives for composition. Nested package components are namespaced so an app's
  `Button` does not replace the table's button accidentally.
- The package provides the current theme defaults. App-owned CSS overrides follow them. The fixture exercises
  brand color in light/dark modes, font family and base radius. Density, layout structure, named presets and
  runtime preset selection are not established by this slice.

## Validation

Run `node --test tools/tests/build-package-pilot.test.mjs tools/tests/package-pilot-releases.test.mjs` from the repository root.

For the independent consumer, supply a development image with PHP, Composer, Node, Python, and Tailwind 4.3.3:

```bash
PILOT_IMAGE=uxor-cloud-php:c271b1f78c7b \
PILOT_BROWSER_CONTAINER=uxor-cloud-php-1 \
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
browser reports and failing traces. The dedicated Package pilot workflow runs this on feature-branch pushes using
the pinned published toolchain and the project's pinned browser image. These are local fixture releases; no packages
have been published. Broader runtime support, actual consumer migration and live deployments with old tabs remain unverified.
