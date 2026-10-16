# UXor repository audit and change inventory

**Audit date:** October 16, 2026, America/New_York. **Working project:** UXor. **Audited source:** `dev` at `40d957cd1ea7766ac0dee742816948ce5ae05bc3`. **Delivery branch:** `docs/mono-audit-2026-10-16`.

This is the completed source audit and decision inventory requested in the supplied plan, split into area documents at the owner's request. It records unavailable operational evidence explicitly. It does not report an implemented migration, a new full application test pass, or readiness to publish.

## Executive assessment

UXor has a useful architecture to preserve. All 64 recipe directories have native manifests and explicit copy/dependency contracts; their 194 installed runtime destinations do not collide. Shared Stimulus modules and the Turbo/Live fixture suite cover meaningful state, focus, cleanup, security and accessibility behavior. The demo is intentionally a trusted development application; the static gallery is its publication boundary. The former companion already has a shared operation core, CLI/Mate access, bounded checks, three skills, generated references, an independent consumer and provider recovery support. Import those capabilities rather than creating a second implementation.

The selected single-repository direction is feasible, but it is not implemented at the baseline. There is no root Composer package. The migration must land metadata, nested paths, identity, retained payload, lint view, generated-reference provenance and minimum package/consumer CI together. The strongest non-obvious design issue is reference generation: the current former-repository generator requires a clean source HEAD and embeds that HEAD in output. Reusing that check against output committed in the same repository creates a circular commit requirement. Use canonical input hashes and a separate release/source provenance policy, with independent archive/consumer verification.

The existing experimental `feat/upgradeable-components` work is different from importing development tooling. Its Toolkit-derived bundle generation, contract validators and upgrade/rollback fixtures may be useful, but the selected plan explicitly preserves application-owned recipe installation. PR 144 is still open against that integration branch. Reconcile it before implementing a conflicting package identity or discarding useful work. This audit did neither.

There are concrete existing defects beyond migration: five focused native Chromium/controller-method reproductions demonstrate Calendar keyboard focus loss at disabled days, form-contained Tabs submitting, explicit Chart plugin disabling being overwritten, external equal-path navigation links marked current, and interrupted Alert dismissal leaving an invisible focusable control. A supported raised-limit Editor save/load inconsistency is source-confirmed but its full PHP round trip remains unrun. These are scoped findings, not a claim that every product behavior is broken or that source inspection is a security certification.

Test assurance also needs repair: part of the dark release matrix explicitly loads light previews; UI fuzzing swallows its settling timeouts; one hover behavior assertion is confined to a screenshot-only route. The docs promise stronger static-link checking and Mate runtime guarding than their implementations provide. Keep the many useful existing tests and fix these specific gaps; do not rewrite the suite.

Live governance differs from the documented boundary. The visible dev ruleset currently requires neither code-owner approval nor an up-to-date branch, while the source's push-only CI assumes freshness and the agent assurance policy requires human review. Both dev and main leave stale-approval dismissal disabled. Three active rulesets were read in full through the public UI; hidden bypasses, classic/effective protection and other administrative families remain inaccessible. Those must be read back before claiming merge or release assurance.

**Executed evidence:** 197 Node tool tests and 15 companion Python harness tests passed; all 159 tracked PHP files across both baselines passed syntax checks; static docs/import/security/contrast checks passed; all 74 generated companion references matched the current canonical input set. Actual current Toolkit Git-export and companion Composer archives passed their scoped payload checks (330 and 96 regular files). These are separate current baseline exports. Composer dependency installation failed on blocked GitHub API zipballs, so PHPUnit, full Symfony/Mate consumer install/update/no-dev, actual combined distribution, full browser matrix and Serena/provider execution were not rerun. Focused Chromium fixtures use system Chromium 154, not the project screenshot image, and do not establish pixel parity.

## What the owner must decide

| Decision | Recommended basis and consequence | Required before |
| --- | --- | --- |
| Reconcile experimental packaged UI/validator work with the selected tooling import | Keep the selected recipe ownership model; inventory retained experiment capabilities and choose their future scope/name without claiming they already implement the companion import | Final package topology and identity work |
| Approve exact public identifiers and first combined version | Proposed `xormania/uxor`, `Xormania\UXor\`, CLI `uxor`, Mate prefix `uxor_`, URI `uxor://`; public Packagist metadata returned 404 for both names, which does not prove vendor/account availability | Public metadata/consumer transition and registration |
| Choose import/history and former-consumer transition | Preserve source SHA and upstream history/review references; follow UXor's merge-commit process. Decide compatibility only from actual consumers, not a blanket rename or speculative `replace` | Import commit and transition guide |
| Retain or revise the documented governance promise | Recommended retain freshness, owner review and stale dismissal; first establish effective rules/bypasses/reviewer eligibility | Relying on pre-merge validation or changing required contexts |
| Choose immutable public-release recovery and publication authority | Ordinary interrupted indexing retries reuse the exact existing tag/SHA; do not turn tag movement into routine repair | First Composer publication |
| Authorize eventual Packagist registration and former-repository retirement | Neither publication nor retirement is authorized by this audit. Keep earlier evidence and URLs | After independent migration acceptance |

## Read the audit by area

1. [Baseline, pending work, scope and evidence](01-baseline-and-scope.md).
2. [Product capability and defect report](02-product-code.md).
3. [Complete companion import, identity and distribution map](03-package-import-and-distribution.md).
4. [Guarantee-to-assertion-to-check maps](04-tests-and-validation.md).
5. [Complete workflow/action/job, CI and release register](05-ci-workflows-and-releases.md).
6. [Live governance matrix and exact setting deltas](06-governance.md).
7. [Configuration ownership and development paths](07-configuration-and-development.md).
8. [Complete coverage, validations, unresolved facts and source index](09-coverage-and-evidence.md).

Each domain finding supplies pinned locations, evidence type/confidence, current impact, required outcome, affected consumers/preservation, acceptance and implementation risks. The index below deduplicates shared causes. One item can appear in multiple area documents when its acceptance spans them; it is still one change.

## Complete change register

Stage **M** means required for the first combined migration/release; **P** means a product/test follow-up before the next release of the affected guarantee; **F** means optional or later maintainability/precision work; **O** means an explicit owner decision/readback. These stages express sequencing, not vulnerability ratings. S is localized work; M is several consumers/checks; L is a coupled multi-root change. Domain P1/P2/P3 labels describe their specific impact and confidence separately.

| Stable ID | Category / stage / size | Concrete outcome and execution location | Detailed evidence and acceptance |
| --- | --- | --- | --- |
| UXOR-AUD-MONO-001 | Owner decision / O / M | Reconcile PR 144 and integration's bundle/build/upgrade work with the tooling scope; preserve provenance and decide active destinations before import | [Baseline and scope](01-baseline-and-scope.md) |
| UXOR-AUD-PKG-001 | Migration / M / L | Root Composer metadata plus nested implementation, archive declarations/payload validator and exact lint view land coherently | [Import and distribution](03-package-import-and-distribution.md) |
| UXOR-AUD-PKG-002 | Migration / M / M | Give repository Composer root, package root and consumer app root explicit meanings; fix executable fallback, scripts, fixture repositories, mounts and Serena paths | [Import and distribution](03-package-import-and-distribution.md) |
| UXOR-AUD-PKG-003 | Migration/identity decision / M+O / M | Coordinate Composer/class/CLI/Mate/URI/guidance identities, refresh discovery, and preserve copied recipe APIs and verified consumer customizations | [Import and distribution](03-package-import-and-distribution.md) |
| UXOR-AUD-PKG-004 | Migration/provenance / M / M | Deterministic references from canonical input hashes without clean-self-HEAD circularity; tagged source contains required outputs and stale check compares independent regeneration | [Import and distribution](03-package-import-and-distribution.md) |
| UXOR-AUD-PKG-005 | Existing tooling defect / P / M | Correct custom Composer vendor/bin discovery or report the unsupported layout precisely, while retaining no-boot bounded inspection | [Import and distribution](03-package-import-and-distribution.md) |
| UXOR-AUD-PKG-006 | Migration/test preservation / M / L | Preserve seven operations/three skills, archive update/init/no-dev, independent installed-component workflow, native/prepared/Serena routes and correct candidate identity | [Import](03-package-import-and-distribution.md), [tests](04-tests-and-validation.md) |
| UXOR-AUD-CI-001 | Migration/assurance / M / M | Add package/consumer/reference/environment selection and aggregate needs; package tests must not be mistaken for demo browser specs; verify planned skips | [CI register](05-ci-workflows-and-releases.md) |
| UXOR-AUD-CI-002 | Migration/publication / M / M | Validate both delivery routes at actual selected release commit; then restricted Packagist refresh and bounded source/version verification plus same-tag retry | [CI and release](05-ci-workflows-and-releases.md) |
| UXOR-AUD-CI-003 | Existing evidence defect / P / M | Freeze one tested SHA for scheduled jobs and carry actual tested ref into summaries/diagnosis; Monthly must not resolve mutable dev independently | [CI and release](05-ci-workflows-and-releases.md) |
| UXOR-AUD-CI-004 | Migration/security-policy scope / M / M | Include local action trust/pins, package executable sinks and generated paths; authorize only a narrow publication credential reader | [CI and release](05-ci-workflows-and-releases.md) |
| UXOR-AUD-CI-005 | Migration/maintenance / M / S–M | Audit all three Composer roots and assign their dependency/tool-pin update owners; preserve root-specific selection and locks | [CI and release](05-ci-workflows-and-releases.md) |
| UXOR-AUD-CI-006 | Owner/release recovery / M+O / S–M | Replace routine public-tag moving/deleting instructions with immutable, incident-aware recovery | [CI and release](05-ci-workflows-and-releases.md) |
| UXOR-AUD-CI-007 | Maintainability / F / M | Share the actual repeated demo prepare operation without hiding permissions/verdicts; retire stale cache fallback only after measured evidence | [CI and release](05-ci-workflows-and-releases.md) |
| UXOR-AUD-CI-008 | Maintenance/calibration / F / S | Re-record timing baseline using current harness through existing recording route; retain old measurement as history rather than relabeling it | [CI and release](05-ci-workflows-and-releases.md) |
| UXOR-AUD-GOV-001 | Existing policy/settings mismatch / O+P / M | Explicitly settle human review, freshness and stale approvals; proposed exact dev/main rule deltas and readback | [Governance](06-governance.md) |
| UXOR-AUD-GOV-002 | Unresolved operational evidence / O+M / S–M | Retrieve complete effective/classic/tag/bypass/Actions/environment/connection metadata; preserve unknowns until verified | [Governance](06-governance.md) |
| UXOR-AUD-PROD-001 | Existing accessibility defect / P / S–M | Calendar retains an enabled keyboard Tab stop and can navigate disabled-day boundaries; DatePicker inherits acceptance | [Product](02-product-code.md) |
| UXOR-AUD-PROD-002 | Existing form defect / P / S | Tabs triggers use non-submit semantics; click/Enter/Space switch tabs without submitting surrounding form | [Product](02-product-code.md) |
| UXOR-AUD-PROD-003 | Existing configuration defect / P / S | Chart theming preserves explicit disabled plugin ancestors rather than replacing false with objects | [Product](02-product-code.md) |
| UXOR-AUD-PROD-004 | Existing navigation defect / F / S | Shared current-link matching rejects other origins with equal pathname, while preserving intentional query/hash semantics | [Product](02-product-code.md) |
| UXOR-AUD-PROD-005 | Existing lifecycle/accessibility defect / P / S | Interrupted Alert fade/disconnect/reconnect cannot leave invisible focusable controls | [Product](02-product-code.md) |
| UXOR-AUD-PROD-006 | Documentation mismatch / F / S | Remove Alert's affirmative obsolete JavaScript requirement and close that precise documentation-check blind spot | [Product](02-product-code.md) |
| UXOR-AUD-PROD-007 | Authoring metadata cleanup / F / S | Replace 22 unresolved inherited schema references with the intended reachable schema owner, preserving schema-version meaning | [Product](02-product-code.md) |
| UXOR-AUD-PROD-008 | Conditional persisted-data correctness / P / S–M | Raised Editor limits cannot accept sanitizer-expanded persisted HTML that later load/render rejects; verify complete form-save-load round trip | [Product](02-product-code.md) |
| UXOR-AUD-TEST-001 | Existing test defect / P / S–M | Dark release previews actually render dark; add effective-theme assertion while retaining intentional per-example theme cases | [Tests](04-tests-and-validation.md) |
| UXOR-AUD-TEST-002 | Existing test defect / P / S–M | Fuzz terminal settle failure fails with seed/recent-action evidence; permitted exploratory misses remain scoped | [Tests](04-tests-and-validation.md) |
| UXOR-AUD-TEST-003 | Test coverage gap / F / S | Separate normal hover behavior from screenshot tag so Firefox/WebKit execute the behavioral guarantee | [Tests](04-tests-and-validation.md) |
| UXOR-AUD-TEST-004 | Generated guidance mismatch / F / S | Mate instructions truthfully describe runtime guard/profile; keep intentional PHP 8.4/8.5 difference | [Tests](04-tests-and-validation.md) |
| UXOR-AUD-TEST-005 | Documentation/validation mismatch / F / S | Narrow static-gallery link promise or add independent local href/action/asset checks; no broken published link is alleged | [Tests](04-tests-and-validation.md) |
| UXOR-AUD-CFG-001 | Existing local policy defect / P / S–M | Scan the actual retained commit message; fix unconditional scissors truncation and use real-Git cleanup tests; refresh installed hook copies | [Configuration](07-configuration-and-development.md) |
| UXOR-AUD-CFG-002 | Migration/configuration ownership / M / M | Document repository/package/app roots and audiences; align broad Tailwind/fingerprint/docs scans with real input roles before narrowing package CI | [Configuration](07-configuration-and-development.md) |

Shared security/tag/provenance causes use the existing IDs above rather than becoming duplicate work. The register contains **32 distinct items**; several are migration requirements or owner decisions rather than existing defects.

## Ordered implementation work packages

### W0 — Establish decisions, open-work disposition and operational facts

**Goal:** choose the actual import surface and governance/publication contracts before renaming or extracting. **IDs:** MONO-001, GOV-001/002, PKG-003, CI-006. **Prerequisites:** none for read-only/source preparation; authenticated administrative reads and owner choices are separate actions. **Files/settings:** inputs/current plans, integration PR 144 and commits, Composer name/vendor permissions, CODEOWNERS and effective rulesets, release recovery docs. **Acceptance:** disposition list for every companion capability and active experiment; complete or explicitly owner-confirmed setting matrix; identity/history/consumer transition decisions recorded. Do not delete the former repository, add speculative aliases or weaken protections to accelerate this step.

### W1 — Establish roots, provenance and justified configuration owners

**Goal:** explicit directory roles and canonical-input provenance with discoverable local commands. **IDs:** PKG-002/004 and configuration ownership actions; CI-003 may proceed independently. **Files:** proposed root Composer paths, nested package helpers, reference generator/index, repository map, native runner/profile metadata and agent orientation. **Prerequisites:** W0 topology/identity choices. **Acceptance:** wrong root fails usefully; direct repository and installed execution succeed; repeated deterministic generation is byte-stable, stale inputs fail, and adding/renaming a recipe reaches every relevant consumer. Do not select a generic new configuration framework before the inventory justifies it.

### W2 — Atomic combined package/distribution and minimum gate

**Goal:** land a usable combined source and both install boundaries in one coherent candidate. **IDs:** PKG-001/003/006, CI-001/004/005; PKG-005 can be fixed in the same helper change with an independent test. **Files:** root Composer metadata/lock, `packages/uxor/`, `.gitattributes`, root/nested ignores, payload/lint tools, security policy, classifier/tests and aggregate needs, package/consumer native configs. **Prerequisites:** W1 root/provenance contract. **Acceptance:** exact exported payload supports root Composer and Toolkit; unexpected unmanifested root still fails lint; installed CLI/Mate/resources/skills work; consumer-owned instructions/components survive repeat init/update; removing dev dependencies still renders selected recipe workflow; package-only/shared/recipe/unknown/delete/rename/control changes select correct groups. Land coupled path/archive/gate changes together; rollback the group if required, preserving existing recipe/demo tests and consumer code.

### W3 — Complete environment, reference and integration evidence

**Goal:** preserve former package's functional/native/browser/provider guarantees alongside demo coverage. **IDs:** PKG-004/006, CI-003/005, TEST-004 and justified configuration actions. **Files:** native/Docker/Serena runners, support locks, independent fixture, generator freshness check, docs and diagnostics. **Prerequisites:** W2 installed candidate. **Acceptance:** same candidate feeds both delivery routes; root/demo/consumer locks and caches remain distinct; supported profile checks, actual readiness, Mate discovery and Serena session/recovery receipts pass; injected partial failure does not replay/overwrite consumer customization. No dependency declaration or mock runner pass is substituted for real provider evidence.

### W4 — Repair product and test defects independently

**Goal:** restore the concrete existing guarantees without coupling ordinary fixes to the migration redesign. **IDs:** PROD-001..008, TEST-001..005 and the local mention-hook finding in configuration. **Files:** exact paths in each domain finding, relevant README and existing suites. **Prerequisites:** none for independent recipe/test fixes; choose disabled-date semantics and Editor refusal behavior explicitly. **Acceptance:** focused negative cases fail before/fix after; supported full engine/real-render/form/round-trip checks pass; no unrelated screenshot baseline refresh. Product changes require their README pairing and ordinary UXor review. These can proceed in parallel with W1–W3, each on a separate authorized work branch with current normal merge process.

### W5 — Align complete CI and live merge gates

**Goal:** real selected work and required contexts agree on every branch/event path. **IDs:** CI-001/003/004/005, GOV-001/002; CI-007 is optional and measured separately. **Prerequisites:** W2 required check implementations emitted successfully and W0 actual settings available. **Acceptance:** verify feature, work-order parent/job, draft-to-ready, delete/rename/unknown path, failed/cancelled/partial rerun and main promotion scenarios at exact evaluated SHAs. For renamed checks, emit old and new together, require both while proven, then retire old requirement and emission. Preserve `CI result` where possible. Never disable protection as routine transition mechanics.

### W6 — First combined immutable release and subsequent transition

**Goal:** publish only after the actual candidate has proof for both distribution routes. **IDs:** CI-002/006, PKG-001/003/004/006, GOV-002. **Prerequisites:** W2–W5 acceptance plus explicit owner registration/publication authorization. **Files/settings:** release planner/workflow, root package metadata, restricted Packagist binding/job, source/version polling, release retry/docs, tag/environment permissions. **Acceptance:** checked candidate SHA equals tagged/source SHA; package version and refs become visible after queued indexing; interrupted indexing retry reuses that immutable tag; code execution never sees publication credentials; static gallery uses intended ref. Do not rely on a token-created tag spawning another Actions workflow. Former-repository redirects/archive are a later separately chosen owner action after consumers and pending work are reconciled.

### W7 — Bounded follow-up simplification and calibration

**Goal:** reduce demonstrated repeated ownership without obscuring behavior. **IDs:** CI-007/008, low-risk documentation/schema/current-link/hover corrections and configuration follow-ups. **Prerequisites:** relevant sources and workload measurements. **Acceptance:** shared operation has at least its real local/CI callers; native early GitHub fields retain valid authored/generated forms; regenerated output is committed/stale-checked; prospective before/after samples preserve workload and critical-path scope. No speedup is claimed from this audit's biased UI sample.

## Risk, acceptance and stopping boundaries

Migration blockers are missing target capabilities and unresolved decisions, not proof the existing Toolkit is unusable. Conversely, a green baseline suite does not validate the proposed nested layout. The 109-run historical sample is intentionally nonrandom and incomplete; it supports route/provenance observations and concrete follow-up, not project-wide speedup/cache/retry estimates. Logs and artifacts require additional read access.

Implementation should preserve application-owned copies, explicit credential/CSRF boundaries, immutable release refs, existing supported release tags, independent consumer tests, exact runtime/lock distinctions and historical attribution. It may remove obsolete active companion naming and redundant setup only after every consumer has a recorded destination. Each work package carries its own acceptance; a formatter or configuration-only checker is insufficient at installation/runtime boundaries.

The remaining operational reads and unexecuted acceptance scenarios are enumerated in [coverage and evidence](09-coverage-and-evidence.md). They are concrete follow-up tasks, not silent omissions. No outside approval is being requested to review this audit artifact; implementation and settings/publication changes remain later authorized work.
