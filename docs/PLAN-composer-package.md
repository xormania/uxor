---
status: open
recipes: none
---

# Plan: the Composer package `xormania/uxor`

_2026-10-18. Selected by the owner on 2026-10-16: UXor is one project in one repository; the agent guidance and
development tools kept until now in a companion Composer package (`xormania/uxorscient`) move into this repository,
under `packages/uxor/`; the companion's name is dropped as an active product name. The root `composer.json` (the
package `xormania/uxor`, with its code in `packages/uxor/`), the identity (decision 1) and the one version sequence
(decision 5) are the proposals of the owner's direction document (*Inputs*, below), adopted here. The kit's recipes
still install with `ux:install` as copies the application owns: the package adds agent guidance and development tools,
not a runtime library of components. The work goes through the work order `claude/wo-composer-package` (CONTRIBUTING,
*Work orders*)._

_Inputs, on the branch `docs/mono-audit-2026-10-16`: the owner's direction,
`docs/mono/inputs/uxor-single-repository-plan-2026-10-16.md`; the audit and its change register,
`docs/mono/uxor-repository-audit-and-change-inventory-2026-10-16.md`, with its area reports
`docs/mono/03-package-import-and-distribution.md` (import, identity, archive), `docs/mono/05-ci-workflows-and-releases.md`
(CI and releases) and `docs/mono/07-configuration-and-development.md` (roots and development paths). The audit read
UXor at `40d957c` and the companion at `614aa28`._

## Decisions

1. **Identity.** Composer package `xormania/uxor`, PHP namespace `Xormania\UXor\`, executable `vendor/bin/uxor`,
   Mate tool prefix `uxor_`, resource URIs `uxor://`. UXor is the only name in current docs, commands and metadata;
   the former name stays in history and migration notes only. No Composer `replace` or alias for the former name
   unless an actual consumer needs one (audit, `UXOR-AUD-PKG-003`).
2. **Layout.** The root `composer.json` is the public package definition: Packagist reads it at the repository root.
   `packages/uxor/` is its implementation, never a second Composer root:

   | Path | What it is | In the archive |
   |---|---|---|
   | `composer.json` | identity, requirements (PHP 8.4+, Mate and its Symfony extension, Symfony components), autoload of `packages/uxor/src/`, the executable, Mate metadata | yes |
   | `composer.lock` | the package's development dependencies; consumers resolve their own | no |
   | `packages/uxor/bin/uxor`, `config/`, `src/` | the CLI, the service configuration, the PHP | yes |
   | `packages/uxor/INSTRUCTIONS.md`, `OPERATIONS.md`, `README.md`, `skills/{setup,build,verify}` | the guidance an agent reads, and the three Mate skills | yes |
   | `packages/uxor/resources/uxor/` | the bundled references: 74 generated files, 73 of UXor's docs and recipe READMEs and the `index.json` holding each one's SHA-256; never edited by hand | yes |
   | `packages/uxor/resources/workflows/` | the workflow guides the tools serve | yes |
   | `packages/uxor/tests/`, `phpunit.xml.dist` | the package's PHPUnit tests and configuration | no |
   | `packages/uxor/tools/` | `check-package.py` (the archive payload check), `ReferenceGenerator.php` and `generate-reference.php` | no |
   | `packages/uxor/dev/` | the independent consumer and the Docker and Serena development environment (a later job) | no |

   The demo, the package and the consumer each keep their own Composer root and lock file.
3. **One archive, two installers.** GitHub's archive of the repository is what `ux:install` downloads and what
   Composer installs. `.gitattributes` keeps the package's runtime and agent files in it and leaves out `composer.lock`
   and `packages/uxor/{tests,tools,dev,phpunit.xml.dist}`. Composer users therefore also receive the kit's files: that
   follows from publishing from one repository, and a trimmed package download is out of scope. The toolkit reads
   only `manifest.json` and recipe directories one level down, so `packages/uxor/` is never a recipe.
4. **The lint view.** The toolkit's lint fails every root directory without a `manifest.json`. *Lint kit* lints a copy
   of the exported archive with only `packages/` removed: any other unexpected directory still fails. No placeholder
   `manifest.json` in `packages/`, and no `export-ignore` of the whole package to make the lint pass. The *Fresh
   install* jobs install from the complete archive, `packages/uxor/` included.
5. **One version sequence.** The kit and the package share the tags `X.Y.Z` and one `CHANGELOG.md`. A change to either
   part can make a new version of both; a breaking change in either sets the version. `composer.json` has no
   `version` field: Composer and Packagist read the tags. Older tags stay as they are: the first version with
   `composer.json` is the first one Composer can install.
6. **CI groups.** The existing coordinator and the one *CI result* check stay. A new *Package* job runs
   `composer validate --strict`, `composer install`, the PHP syntax of `packages/uxor/`, `composer test` (PHPUnit with
   `packages/uxor/phpunit.xml.dist`), `python3 packages/uxor/tools/check-package.py` (what the exported archive
   holds) and a smoke run of `php packages/uxor/bin/uxor list` and `catalog`. `tools/ci-changes.sh` selects it:

   | A change to | runs |
   |---|---|
   | `composer.json` | *Package*, *Lint kit*, both *Fresh install* jobs |
   | `composer.lock` | *Package* |
   | `.gitattributes` | the kit's jobs and *Package* |
   | `packages/uxor/` | *Package*; its markdown also *Contrast* |
   | any other path in `packages/` | the kit's jobs, *Contrast* and *Package* |

   A package-only change does not run the browser matrix. Pushes to `dev` and `main` still run everything.
7. **Local development.** `composer install` and `composer test` at the repository root, with PHP 8.4 or later. The
   demo keeps its own `composer install` in `demo/`.

## The work order and its jobs

Each job is a branch `claude/wo-composer-package--<job>` from the work order, merged back by its own pull request
with its `CHANGELOG.md` entries and `docs/TEST-INVENTORY.md` rows.

| Job | Delivers |
|---|---|
| `foundation` | The root `composer.json` and `composer.lock`; `packages/uxor/` imported from the companion at `614aa28` and renamed to the UXor identity, with the executable's autoload path fixed for its new depth; the export rules; the *Package* job, the classifier rules and their cases; the lint view; this plan, CONTRIBUTING, AGENTS and the readmes. The bundled references are the ones generated from UXor at `40d957c` |
| consumer | `packages/uxor/dev/`: the independent Symfony consumer installing the package from the candidate commit's archive (initialization, repeat discovery, an update that keeps consumer-written content and customized components, the app working without development dependencies), and the Docker and Serena development environment with its checks |
| references | The references regenerated from this checkout: deterministic output, provenance from the hashes of the source files (not from the commit that holds the output, which no commit can name), and a CI check that regenerates into a temporary directory and compares |
| release | The release workflow's checks of both installs at the commit it tags, the Packagist refresh with a limited token from a job that runs no install, the check that Packagist shows the version and its commit, and a retry that reuses the same tag |

## Deferred, and why

- **The consumer fixture and the development environment** need their own job: they bring a second Composer root,
  Docker images and Serena, and their CI group. `packages/uxor/dev/` is already left out of the archive.
- **Regenerating the references here.** The companion's generator requires a clean source checkout and writes its
  commit into the output; inside one repository, the output would have to name the commit that contains it. Until the
  references job lands, the bundled references describe UXor at `40d957c` and their index proves their content, not
  their freshness (audit, `UXOR-AUD-PKG-004`).
- **Publication.** Registering `xormania/uxor` on Packagist and holding its token are owner actions, not authorized
  by this plan. Until then, the package installs from the repository as a VCS dependency.
- **The companion's consumers and retirement.** Moving an installed `xormania/uxorscient` to `xormania/uxor` is a
  documented migration, written once the actual consumers are known: remove the old package first, since both ship
  skills named `setup`, `build` and `verify` and Mate refuses the clash. Archiving the companion repository is a
  separate owner decision.
- **The audit's product and test defects** (`UXOR-AUD-PROD-*`, `UXOR-AUD-TEST-*`) are fixed in their own pull
  requests, outside this work order.

## Side-lined: `feat/upgradeable-components`

That branch explores bundles generated from the Toolkit, contract validators and upgrade and rollback of installed
components. This plan keeps the application-owned recipe model instead, so the branch stays out of this work order;
its useful parts may come back under their own plan and name (audit, `UXOR-AUD-MONO-001`).

## Done when

- `composer validate --strict` passes on the root `composer.json`; every path it declares is in the exported archive,
  and no development or unlisted file is (`check-package.py`, whose list is independent of `.gitattributes`).
- The installed CLI, namespace, Mate tools, resource URIs, instructions and skills use the UXor identity.
- `ux:install` still installs the kit from the complete archive, and the lint still fails an unexpected root directory
  without a `manifest.json`.
- `tools/tests/ci-changes.sh` covers the new rules: a package-only change runs *Package* and not the browser jobs; a
  change to `composer.json` or `.gitattributes` runs both installs.
- The later jobs meet the acceptance of the audit's `W2`, `W3` and `W6` that this plan assigns them (`W4`'s product and
  test defects and `W5`'s merge gates are outside this work order); this plan is marked `shipped` when the release
  job lands.
