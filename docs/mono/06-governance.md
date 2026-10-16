# GitHub governance and setting deltas

**Observed:** October 16, 2026 at approximately 03:56:55 America/New_York (`07:56:55Z`). These are live settings, independent of the frozen source tree. Read the [sanitized exact field snapshot](evidence/rulesets-observed.json) alongside this matrix. No setting was changed.

## Access and completeness

Repository public rules UI listed three active branch rulesets. Each detail page's embedded data exposed its conditions, rules, application-specific required contexts and review parameters. That is direct UI evidence. It did not expose bypass actors (`null`), classic protection, effective/inherited rules or administrative token/environment policy. Administrative API requests failed with proxy CONNECT 403; settings HTML returned 404. Do not read those results as permission/feature absence.

The preparation plan's disabled `MergeCommitsOnly` ruleset could not be refreshed from the public active-rules view. Its current existence/enforcement is unverified. No complete list of inactive/inherited/tag rules is claimed.

## Current rule definitions

| Ruleset | Targets / conditions | PR / review | Required contexts and source applications | Other visible requirements |
| --- | --- | --- | --- | --- |
| [dev, ID 24747136](https://github.com/xormania/uxor/rules/24747136) | Branch `refs/heads/dev`; no exclusions | Merge method `merge` only; minimum reviews 0; code-owner review **false**; last-push approval false; stale-review dismissal **false**; unresolved review threads must be resolved | `CodeQL` from GitHub Advanced Security app **57789**; `CI result` and `Mentions` from GitHub Actions app **15368**; strict/up-to-date policy **false**; checks enforced on creation | Deletion and non-fast-forward updates restricted; CodeQL errors/high-or-higher security alerts required; code-quality errors, AI findings severity `none` |
| [main, ID 24479611](https://github.com/xormania/uxor/rules/24479611) | `~DEFAULT_BRANCH` plus `refs/heads/main`; no exclusions | Merge only; minimum reviews 0; code-owner review **true** (still an approval requirement); last-push false; stale dismissal **false**; thread resolution true | `CI result`, `Release checks`, `Mentions` from Actions **15368**; `CodeQL` from Advanced Security **57789**; strict **true**; checks enforced on creation | Deletion/non-fast-forward restrictions; same CodeQL and code-quality thresholds |
| [work-orders, ID 24827852](https://github.com/xormania/uxor/rules/24827852) | Include `refs/heads/claude/wo-*`; exclude `refs/heads/claude/wo-*--*` | Merge only; minimum 0; code-owner false; last-push false; stale false; thread resolution true | `CodeQL` **57789** and `CI result` **15368**; strict false; **not enforced on initial creation** | Non-fast-forward restriction and code-quality errors; no deletion or CodeQL scanning rule shown in this definition |

All three PR parameter sets also expose empty `required_reviewers`, `authorized_dismissal_actors_only=false`, and `ignore_approvals_from_contributors=false`. Their `require_extra_approval_for_unattributed_changes=true` field is described by the server-provided schema as an extra approval for unattributed Copilot PRs **only when a nonzero approval count is required**; it does not replace dev's missing general owner/approval requirement. These are field observations, not a live merge attempt.

All three detail payloads have hidden/null bypass actors. No empty-bypass or administrator-enforcement claim is possible from that field. No merge queue, linear-history, signing, creation restriction, required deployment or required-workflow rule is present in these three exposed definitions; other inaccessible protection layers could still apply.

### Applicability matrix

The following is **derived applicability of the inspected definitions**, not a complete effective-rules API response. GitHub's full layering, classic protection and hidden bypasses remain to be read.

| Concrete target | Matching visible definition | Expected emitted validation | Remaining gap |
| --- | --- | --- | --- |
| `dev` | dev | Push CI emits `CI result`; PR emits `Mentions`, language analyses and Advanced Security `CodeQL` result | Effective/classic protection, bypasses; branch freshness currently not required by visible rules |
| `main` | main/default | Push CI; PR metadata/CodeQL; every PR into main emits `Release checks` verdict; Pages/release write jobs separately scoped | Effective protection, code-owner actual write access/review feasibility, bypass/tag-publisher permissions |
| `claude/wo-audit` | work-orders parent | Parent push detects draft/not-open PR and fails aggregate deliberately; ready parent needs a rerun/full intended work; PR supplies CodeQL | Exact check source/merge-ref readback; no separate gate guaranteeing ready transition automatically triggers push CI |
| `claude/wo-audit--ci` | Excluded from parent pattern | Ordinary push classifier/CI plus PR analyses into parent | Other rules/classic protection unknown; do not claim the job branch is protected by parent rules |
| `feat/mono-import` | No visible match | Ordinary push classifier and aggregate; PR metadata/CodeQL for its destination | No claim of effective unprotected status without effective-rules readback |
| `feat/upgradeable-components` | No visible match | Feature-profile CI and Package pilot only in that separate integration tree; ordinary target PR routes | Owner chooses integration governance; not silently covered by dev rules |
| Tag `0.3.0` (illustrative) | None of these are tag rulesets | No branch-push CI; exact-candidate release check must precede tag publication | Complete tag rules/classic tag protection and publisher bypass/create permission |

## Findings and exact proposed deltas

### UXOR-AUD-GOV-001 — Restore or explicitly revise the documented human-review and freshness boundary

**Category / confidence / priority:** existing policy-to-settings mismatch, observed source plus live rules UI; high confidence for exposed fields; necessary before relying on the promised merge assurance. Medium implementation/operational effort, because reviewer eligibility and current open work must be checked.

**Evidence:** [AGENT-ASSURANCE.md lines 17–26](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/docs/AGENT-ASSURANCE.md#L17) requires owner review, freshness, stale-approval dismissal and constrained bypass. [CODEOWNERS lines 1–10](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/CODEOWNERS#L1) explains conditional enforcement. [CI lines 3–10 and 28–29](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/workflows/ci.yml#L3) uses push-only testing under a freshness assumption. Live dev has code-owner false, approvals 0, strict false; both dev/main have stale dismissal false.

**Current impact:** dev has no mandatory human approval in the visible definition and need not be updated against an advanced base. Push-only CI proves the branch commit, not an untested integration with a later dev head. A post-merge full dev run supplies later evidence, not the pre-merge guarantee. Main does require owner review despite approval count zero, but its stale-approval behavior differs from policy. This is not evidence that a bad merge occurred.

**Required outcome:** owner explicitly chooses and documents the intended policy. To retain the existing promise, update dev ruleset `24747136` rule `128718653.parameters.require_code_owner_review=true`, `dismiss_stale_reviews_on_push=true`; update rule `128718654.parameters.strict_required_status_checks_policy=true`. Update main rule `127883670.parameters.dismiss_stale_reviews_on_push=true`. Then independently read back effective rules/classic protection/bypass actors. Changing minimum approval count or last-push policy is a separate optional owner decision, not an inferred requirement of this audit.

**Consumers / preservation:** maintainers, code owners, PR agents, dev/main promotion, work-order parents and contents-write release jobs. Preserve merge commits and existing contexts/app IDs. Verify the named owner has actual review eligibility; CODEOWNERS is not a subdirectory access boundary and the change author cannot approve its own PR.

**Acceptance:** a representative PR cannot merge without required owner approval; a source-changing new push dismisses it; advancing dev requires refreshed validation before merge. All actual required contexts are emitted on the evaluated head/merge SHA by the expected applications. Test through an owner-approved disposable repository or read-only existing evidence, not by weakening live protection. No ruleset changes were made here.

**Coupling / rollback / location:** GitHub settings plus documented policy and reviewer ownership; couple check-name changes with CI migration. Roll back only to an explicit reviewed policy decision, never to bypass a blocked PR. Work-order parents may intentionally have lighter review; preserve their separate purpose rather than blindly cloning main rules.

### UXOR-AUD-GOV-002 — Close the administrative evidence gaps before changing merge or release contracts

**Category / confidence / priority:** unresolved operational evidence and owner verification, high confidence that reads are unavailable; necessary before migration/release sign-off. Small-to-medium collection effort; impact could be high but no hidden-setting defect is alleged.

**Exact missing reads:** complete repository metadata (default branch and merge methods via authenticated API); all rule definitions including inactive/tag/inherited rules; effective branch rules for dev/main/concrete parent/job/feature; classic branch protections; bypass actors/modes; Actions allowed-actions policy, token defaults and fork approvals; environments and protection/deployment branch policies; Pages configuration; artifact retention; runner availability; app/webhook binding names/destinations/events/active flags and relevant secret/variable **names/status only**; collaborator/code-owner review eligibility. Do not retrieve webhook secret values or credentials.

**Required outcome / acceptance:** read the endpoint families below with an authorized existing GitHub connection, retain timestamped field-only snapshots, reconcile with actual emitted check contexts and publication jobs, and update the matrix. If the UI cannot expose a family, obtain owner confirmation as explicitly owner-supplied evidence. Current Git auth works for scoped read-only fetch; API denial does not justify requesting a personal token or declaring GitHub disconnected.

**Coupling / risk / location:** this gates final decisions under GOV-001, package CI context changes and first combined release, rather than all source preparation. Collection is read-only; live setting changes remain a separately authorized owner action. Public Packagist metadata similarly cannot establish vendor/account ownership.

| Family | Read-only endpoint / UI source | Audit result and follow-up |
| --- | --- | --- |
| Definitions | `GET /repos/xormania/uxor/rulesets?includes_parents=true&per_page=100`, each `/rulesets/{id}` | API CONNECT 403; public `/rules` and `/rules/{id}` supplied the three active definitions above; inactive/inherited completeness unknown |
| Effective branch rules | `/repos/xormania/uxor/rules/branches/{url-encoded-branch}` | dev API attempt blocked; same family needed for main/parent/job/feature; do not infer effective result from names |
| Classic protection | `/repos/xormania/uxor/branches/{branch}/protection` | dev attempt blocked; remaining branches same unresolved family |
| Repository settings | `/repos/xormania/uxor`; `/settings` | API blocked, HTML 404; public page says default main; repository-wide squash/rebase toggles not refreshed despite ruleset merge-only constraint |
| Actions | `/repos/xormania/uxor/actions/permissions`, `/workflow`, `/fork-pr-contributor-approval`, `/selected-actions`; `/actions/permissions/fork-pr-workflows-private-repos` when applicable | Permissions family blocked; other specific fields not requested after family denial. Need applicable API/UI equivalents, not guesses from workflow YAML |
| Environments / Pages | `/repos/xormania/uxor/environments`, `/environments/{name}`, `/pages` | Environment list blocked; Pages and deployment protection not observed. Source uses `github-pages` environment |
| Retention / runners | Repository Actions settings UI for retention; `/repos/xormania/uxor/actions/runners` where supported | Not reachable/tested individually after family denial; endpoint support must be confirmed. Hosted `ubuntu-latest` in source does not prove account capacity |
| Connections | hooks/app installations, Actions secret/variable names, environment bindings | Not accessed. Scope only safe metadata and least required read; no value dumps |
| Required context emissions | commit `/check-runs`, `/status`; job/runs APIs | API blocked; public PR/run checks inspected where available; source job names and expected app IDs distinguished from complete effective-context proof |

## Check-name migration sequence

Keep `CI result` stable if possible and add package/integration needs underneath it. For an unavoidable renamed context, first emit both old and new gates with equivalent semantics and verify both on representative PR/branch events; then an owner adds the new requirement while retaining the old one; after successful readback and overlapping green evidence, remove the old requirement and then its emission. No unprotected interval or permanently missing required check is needed. Gate coverage and app identity must remain explicit; workflow-name similarity is insufficient.

A Packagist refresh should use a dedicated restricted binding/job, with source execution finished before credential use. Whether Jev's repository secret is currently constrained by environment/branch policy cannot be established from source or a name alone. Verify its binding rather than assuming a repository secret is safe on arbitrary branch pushes.
