# Coverage, overlap and remaining gaps

The original candidate changed 14 files and added 20 Node cases over the 197-case baseline: eight runner, nine workflow, two summary and one captured-step case. It extended two existing cases. The classifier follow-up adds one process regression, giving the locally validated 218-case snapshot. No browser spec, product assertion, screenshot baseline, retry count or dependency lock is changed.

Source: [workflow](../../../.github/workflows/release-checks.yml), [runner](../../../tools/ci/release-checks.mjs), [classifier](../../../tools/ci/release-failure.mjs), [shared identity](../../../tools/ci/run-provenance.mjs). Test owners below are [runner cases](../../../tools/tests/release-checks.test.mjs), [workflow cases](../../../tools/tests/release-checks-workflow.test.mjs), [summary cases](../../../tools/tests/playwright-summary.test.mjs) and [captured-step cases](../../../tools/tests/step-attempts.test.mjs).

## Guarantee map

| Guarantee | Scope / implementation | Coverage and gate |
|---|---|---|
| Complete current/legacy family; discovery errors, malformed/mixed/partial families and test failure never retry a smaller family | Process integration; runner discovery, launch and exit propagation | New runner cases: two family contracts, unknown/partial/mixed/duplicate discovery, discovery failure, test failure. Always-on Tool tests; actual selection/evidence in Release suite. |
| Missing project/spec, skipped required spec/report, or narrowed saved contract is fatal even after launcher exit 0 | Process integration; saved contract and existing evidence CLI | New runner cases for incomplete evidence and altered saved contracts; existing [evidence API/CLI cases](../../../tools/tests/release-evidence.test.mjs); workflow fatal-step case. Tool tests and mandatory Release evidence step. |
| Pre-report launcher failure retains original status/error; unknown counts stay unavailable and capture reaches advisory diagnosis | Process integration; pipeline, summary and captured-step adapter | New workflow launcher case returns 37 and runs real summary/capture tools; diagnosis routing/advisory case. Existing missing/invalid summary cases reused. Tool tests. |
| Event/workflow/resolved/actual checkout identities stay distinct; mismatched checkout fails before tested identity is exported | Process and artifact serialization; provenance step and one shared helper | New mismatch workflow case, two summary cases, one captured-step case; two existing schema/identity cases extended. Tool tests; source mismatch is fatal in real workflow. |
| Only unexpired successful same-repository scheduled proof from this workflow revision can suppress a schedule | Actual comparison Bash and jq over API-shaped fixtures | New marker writer/reader tests reject manual, old-revision, failed, other-workflow, fork and expired candidates. Tool tests; live service boundary remains operational acceptance. |
| Required verdict rejects failed/skipped suites and failed target selection; only trusted scheduled no-op may skip suite | Actual verdict Bash | New seven-row result/event matrix. Tool tests and required Release checks job. |
| Diagnostics/timings/uploads remain advisory and bounded, while browser/properties/evidence remain fatal | Workflow wiring and classifier | New workflow routing, fatal-step and classification API/CLI cases; existing [Jev budget](../../../tools/tests/jev-workflow.test.mjs), [timings](../../../tools/tests/release-timings.test.mjs) and [security-policy](../../../tools/tests/security-policy.test.mjs) cases reused. Tool tests plus Workflows lint/security policy. |
| A valid global-error report with zero failed tests never claims a browser test failed | Real summary/classifier CLI boundary | New follow-up regression: preserves global error and zero attempts/counts; requires generic run-failure category. Proved red before classifier fix; 45 focused and 218 total cases green afterward. |

**Reused:** established evidence/summary/captured-step parsers and fixtures; Jev's key-free composite; existing release browser specs and PHPUnit property matrix; actionlint, ShellCheck, security and cache-policy checks. **New shared support:** `run-provenance.mjs` owns the common identity shape for both artifact consumers. Two pinned family fixtures and each module's isolated process harness remain local; no generic cross-suite helper is needed.

## Useful coverage overlap

| Existing owner | Added boundary | Disposition |
|---|---|---|
| Evidence API/CLI's three cases establish required project/spec presence, no skipped required spec and missing-report failure | Runner incomplete-evidence case proves selected contract reaches the CLI; workflow fatal-step case forbids tolerating it | Keep: parser correctness, handoff and required gate are separate failure modes. No duplicated full parser matrix. |
| Summary missing/unparseable/not-report/null-config cases | Workflow launch-failure case joins exit, tee/pipefail, missing report and captured-step diagnosis | Keep: only integration exercises the original pre-report failure path. |
| Summary clean-pass and captured-step first case preserve old top-level identity fields | Both artifact consumers independently assert scheduled identities from one shared helper | Keep: consumers can omit/misuse a helper independently. No helper-only test mirroring assignments is added. |
| Jev reusable workflow's total advisory budget case | Release caller selects browser attempts or captured steps without a secret | Keep: budget ownership differs from routing and unavailable-data behavior. |
| Timings' median/spread, report-only, harness mismatch and partial-record refusal cases | Existing workflow requires successful tests/properties/evidence before baseline recording | Reuse; no copied metric algorithm tests or baseline rewrite. |
| Security-policy and workflow-cache suites | Real policy/lint checks on the changed workflow | Reuse; no duplicated permissions, secret or cache fixture matrix. |

The argv assertions protect project selection, legacy filter, one worker and report location; they do not prove browser execution. Extracted Bash and actual jq are stronger than text matching, but the local boolean-condition interpreter covers only this workflow's expression subset. A genuine Actions run remains a distinct integration boundary. Structural evidence deliberately asks for required project/spec presence rather than freezing a brittle browser-test total.

## Gaps and dispositions

| When | Gap | Evidence and required disposition |
|---|---|---|
| Before ready to merge | Final-head PR, required checks, requested reviews and conversation resolution | Original candidate hosted CI does not transfer to later commits. Create/update PR into dev, wait for exact-head green, request each official review once, address findings and resolve only addressed threads. Owner performs merge. |
| Before claiming full candidate execution | Full candidate Release workflow remains unrun | Real list-only discovery verifies both supported configurations; ordinary CI excludes release projects. A real feature workflow run must execute all selected projects, PHP properties and evidence if dispatch becomes available. Otherwise retain explicit unrun status. |
| After owner promotion to main | Real scheduler compatibility and pass-marker service integration | Run a genuine schedule at repaired main workflow SHA against recorded dev/checkout SHA. Require actual projects/specs/properties/evidence and final verdict. Then inspect compatible marker creation and an unchanged-dev scheduled no-op. |
| After service integration | Live artifact/API and scheduled issue updates | Controlled API metadata proves decision logic, not actual Actions permissions or issue close/comment behavior. Inspect first genuine run; do not break production just to manufacture a failure. |
| Separate measurement work | Performance comparison, queue/cache details and release harness baseline | One run supports observed durations, not speedup. Authenticated artifacts and a matching baseline are unavailable. Existing release baseline is harness 1; current harness 2 must be recorded honestly. |
| Separate inherited test investigation | Actual cause of WebKit retry | Fourteen relevant files are unchanged from dev. Bounded probe proves an observer barrier gap, not this failed CI attempt's cause. Obtain first-attempt trace before changing unrelated assertions/timeouts. |
