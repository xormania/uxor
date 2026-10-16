# UXor: one repository, Composer packaging, and CI

Prepared: 2026-10-16, America/New_York  
Status: implementation proposal based on xor's selected direction  
Canonical repository: https://github.com/xormania/uxor

UXor will be one project in one active repository. Its existing Symfony UX Toolkit kit stays in place, and the agent guidance and development tooling currently maintained separately move into `packages/uxor/`. UXor becomes the sole active product name.

This document records that direction and proposes the packaging, CI, release, and migration work needed to implement it. It does not report an implemented migration or authorize repository settings changes, publication, or retirement of the former repository. Later direction from xor takes precedence.

## 1. Selected direction and proposed details

| Item | Status |
| --- | --- |
| One active development and publishing repository: `xormania/uxor` | Selected by xor |
| Package implementation under `packages/uxor/` | Selected by xor |
| Drop uxorscient as an active product name | Selected by xor |
| Keep the existing Toolkit architecture; avoid a broad redesign | Stated scope |
| Split CI responsibilities for Toolkit, package, and their integration | Need identified by xor; proposed design below |
| Publish the Composer package directly from UXor through Packagist | Intended outcome |
| Root `composer.json` describing the implementation in the subdirectory | Proposed implementation |
| Composer identity `xormania/uxor`; PHP namespace `Xormania\UXor\`; CLI `uxor` | Naming targets; registry availability and consumer migration need verification |
| One version/tag sequence for Toolkit and Composer | Recommended starting policy |

“UXor package” describes the Composer delivery mechanism for UXor's agent guidance and development tools. It does not introduce a second product identity. Existing Toolkit components continue to install through Toolkit into the consuming application. Moving the tooling into this repository does not turn those components into a vendor-managed runtime library.

The earlier proposal to publish through a generated second repository is superseded by this direction.

## 2. Verified starting point

Repository observations below were made against development branches. They describe the inspected source, not a claim that every change is already on the promotion branch.

| Source | Observed development revision |
| --- | --- |
| [UXor][uxor-head] | `40d957cd1ea7766ac0dee742816948ce5ae05bc3` |
| [Former companion repository][former-head] | `614aa28fd937baa9feffa7730d02b58dc73afe18` |
| Symfony UX Toolkit implementation examined | `v3.5.1`, matching UXor's inspected CI pin |

UXor already has a changed-path classifier, selective PR jobs, full runs on pushes to `dev` and `main`, and an aggregate `CI result` check. Its existing jobs cover kit linting, PHP, the demo, browser behavior, static output, fresh installation, and repository tools. These are a useful foundation for the new package checks. [UXor CI][uxor-ci] · [Classifier][classifier]

The former package already includes Composer metadata, a CLI, Mate tools and resources, three agent skills, generated UXor references, package tests, an independent Symfony consumer, and Docker/Serena development support. Its package tests exercise real archive installation, updates, discovery, preservation of consumer-authored content, and operation after development dependencies are removed. These capabilities should survive the move. [Package metadata][former-composer] · [Package checks][former-check] · [Package CI][former-ci] · [Consumer CI][former-consumer]

The inspected release workflow separates installation checks from the job that writes tags and releases. It selects a release commit from the changelog history and checks that the tag points to the intended commit. The new Composer checks must join that existing release path. [Release workflow][release]

The former README says there is no Packagist release yet. That is source documentation, not verification of the current authenticated Packagist account or namespace permissions. [Former README][former-readme]

## 3. Repository and package layout

The root `composer.json` is the public package definition. `packages/uxor/` is its implementation directory, not a separately published Composer root. Packagist expects the package metadata at the repository root. [Packagist submission requirements][packagist-about]

| Path | Responsibility |
| --- | --- |
| `composer.json` | Public package identity, dependencies, autoloading, executable and Mate metadata |
| `composer.lock` | Reproducible dependency selection for package development; consumer applications resolve their own locks |
| `manifest.json` and existing recipe directories | Existing Toolkit kit and recipes |
| `packages/uxor/src/` | Package PHP implementation |
| `packages/uxor/config/` | Package service configuration |
| `packages/uxor/bin/uxor` | CLI exposed to consumers through Composer |
| `packages/uxor/INSTRUCTIONS.md`, `skills/`, and `resources/` | Installed agent guidance, skills, and bundled references |
| `packages/uxor/tests/` | Package behavior tests |
| `packages/uxor/dev/` | Independent consumer fixture and package development environment |
| `packages/uxor/tools/` | Package-specific verification and reference-generation helpers |
| `demo/` | Existing UXor demonstration application and UI test target |
| `tools/`, `docs/`, `.github/` | Shared repository tooling, documentation, and workflows |

The package's PHPUnit configuration and development-only Node/browser configuration can live alongside its tests and consumer fixture. Their exact placement should preserve usable local commands and avoid creating a second authoritative package manifest.

Root Composer metadata must point to the moved paths: PSR-4 classes in `packages/uxor/src/`, the executable in `packages/uxor/bin/`, and Mate scan directories, service includes, instructions, and skills under `packages/uxor/`. Test autoloading belongs in `autoload-dev`. [Composer schema][composer-schema]

Audit relative-path assumptions during the move. The current executable falls back to an autoloader one directory above itself; that fallback will be wrong at the proposed depth. Package-checking scripts also currently assume their parent directory is the repository root. Installed execution and direct development invocation both need verification. [Existing executable][former-bin] · [Package checks][former-check]

Keep the package's dependency environment separate from `demo/` and the independent consumer. Each is a distinct Composer root with its own purpose and lockfile. A local consumer may use the UXor repository root as a path repository, but distribution tests must use an archive installation.

## 4. One active name

Use UXor throughout current documentation, agent guidance, commands, and metadata. The former name belongs only in clearly labeled migration/history material and citations.

| Surface | Target |
| --- | --- |
| Project and documentation title | UXor |
| GitHub repository and contribution destination | `xormania/uxor` |
| Composer package | `xormania/uxor` |
| PHP namespace | `Xormania\UXor\` |
| Installed executable | `vendor/bin/uxor` |
| Mate tool prefix | `uxor_` |
| Resource URI scheme | `uxor://` |
| Instructions, skill descriptions, environment labels and diagnostics | UXor terminology |

This is a coordinated identity migration. Inspect Composer requirements, PHP namespaces, CLI output, service registration, tool identifiers, resource URIs, generated indexes, fixture names, container configuration, tests, and agent-facing examples.

Composer treats differently named packages as different dependencies. Existing VCS consumers need an explicit migration from `xormania/uxorscient` to `xormania/uxor`, including obsolete repository entries and refreshed Mate discovery. Do not assume changing the metadata transparently renames an installed dependency.

Check actual consumers before deciding whether temporary aliases are necessary. Compatibility aliases or Composer `replace` declarations should express a verified compatibility need, not preserve the old identity by default. Existing consumer-owned instructions and customized components must remain intact.

## 5. Composer and Toolkit compatibility

There is no metadata naming collision: Toolkit loads the root `manifest.json`, while Composer uses `composer.json`. In Toolkit 3.5.1, recipe discovery looks for manifests one directory beneath the kit root. The proposed package implementation is deeper and does not become a recipe merely by being present. [Kit factory][kit-factory] · [Recipe discovery][kit-sync]

The concrete incompatibility is the structural linter. Its missing-manifest checker treats every immediate directory without `manifest.json` as an error. UXor currently avoids unrelated directories in that check by linting its Git-exported archive, which honors `.gitattributes`. [Missing-manifest checker][kit-lint] · [Current export rules][attributes]

For the combined repository:

1. Keep package implementation and required resources in the downloadable archive.
2. Continue excluding development-only content where appropriate, with explicit rules for the new nested layout.
3. Create a temporary lint view from the exported archive and remove only explicitly recognized non-recipe directories such as `packages/`.
4. Retain unexpected directories in that view so an accidentally missing recipe manifest still fails.
5. Run actual Toolkit installation against the complete archive.

Do not add a dummy recipe manifest to `packages/`. Do not export-ignore the entire package directory to make lint pass.

The complete archive is a shared delivery boundary. Composer installation will contain the retained kit files as well as the package implementation; this is an expected consequence of publishing directly from one repository. A specially trimmed package download is outside this proposal.

Check both GitHub-style exports and Composer-created archives where used. They can differ in how exclusions are applied. The existing package archive validator must be updated for the combined layout and new identity rather than simply copied unchanged.

## 6. Dependencies and consumer behavior

Retain the current package's functional requirements during migration unless a specific compatibility issue justifies changing them. The inspected baseline requires PHP 8.4+, Mate and its Symfony extension at `^0.14`, and the relevant Symfony components at `^7.4 || ^8.0`. This document does not propose a dependency upgrade. [Existing metadata][former-composer]

Consumers install the tooling as a development dependency. Dependencies required for the tooling to work belong in the package's `require`; its own test framework belongs in `require-dev`. Putting Mate in the package's `require-dev` would not install it for downstream consumers. Likewise, a dependency's root-only Composer configuration does not configure the consuming application. [Composer root-package rules][composer-schema]

Consumer instructions should explicitly cover required Composer plugin authorization and the supported Mate initialization/discovery sequence. Preserve the currently documented explicit refresh after an update until the supported versions have demonstrated equivalent automatic behavior. [Current consumer instructions][former-readme]

After publication, the intended entry point is `composer require --dev xormania/uxor`, followed by the documented setup/discovery steps. This command is a target user flow, not a claim that the new package is published today.

Installing or updating the tooling does not automatically overwrite application-owned Toolkit components. The existing ownership model remains.

## 7. CI responsibilities

Keep the existing CI coordinator and `CI result` contract. Organize checks into distinct groups; extracting groups into reusable workflows is an implementation choice, not a prerequisite for moving the package.

| Group | Required evidence |
| --- | --- |
| Toolkit | Existing kit lint, PHP, demo, browser, static-output and fresh-install guarantees |
| Composer package | Metadata validation, moved-path correctness, PHP behavior, executable, Mate tools/resources/skills, and exported payload |
| Consumer integration | Both delivery routes from the same candidate commit, initialization, updates, content preservation, and production behavior without development dependencies |
| Development environment | Existing native/Docker setup and Serena session/recovery guarantees |
| Shared repository checks | Workflow validation, security policy, ownership/name checks, repository tools, and relevant documentation checks |

The existing independent consumer remains valuable even though the repository also has a demo. The demo proves UXor's UI behavior; the consumer proves that another application can install and use the distributed package.

The current consumer workflow installs a pinned UXor source revision. In the combined repository it should exercise the Toolkit and package from the same candidate commit. A package change and its corresponding recipe change can then be reviewed and tested together. [Current consumer workflow][former-consumer]

### Selecting work

Extend the existing classifier and its tests. Place package-specific rules before broad recipe patterns, and inspect tools that assume a directory is a recipe or that all documentation has the same purpose.

| Changed inputs | Intended checks |
| --- | --- |
| Package implementation, instructions, skills or resources | Package checks and affected consumer scenarios |
| Toolkit recipes, CSS, controllers or manifests | Existing affected Toolkit checks; integration/reference checks where those inputs are consumed |
| Root Composer metadata, archive rules or shared installation helpers | Package checks and both installation routes |
| Package environment definitions, images or lifecycle helpers | Environment checks and affected consumer/package checks |
| CI coordinator, classifier or shared control tooling | All affected groups; classify conservatively |
| Documentation | Relevant documentation/reference checks, including generated agent material when its source changes |

Package-only changes should not automatically run the full Toolkit browser matrix. Conversely, a path filter must not omit checks whose inputs changed indirectly.

Retain full runs on `dev` and `main` initially, matching current CI. Optimize further after measuring the new groups.

Keep the coordinator present on every applicable PR. Skip unaffected jobs inside it and make `CI result` verify that required work passed and that skips were deliberate. Failed or cancelled required jobs must fail the result. GitHub documents that skipping an entire required workflow through path filters can leave its check pending. [Workflow filtering][github-triggers]

Use separate dependency-cache keys for the root package, demo, and consumer. Extend existing diagnostics and retained failure evidence to the new groups. Consolidate overlapping consumer setup where practical without dropping the archive-update or production-without-development-dependencies checks.

## 8. References and generated guidance

UXor's recipe files and authored documentation become the canonical inputs for bundled package references. Preserve the existing useful generated catalog and guidance rather than maintaining a second authored copy.

The generation workflow should read this checkout, produce deterministic output, and let CI detect stale committed references by regenerating into a temporary location and comparing. Changed references should be committed with the PR so the tagged repository already contains the distributable resources.

Record provenance without requiring a generated file to contain the hash of the commit that contains that same file. Source-input hashes and Composer's installed source reference can establish content and release provenance without that circular requirement.

This makes reference freshness part of normal UXor development. It does not imply that every UI edit changes every package resource, or that publication can rely on uncommitted generated output.

## 9. Packagist and releases

Register the public UXor repository for the target package after verifying account access and vendor-name permission. Packagist reads root metadata and repository tags; it is not a separate package-file upload destination. Keep the Composer version field unset and use valid release tags. [Packagist requirements][packagist-about]

Use one version sequence for the project. A Toolkit-only or tooling-only change can produce a new UXor version even if the other part is unchanged. Breaking changes in either public surface must be considered when selecting the version. The first Composer release should use the next UXor release tag containing the new root metadata. Earlier Toolkit-only tags remain unchanged.

Proposed release sequence:

1. Prepare a normal release PR with the project changelog.
2. Run both distribution checks against the exact commit selected for the release.
3. Create the tag and GitHub release using the existing release machinery.
4. Invoke the Packagist refresh step directly from that release workflow, preferably through a reusable workflow.
5. Verify that Packagist exposes the expected package version and source commit.
6. Retain an independently runnable retry for refreshing an existing release.

Checking the latest branch tip is insufficient if the release planner selects another commit. Extend the existing checks so the selected tag commit has evidence for both installation routes. Preserve the separation between jobs that execute consumer installations and jobs that hold publication credentials. [Release workflow][release]

The refresh endpoint accepts a SAFE Packagist token and supports authorization in a header. Use that limited token for routine refreshes; account registration and package creation are separate setup operations. The update response queues work, so a successful response alone does not prove indexing has completed. [Packagist API][packagist-api]

GitHub's normal token does not cause a new push/tag-triggered Actions run when it creates a tag. Therefore, publishing should not depend solely on a separate tag-event workflow firing after the existing release job. Call it directly or dispatch it explicitly. [GitHub event behavior][github-triggers]

An indexing failure should report a publication problem and permit retrying that same immutable release. It should not require moving a tag or inventing another version.

## 10. Migration work

Prepare the migration as reviewable work on UXor's normal development branch. Keep the repository usable as each merged change lands; combine tightly coupled path, metadata, archive and CI changes when necessary.

| Work package | Deliverable |
| --- | --- |
| Baseline and identity | Inventory current capabilities, public identifiers, VCS consumers, open work and source revisions |
| Package import | Move implementation and development support into the agreed layout; rename active surfaces; establish root metadata |
| Compatibility and CI | Adapt archive rules, structural lint input, path assumptions, classifier, consumer tests and aggregate result |
| Reference integration | Generate bundled guidance from UXor's own source and validate freshness |
| Release preparation | Extend exact-commit checks, configure Packagist registration/refresh, and document retry behavior |
| Transition documentation | Unified README/contributor guidance and explicit instructions for existing consumers |

Existing PR discussions and approvals are GitHub records and do not move with copied Git files. Record the imported source revision and preserve attribution.

If full historical ancestry is desired inside UXor, select an import and merge method that actually retains it. An ordinary squash of the migration will not retain every original commit as an ancestor. This historical choice does not require an ongoing subtree publisher or a second active development repository.

After the migrated package works, point the former repository's documentation to UXor and resolve outstanding work deliberately. Its archival or other retirement is a separate owner action; removing active branding does not require deleting historical evidence.

Keep reviews and merges in UXor's existing process. Package ownership can be expressed in CODEOWNERS, but the subdirectory does not become a separate repository access boundary. Repository settings and collaborator access should be reviewed as part of the eventual implementation, not silently assumed to transfer.

## 11. Acceptance evidence

The migration is ready for its first release when the following are demonstrated:

- Root metadata validates and identifies UXor; all declared files exist in the distributed archive.
- The installed CLI, PHP namespace, Mate tools, resource URIs, instructions and skills use the UXor identity.
- A fresh independent consumer installs the archive as an ordinary dependency, without relying on a source symlink.
- Initialization and repeat discovery preserve consumer-authored content.
- Updating the package refreshes bundled guidance and tools while preserving customized application components.
- Removing development dependencies still allows the selected Toolkit components and Symfony application to function.
- Toolkit installation works from the complete repository archive containing `packages/uxor/`.
- Structural lint still catches an unexpected root directory with a missing recipe manifest.
- Package and Toolkit changes select the intended CI groups; shared changes select both installation paths.
- The package development environment and Serena checks retain their existing guarantees.
- Bundled references match the canonical inputs in the candidate checkout.
- The release checks validate the commit actually tagged, and a Packagist retry verifies the existing version without changing it.

Before implementation, verify the remaining operational facts: target Packagist name/account permissions, any consumers that need a compatibility transition, outstanding work in the former repository, and the desired history-import method. The implementation should also exercise the proposed nested layout with the pinned Toolkit/Mate versions; this document is a source-based design, not a substitute for those checks.

## Sources

Repository links below are pinned to the revisions observed during preparation. The former repository appears only as migration evidence. Official documentation describes external behavior and may evolve.

| Reference | What it supports |
| --- | --- |
| [UXor CI][uxor-ci] and [changed-path classifier][classifier] | Existing check groups, selective execution and aggregate result |
| [UXor export rules][attributes] | Current archive assumptions |
| [UXor release workflow][release] | Candidate-commit selection and separation of check/publish jobs |
| [Former package metadata][former-composer] and [README][former-readme] | Existing dependency contract, consumer behavior and identity |
| [Former package CI][former-ci], [consumer workflow][former-consumer] and [archive checker][former-check] | Existing checks to preserve and adapt |
| [Existing executable][former-bin] | Autoload path that must change when moved |
| [Toolkit factory][kit-factory], [recipe discovery][kit-sync] and [missing-manifest checker][kit-lint] | Verified Toolkit 3.5.1 behavior |
| [Packagist package submission][packagist-about] | Root metadata, vendor permission, tags and registration |
| [Packagist API][packagist-api] | Refresh authentication, queued updates and metadata endpoints |
| [Composer schema][composer-schema] | Autoloading, binaries and root-only configuration semantics |
| [GitHub workflow triggers][github-triggers] | Required-check filtering and token-created event behavior |
| [GitHub reusable workflows][github-reuse] | Direct workflow reuse for publication |
| [GitHub merge methods][github-merges] | History retained or flattened by merge choice |

[uxor-head]: https://github.com/xormania/uxor/commit/40d957cd1ea7766ac0dee742816948ce5ae05bc3
[former-head]: https://github.com/xormania/uxorscient/commit/614aa28fd937baa9feffa7730d02b58dc73afe18
[uxor-ci]: https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/workflows/ci.yml
[classifier]: https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/tools/ci-changes.sh
[attributes]: https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.gitattributes
[release]: https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/workflows/release.yml
[former-composer]: https://github.com/xormania/uxorscient/blob/614aa28fd937baa9feffa7730d02b58dc73afe18/composer.json
[former-readme]: https://github.com/xormania/uxorscient/blob/614aa28fd937baa9feffa7730d02b58dc73afe18/README.md
[former-ci]: https://github.com/xormania/uxorscient/blob/614aa28fd937baa9feffa7730d02b58dc73afe18/.github/workflows/ci.yml
[former-consumer]: https://github.com/xormania/uxorscient/blob/614aa28fd937baa9feffa7730d02b58dc73afe18/.github/workflows/consumer.yml
[former-check]: https://github.com/xormania/uxorscient/blob/614aa28fd937baa9feffa7730d02b58dc73afe18/tools/check-package.py
[former-bin]: https://github.com/xormania/uxorscient/blob/614aa28fd937baa9feffa7730d02b58dc73afe18/bin/uxorscient
[kit-factory]: https://github.com/symfony/ux-toolkit/blob/v3.5.1/src/Kit/KitFactory.php
[kit-sync]: https://github.com/symfony/ux-toolkit/blob/v3.5.1/src/Kit/KitSynchronizer.php
[kit-lint]: https://github.com/symfony/ux-toolkit/blob/v3.5.1/src/Kit/Lint/Checker/MissingRecipeManifestChecker.php
[packagist-about]: https://packagist.org/about
[packagist-api]: https://packagist.org/apidoc
[composer-schema]: https://getcomposer.org/doc/04-schema.md
[github-triggers]: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
[github-reuse]: https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
[github-merges]: https://docs.github.com/en/pull-requests/reference/pull-request-merges

