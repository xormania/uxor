# GitHub governance and setting deltas

**Original observation:** October 16, 2026 at approximately 03:56:55 America/New_York (`07:56:55Z`). **GOV-002 access refresh:** 04:49–04:52 America/New_York (`08:49:34–08:52:49Z`) on the same date. These are live settings, independent of the frozen source tree. The [original UI snapshot](evidence/rulesets-observed.json) is preserved; the [new API evidence](evidence/gov-002-access-refresh-2026-10-16.json) records verified fields, sample check contexts, observation times and exact remaining access failures. No live setting was changed.

## Access and completeness

The original audit used public rules UI evidence because its environment could not reach the API. The connected GitHub tool used for this refresh can read repository metadata, ruleset definitions, collaborator permission and commit check runs. The original proxy failure is therefore an environment-specific historical result, not the current access limit for those families.

The ruleset list requested `includes_parents=true` and returned four definitions on page 1; page 2 was empty. All four are repository-sourced branch rulesets: active `dev`, `main` and `work-orders`, plus disabled `MergeCommitsOnly` (ID `24686124`, target condition `~ALL`). Each detail was retrieved. No tag-targeted or inherited ruleset was returned by this listing. This establishes the returned ruleset inventory, not classic protection or every effective merge/tag permission.

All four API detail responses explicitly return `bypass_actors: []` and `current_user_can_bypass: "never"`. This closes the hidden-bypass gap for those definitions at this observation. The effective-branch-rules URLs are rejected by the connector's URL allowlist; classic branch protection for both dev and main returns GitHub 403, `Resource not accessible by integration`. These are distinct from the original proxy CONNECT failure. Neither proves that protection is absent.

## Current rule definitions

| Ruleset | Targets / conditions | PR / review | Required contexts and source applications | Other visible requirements |
| --- | --- | --- | --- | --- |
| [dev, ID 24747136](https://github.com/xormania/uxor/rules/24747136) | Branch `refs/heads/dev`; no exclusions | Merge method `merge` only; minimum reviews 0; code-owner review **false**; last-push approval false; stale-review dismissal **false**; unresolved review threads must be resolved | `CodeQL` from GitHub Advanced Security app **57789**; `CI result` and `Mentions` from GitHub Actions app **15368**; strict/up-to-date policy **false**; checks enforced on creation | Deletion and non-fast-forward updates restricted; CodeQL errors/high-or-higher security alerts required; code-quality errors, AI findings severity `none` |
| [main, ID 24479611](https://github.com/xormania/uxor/rules/24479611) | `~DEFAULT_BRANCH` plus `refs/heads/main`; no exclusions | Merge only; minimum reviews 0; code-owner review **true** (still an approval requirement); last-push false; stale dismissal **false**; thread resolution true | `CI result`, `Release checks`, `Mentions` from Actions **15368**; `CodeQL` from Advanced Security **57789**; strict **true**; checks enforced on creation | Deletion/non-fast-forward restrictions; same CodeQL and code-quality thresholds |
| [work-orders, ID 24827852](https://github.com/xormania/uxor/rules/24827852) | Include `refs/heads/claude/wo-*`; exclude `refs/heads/claude/wo-*--*` | Merge only; minimum 0; code-owner false; last-push false; stale false; thread resolution true | `CodeQL` **57789** and `CI result` **15368**; strict false; **not enforced on initial creation** | Non-fast-forward restriction and code-quality errors; no deletion or CodeQL scanning rule shown in this definition |

The refresh corroborates the active rulesets' conditions, required check contexts/application IDs, review-count/code-owner/stale-review/freshness values, and merge-only PR method. The original UI additionally exposed `authorized_dismissal_actors_only=false`, `ignore_approvals_from_contributors=false` and the AI-finding detail in the table; those UI-only fields were not returned by this REST response and retain their original observation time. All three refreshed PR parameter sets return empty `required_reviewers` and `require_extra_approval_for_unattributed_changes=true`. The original server-provided UI schema describes that extra approval as applying to unattributed Copilot PRs **only when a nonzero approval count is required**; it does not replace dev's missing general owner/approval requirement. These are field observations, not a live merge attempt.

The current API bypass arrays are explicitly empty for all four returned definitions, including the disabled one. The caller's `never` result is specific to this connection; it is not a claim about every actor or every protection layer. No merge queue, linear-history, signing, creation restriction, required deployment or required-workflow rule is present in the three active definitions; inaccessible protection layers still require verification.

### Applicability matrix

The following is **derived applicability of the inspected definitions**, not a complete effective-rules API response. The returned definitions and their bypass arrays are verified; effective layering and classic protection remain unresolved.

| Concrete target | Matching visible definition | Expected emitted validation | Remaining gap |
| --- | --- | --- | --- |
| `dev` | dev | Push CI emits `CI result`; PR emits `Mentions`, language analyses and Advanced Security `CodeQL` result | Effective/classic protection and actual PR enforcement; branch freshness is false in the refreshed definition |
| `main` | main/default | Push CI; PR metadata/CodeQL; every PR into main emits `Release checks` verdict; Pages/release write jobs separately scoped | Effective/classic protection, PR-specific reviewer eligibility and tag-publisher permissions; named code-owner admin access is verified |
| `claude/wo-audit` | work-orders parent | Parent push detects draft/not-open PR and fails aggregate deliberately; ready parent needs a rerun/full intended work; PR supplies CodeQL | Exact check source/merge-ref readback; no separate gate guaranteeing ready transition automatically triggers push CI |
| `claude/wo-audit--ci` | Excluded from parent pattern | Ordinary push classifier/CI plus PR analyses into parent | Other rules/classic protection unknown; do not claim the job branch is protected by parent rules |
| `feat/mono-import` | No visible match | Ordinary push classifier and aggregate; PR metadata/CodeQL for its destination | No claim of effective unprotected status without effective-rules readback |
| `feat/upgradeable-components` | No visible match | Feature-profile CI and Package pilot only in that separate integration tree; ordinary target PR routes | Owner chooses integration governance; not silently covered by dev rules |
| Tag `0.3.0` (illustrative) | No tag-targeted ruleset returned by the refreshed listing | No branch-push CI; exact-candidate release check must precede tag publication | Effective tag/publisher create/update permission outside the returned definitions; absence from the ruleset listing is not a publication permission test |

## Findings and exact proposed deltas

### UXOR-AUD-GOV-001 — Restore or explicitly revise the documented human-review and freshness boundary

**Category / confidence / priority:** existing policy-to-settings mismatch, observed source plus live rules UI; high confidence for exposed fields; necessary before relying on the promised merge assurance. Medium implementation/operational effort, because reviewer eligibility and current open work must be checked.

**Evidence:** [AGENT-ASSURANCE.md lines 17–26](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/docs/AGENT-ASSURANCE.md#L17) requires owner review, freshness, stale-approval dismissal and constrained bypass. [CODEOWNERS lines 1–10](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/CODEOWNERS#L1) explains conditional enforcement. [CI lines 3–10 and 28–29](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/workflows/ci.yml#L3) uses push-only testing under a freshness assumption. Live dev has code-owner false, approvals 0, strict false; both dev/main have stale dismissal false.

**Current impact:** dev has no mandatory human approval in the visible definition and need not be updated against an advanced base. Push-only CI proves the branch commit, not an untested integration with a later dev head. A post-merge full dev run supplies later evidence, not the pre-merge guarantee. Main does require owner review despite approval count zero, but its stale-approval behavior differs from policy. This is not evidence that a bad merge occurred.

**Required outcome:** owner explicitly chooses and documents the intended policy. To retain the existing promise, update dev ruleset `24747136` rule `128718653.parameters.require_code_owner_review=true`, `dismiss_stale_reviews_on_push=true`; update rule `128718654.parameters.strict_required_status_checks_policy=true`. Update main rule `127883670.parameters.dismiss_stale_reviews_on_push=true`. Then independently read back effective rules/classic protection/bypass actors. Changing minimum approval count or last-push policy is a separate optional owner decision, not an inferred requirement of this audit.

**Consumers / preservation:** maintainers, code owners, PR agents, dev/main promotion, work-order parents and contents-write release jobs. Preserve merge commits and existing contexts/app IDs. Verify the named owner has actual review eligibility; CODEOWNERS is not a subdirectory access boundary and the change author cannot approve its own PR.

**Acceptance:** a representative PR cannot merge without required owner approval; a source-changing new push dismisses it; advancing dev requires refreshed validation before merge. All actual required contexts are emitted on the evaluated head/merge SHA by the expected applications. Test through an owner-approved disposable repository or read-only existing evidence, not by weakening live protection. No ruleset changes were made here.

**Coupling / rollback / location:** GitHub settings plus documented policy and reviewer ownership; couple check-name changes with CI migration. Roll back only to an explicit reviewed policy decision, never to bypass a blocked PR. Work-order parents may intentionally have lighter review; preserve their separate purpose rather than blindly cloning main rules.

### UXOR-AUD-GOV-002 — Close the remaining administrative evidence gaps before changing merge or release contracts

**Status:** partially resolved by the October 16 access refresh. **Category / confidence / priority:** operational evidence and owner verification; high confidence in the returned fields and recorded access failures. Remaining governance/publication evidence is needed before the corresponding sign-off; no hidden-setting defect is alleged.

#### Verified in this refresh

| Family | Verified result | Scope of closure |
| --- | --- | --- |
| Repository metadata | Public, unarchived; default `main`; merge commits enabled; squash/rebase/auto-merge/update-branch options disabled; merged-branch deletion enabled | These exact repository fields are now read directly. Administrative families and omitted security-feature fields remain separate. |
| Ruleset inventory | Four definitions, all repository-sourced branch targets; three active and disabled `MergeCommitsOnly`; next list page empty; all four details retrieved | The list requested parent rules and returned no inherited or tag-targeted definition. Classic/effective protection is not inferred from this. |
| Ruleset bypasses | `bypass_actors: []` and caller `current_user_can_bypass: "never"` on all four definitions | Explicit empty arrays replace the original hidden/null observation for these definitions only. |
| Code-owner permission | The named code owner has `admin` repository permission. Dev/main CODEOWNERS blobs both equal `e08044b4520bf6d0f1481e11a4bbac3c809423b9` | Identity/content and repository permission are verified. Approval eligibility still depends on the PR author and enforced rules; no self-approval or merge test was performed. |
| Check contexts and source apps | Actual `CI result`, `Mentions` and `Release checks` records use Actions app `15368`; `CodeQL` uses Advanced Security app `57789` in the PR sample | Confirms these names/app IDs exist on sampled commits. It does not prove all branch/event paths or an effective merge verdict. |

The check-run reads covered dev SHA `40d957cd1ea7766ac0dee742816948ce5ae05bc3` (27 records), main SHA `9b2fa7309786cee435503de87cf0cd5f0a9d9782` (203 records over three pages), and PR 144 head `fbcd0a76e12fa5f877bcdbf284102851dfa47932` (20 records). The refreshed PR metadata confirms that PR 144 targets `feat/upgradeable-components`, so it is not evidence of dev/main protection enforcement. The snapshot retains the required-context rows, their IDs, app IDs, conclusions, head SHAs and source URLs. These are historical check records, not new test executions or a diagnosis of any release failure. Issue 134 remains with its separate investigation.

#### Remaining reads for the owner

| Family | Current access result | Exact information still needed |
| --- | --- | --- |
| Effective branch and classic protection | Effective-rule URLs for dev/main rejected by connector URL allowlist (`INVALID_ARGUMENT`); both classic-protection reads return GitHub 403, `Resource not accessible by integration` | Effective rules and any classic rules for dev/main plus concrete work-order parent/job and feature names; interactions with the verified rulesets; actual PR enforcement/reviewer feasibility. |
| Actions administration | `/actions/permissions` rejected by connector URL allowlist; sibling admin endpoints not retried | Allowed actions/reusable workflows and pin policy, default workflow token permissions, ability to create/approve PRs, applicable fork approvals and token/secret policy. |
| Environments and Pages | `/environments` and `/pages` rejected by connector URL allowlist | Environment list, required reviewers, deployment branch/tag restrictions, protection/bypass policy, and Pages source/deployment configuration, especially `github-pages`. |
| Runners and retention | `/actions/runners` rejected by connector URL allowlist; retention UI not accessed | Available runner/group access and applicable capacity; artifact/log retention settings. Workflow runner labels alone do not establish either. |
| Connections and credential bindings | No supported metadata-only route inspected; secrets endpoint families are excluded by the connector; no credentials requested | App/webhook names, destinations, events and active status; relevant secret/variable **names, scope and presence only**; release/diagnosis bindings and publisher installation/token permissions. Do not provide credential or webhook-secret values. |
| Other repository security enablement | `security_and_analysis` was not returned by the repository response | Any security feature enablement needed to establish actual scanning/alert behavior beyond the verified rule definitions and sample check records. An omitted field is not a disabled setting. |

Source URLs and exact error results are in the [refresh snapshot](evidence/gov-002-access-refresh-2026-10-16.json). Remaining owner verification can use the repository Settings pages or an already-authorized metadata read. Record the observation time and exact fields, including an explicit empty/disabled result where applicable. Do not convert an inaccessible field into an assumed absence or request a new credential merely to finish this document.

**Required outcome / acceptance:** complete only the remaining reads, reconcile the effective rules with the verified definitions and actual check producers, and record PR-specific review feasibility plus future package/release context acceptance. Preserve the distinction between metadata readback and a tested merge/publication outcome. Public Packagist metadata still cannot establish vendor/account ownership; that is separate registry evidence.

**Coupling / risk / location:** remaining evidence informs GOV-001 policy decisions, check-context changes and first combined publication. It does not block independent source preparation. This refresh updates audit documents/evidence only; it changes no GitHub setting, workflow, review, release or registry configuration.

## Check-name migration sequence

Keep `CI result` stable if possible and add package/integration needs underneath it. For an unavoidable renamed context, first emit both old and new gates with equivalent semantics and verify both on representative PR/branch events; then an owner adds the new requirement while retaining the old one; after successful readback and overlapping green evidence, remove the old requirement and then its emission. No unprotected interval or permanently missing required check is needed. Gate coverage and app identity must remain explicit; workflow-name similarity is insufficient.

A Packagist refresh should use a dedicated restricted binding/job, with source execution finished before credential use. Whether Jev's repository secret is currently constrained by environment/branch policy cannot be established from source or a name alone. Verify its binding rather than assuming a repository secret is safe on arbitrary branch pushes.
