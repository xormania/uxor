# Historical red proofs and controlled negative calibration

The original selector fault is reproduced with real immutable source and locked Playwright 1.58.2. Four deliberately broken complete-code copies fail their intended existing assertions; the fixed code passes before and afterward. No proof relies on a missing import, missing helper or syntax error.

| Role | Exact commit |
|---|---|
| Historical default main | `9b2fa7309786cee435503de87cf0cd5f0a9d9782` |
| Historical dev target | `40d957cd1ea7766ac0dee742816948ce5ae05bc3` |
| Original fixed candidate under calibration | `c128aeec88b1c17c753c21bc91d619a1e5027411` |

[Fourteen command receipts](evidence/red-proofs/receipts.json) preserve Git trees/blob IDs, source SHA-256s, exact argv/cwd, exits, assertions, local elapsed time and stdout/stderr hashes. Those local elapsed times are not hosted CI benchmarks. Commands used existing locked dependencies, Node v24.19.0 and isolated Git-object extracts; no browsers, Docker, remote workflow or API was executed.

## Historical reproduction

| Actual historical behavior | Green counterpart / observation | What it proves |
|---|---|---|
| Main selectors against actual dev config exit 1: obsolete dark/harsh project names unknown | Actual dev config accepts current family | Original fault occurs before browser execution. |
| Renamed current projects with obsolete release-tag filter exit 1, no tests found | Same family and anchored release-file filter without obsolete grep list 11 tests | Renaming projects alone cannot repair the invocation. |
| Actual pinned main and dev configs each list 11 release-file tests | Both exact supported families accepted, exits 0 | Compatibility is grounded in actual configs, rather than invented fixture names. |
| Old summary calls main event SHA the tested commit | Fixed summary labels dev checkout/resolved SHA separately from main event/workflow SHA | Actual historical reporting defect. Both summaries exit 2 because report is intentionally absent; counts remain unavailable. |
| Actual old comparison Bash accepts only-available successful manual marker: `run=false` | Fixed comparison Bash rejects it: `run=true` | Manual green could suppress a broken schedule. Both commands exit 0; red observation is unsafe decision, not invocation failure. |

The marker replay supplies controlled API JSON and executes actual jq predicates; it does not prefilter canned trusted IDs. The narrow discovery filter imports three real release specs, deliberately avoiding Symfony inventory. Its 11 listed tests belong only to the primary release project; dark/harsh definitions exist and are accepted but have zero tests under that filter. List-only skipped fields are not executed-test skip verdicts. This is selection evidence, not full-suite execution.

## Four independent complete-code mutants

| Deliberate defect | Existing assertion detecting it | Proved red |
|---|---|---|
| Disable pipeline failure propagation | Launcher failure retains original exit/error and captured-step diagnosis | Got 0 where 37 required; test process exits 1. |
| Trust successful manual marker | Scheduler trusts compatible same-repository scheduled proof only | Manual candidate produced false where true required; exit 1. |
| Ignore checkout mismatch | Actual checkout must match frozen target | Got 0 where mismatch must exit 1; exit 1. |
| Accept altered saved complete contract | Evidence refuses narrowed/unsupported/malformed selection | Narrowed selection got 0 where 1 required; exit 1. |

All four are controlled mutations, not claimed historical repository defects. Each fails with `ERR_ASSERTION` in its named existing test. Unchanged candidate runner/workflow suites pass **17/17, zero failed/skipped**, before and after calibration. The [portable replay](reproduce.py) checks the expected failure shape and rejects import/syntax failures as negative evidence.

## Additional classifier defect found and fixed

A real locked Playwright `globalSetup` exception preserved runner exit 1 yet wrote a valid JSON report with one global error, zero unexpected tests and no browser attempts. Original classifier incorrectly said `browser test failure`; syntactic report validity did not establish that claim.

The [curated real-process observation](evidence/implementation/global-setup-proof.json), [command/source hashes](evidence/implementation/global-setup-source-receipt.json) and [captured error](evidence/implementation/global-setup.log) retain that proof. Full generated reports remain in execution scratch and are not shipped. The stable report shape is captured in the [new no-install regression](../../../tools/tests/release-checks-workflow.test.mjs).

| Regression snapshot | Result |
|---|---|
| [Original classifier red receipt/log](evidence/implementation/classification-regression-red.json) · [log](evidence/implementation/classification-regression-red.log) | New process regression exits 1 at exact category assertion: actual browser-test failure vs expected generic run failure. |
| [Fixed classifier green receipt/log](evidence/implementation/classification-regression-green.json) · [log](evidence/implementation/classification-regression-green.log) | Four focused modules pass 45/45; actual report reclassified `Playwright run failure (no failed test reported)`. |

The fix requires a finite positive failed-test count from the actual summary before claiming browser-test failure. Missing/invalid reports retain invocation-failure category. No arbitrary global error is assumed to occur before tests. Exit status, required verdict, selection, unavailable evidence and advisory policy remain unchanged. [Sparse-layout receipt](evidence/implementation/sparse-layout.json) also confirms required control tools/action/workflow survive the exact non-cone checkout.
