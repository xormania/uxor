# Baseline, scope and evidence

This audit follows the supplied [audit assignment](inputs/uxor-repository-audit-plan-2026-10-16.md), [single-repository direction](inputs/uxor-single-repository-plan-2026-10-16.md), and [configuration concept](inputs/uxor-configuration-concept-2026-10-16.md). The owner subsequently requested separate documents by area under `docs/mono/`; that replaces the assignment's one-file presentation requirement. The substantive audit scope is retained.

## Selected direction versus proposals

Selected: UXor is the working project and sole active product/repository identity; tooling implementation moves to `packages/uxor/`; existing Symfony UX Toolkit recipes remain application-owned copies. Xorder is an external resource for images, runtimes and development tools. It is not an additional product being audited or merged.

Root Composer metadata, public Composer/namespace/CLI identifiers, a shared version sequence, archive layout, settings adjustments and exact CI grouping remain proposals requiring the evidence and decisions recorded here. A difference from a proposal is not automatically a defect. This audit does not convert the tooling import into vendor-managed UI components or a new theme platform.

## Frozen source snapshots

| Surface | Ref and full SHA | Observation and disposition |
| --- | --- | --- |
| Primary audited tree | `dev`: `40d957cd1ea7766ac0dee742816948ce5ae05bc3` | Refreshed October 16; matches preparation snapshot; 1,289 tracked files |
| Promotion/default tree | `main`: `9b2fa7309786cee435503de87cf0cd5f0a9d9782` | Matches preparation snapshot; tag `0.2.0` resolves here |
| Previous release | `0.1.0`: annotated tag object `85b0b538a4d813f5e1e34195fd2e47051d5326c9`, commit `a517397aa663a5920e3169068416296914bd2760` | Existing immutable historical release retained |
| Latest release | `0.2.0`: annotated tag object `997d6cfdf85739a25dc7c231f6e3e9e6320b86fe`, commit `9b2fa7309786cee435503de87cf0cd5f0a9d9782` | Public release page retrieved; not a Composer tooling release |
| Former companion development | `dev`: `614aa28fd937baa9feffa7730d02b58dc73afe18` | Matches supplied import baseline; 185 tracked files |
| Former companion promotion/default | `master`: `fdb89cfec20517bfdca02d81acc5dd98944ac48a` | Newer promotion commit; its tree and `dev` tree are both `e1f95b84942cb9287652fe1284ae0061156edd69`; source contents agree |
| Existing experimental integration | `feat/upgradeable-components`: `81eb1a87b1fd0471f6879cd88617c8681af6b6aa` | Pending separately from `dev`; purpose and interfaces require reconciliation, not automatic import |
| Open experimental increment | `feat/upgradeable-components--frontend-validator`: `fbcd0a76e12fa5f877bcdbf284102851dfa47932` | PR 144 targets experimental integration, not `dev` |
| Supporting Xorder provider | `97cb40b083f4ccf16148355c4e785ed0c6e4b00a` | Existing companion's selected provider; read only as consumed infrastructure and Composer resource guidance |

The audit delivery branch is `docs/mono-audit-2026-10-16`, based on the audited `dev` SHA. Existing local feature branches were preserved. Scratch checkouts and fixtures were used for commands that generate files; primary application source was untouched. No worktree was required.

`main` does not yet contain the subsequent OAuth and CI work on `dev`. The inspected development tree contains nine workflows and one local composite action. The experimental integration has an additional Package pilot workflow; it is recorded below as pending work, not counted as implemented `dev` functionality.

## Active and merged work reconciliation

Public PR list observation at approximately `2026-10-16T07:55:44Z` was complete: page 1 of 1, one open PR. Companion public PR list had zero open entries; public issue list showed no open entry. Absence from these lists does not establish absence of private/offline consumers or unpublished branches.

| Work | Observed status | Consequence for this audit |
| --- | --- | --- |
| [PR 139](https://github.com/xormania/uxor/pull/139) | Merged into `feat/upgradeable-components`; archive upgrade/rollback and sorting-focus work; browser route now manual on that feature workflow | Do not recreate its proof or claim it is already on `dev`; preserve relevant tests if the owner retains that experiment |
| [PR 140](https://github.com/xormania/uxor/pull/140), [142](https://github.com/xormania/uxor/pull/142), [143](https://github.com/xormania/uxor/pull/143) | Integration Git history contains Symfony research, Toolkit-derived package plans, and Composer contract validation | These have actual implementation on the integration SHA; they are neither the tooling companion import nor merely empty proposals |
| [PR 144](https://github.com/xormania/uxor/pull/144) | Open; three commits; frontend installed-selection validation, compile guard, semver/real-Flex fixtures | Owner must reconcile this work with the selected tooling scope. Its PR describes PHP-focused checks; no new browser pass is inferred |
| [Issue 134](https://github.com/xormania/uxor/issues/134) | Open: Release checks fail on dev; updated with October 16 scheduled failure | Track independently of migration; current release proof is outstanding |
| Other active UXor branches | `claude/jev-probe` at `20268ae111184fb41129755f26dedf2897fbbe86`; `claude/live-deps` at `9a12e5e20674ae1df12fd998546b4f4977207be0`; `claude/wo-test-audit--ci-trigger` at `bb9ec6c5fee69524caa5300fb9b5a95ce54ee4c1`; `copilot/research-symfony-ux-toolkit-comparison` at `7da445d34f7c7c4f301705d88a31e3a3283bc5af` | Accounted as active refs without an open PR in the public list. Owner should classify retained/abandoned intent before deleting or recreating work; no implementation claim is made from a branch name |

### Pending experiment boundary

The [current pilot README](https://github.com/xormania/uxor/blob/81eb1a87b1fd0471f6879cd88617c8681af6b6aa/packages/uxor-pilot/README.md#L1) explicitly calls it unpublished and unsupported. It derives source plans from Toolkit, assembles namespaced bundle components, validates Composer requirements and performs a separate archive upgrade/rollback experiment. That differs from importing development guidance/tools while retaining copied recipes.

The feature tree has 81 changed paths relative to `dev`; there is still no root Composer manifest on that integration revision. Its root `/packages` export exclusion cannot be copied into a combined distribution that must include `packages/uxor/`. The Package pilot workflow runs PHP/archive checks on feature pushes and browser checks only for a manual run with `browsers=true`; it has read-only permissions, pinned actions, 20-minute budget, same-ref cancellation, seven-day evidence and bounded cleanup. Its old project image pin must be checked against current Xorder support before reuse. Do not promote a claim of full current browser CI from earlier PR prose.

This is an explicit owner decision, `UXOR-AUD-MONO-001`: retain useful experiment capabilities and their provenance, decide their destination/active status, and keep their proposed runtime architecture separate from the selected tooling import. No pending work was deleted or merged by this audit.

## Evidence method and trust

Source findings refer to the frozen commit and exact line anchors. The baseline makes relative source paths unambiguous; domain reports also contain pinned GitHub links. **Executed** means the recorded command actually ran here. **Focused fixture** means selected real methods/native platform behavior under a bounded harness, not a full application run. **Historical** means an observed remote run with its own SHA/event/attempt context. **Inference** identifies a consequence not reproduced as a production incident.

Every tracked file is assigned a disposition in [coverage](09-coverage-and-evidence.md). Generated references were validated against their complete input set; binary baselines/assets were checked by role and integrity, with no new visual approval. Structural/index-only test reading is labeled. Unknown settings and inaccessible operational artifacts remain gaps, with retrieval steps rather than invented values.

During the original audit, API requests to `api.github.com` returned proxy CONNECT 403. Public GitHub HTML remained usable, including embedded ruleset metadata; that enabled more governance inspection than the API denial alone would suggest. The administrative settings page returned 404 to that session. A null/hidden bypass field was unknown, not an empty bypass list.

The later GOV-002 access refresh used the connected GitHub tool to verify repository merge/default-branch fields, all four returned ruleset definitions and their explicitly empty bypass arrays, the named code owner's admin permission, and sampled check names/source apps. This supersedes the original access limits for those specific fields without changing the frozen source snapshots or original evidence. Effective/classic protection and other administrative families remain unresolved; exact fields, timestamps and current access failures are in [governance](06-governance.md) and the [refresh snapshot](evidence/gov-002-access-refresh-2026-10-16.json).

## Input integrity

The three supplied Markdown files are preserved byte-for-byte under `inputs/`. Their SHA-256 values are listed in [the source index](09-coverage-and-evidence.md). Their instructions describe the owner's requested audit scope and selected direction; repository files, fetched pages and test output were treated as evidence, not authority to perform external writes.

## End-of-audit drift check

Read-only remote ref enumeration repeated at 2026-10-16T08:26:45.978778+00:00 found no change to the enumerated UXor or companion heads/tags during this audit. This does not cover live administrative settings changing after their own observation time.
