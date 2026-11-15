# Runtime recovery fixture

This unpublished package recovers native delivery machinery onto current development source.
Its package, PHP and controller names remain experimental. It is excluded from the published
root package archive. See [the recovery record](../../docs/MACHINERY-RECOVERY.md).

The builder selects the existing table and theme recipes and their dependency closure.
Recipes remain canonical; generated PHP, Twig and browser files are not maintained by hand.

## Author build

Install the demo's locked dependencies, then run:

```bash
php tools/package-toolkit-plan.php demo/vendor/autoload.php . /tmp/uxor-toolkit-plan.json
node tools/build-package-pilot.mjs /tmp/uxor-package --plan /tmp/uxor-toolkit-plan.json
```

Both output paths must be new. The adapter accepts the demo's locked Toolkit 3.7.0 API.
It records membership, source hashes, file mappings and dependency declaration owners.
The builder rejects stale inputs and conflicting destinations before creating output.
The author path validates emitted requirements with Composer semver 3.5.1. Set
`PILOT_COMPOSER_AUTOLOAD` for another installed autoloader and `PHP` for another executable.
Runtime consumers need neither Toolkit nor Node. A build without `--plan` is a bounded
Node smoke check; it does not validate the Composer contract.

## Native integration

The fixture provides a Symfony bundle, namespaced Twig Components, mapped assets, icons
and normal Symfony UX controller/import metadata. Its separate Flex recipe registers the
explicit bundle class without copying implementation. Applications extend the table and
inject their own data source with ordinary service autowiring.

```bash
PILOT_TOOLKIT_PLAN=/tmp/uxor-toolkit-plan.json bash tools/tests/package-flex.sh
```

This needs PHP 8.4+, Composer, Node, Python and OpenSSL. `PILOT_IMAGE` selects an optional
container with those tools. The isolated consumer receives fixtures and archives only.
Synthetic versions test metadata updates, not released component improvements.

Flex is refreshed to 2.12. Its removal behavior can delete an import still used by the
application. The fixture retains the application-import preservation assertion: failure
is an open ownership issue, not permission to weaken that guarantee.

## Checks

```bash
node --test tools/tests/build-package-pilot.test.mjs
php tools/tests/package-toolkit-plan.php demo/vendor/autoload.php .
php tools/tests/package-composer-contract.php demo/vendor/autoload.php
PILOT_COMPOSER_AUTOLOAD=demo/vendor/autoload.php node --test tools/tests/package-composer-build.mjs
php tools/tests/frontend-npm-ranges.php
php tools/tests/frontend-contract.php
php tools/tests/frontend-reader.php demo/vendor/autoload.php
npm ci --prefix tools/tests/fixtures/npm-semver --ignore-scripts --no-audit --no-fund
node tools/tests/frontend-npm-oracle.mjs
```

The bundle exposes `uxor:assets:validate`, including `--json`, and runs the same guard before
AssetMapper compilation. It checks selected dependencies and ownership; it neither solves
npm dependencies nor undoes Composer/Flex mutations. The range parser supports its tested
stable subset, checked against pinned npm semver in development tests.

The recovered validator still reads the filesystem. Snapshot separation, automatic styles,
themes, production tooling isolation and a published runtime identity remain subsequent
work. The historical browser upgrade fixture is not copied here: it depends on a specific
PHP/Twig/JS/CSS improvement absent from the current baseline.
