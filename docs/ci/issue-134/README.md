# Issue 134: release scheduler repair evidence

The repair separates the scheduled workflow's control revision from its frozen target checkout, selects the target's complete supported release-project family, and preserves fatal exits and honest evidence. A follow-up fixes a diagnostic edge case: a valid Playwright report with a global error and zero failed tests must not claim a browser test failed.

| Read | Evidence |
|---|---|
| [Coverage and overlap](coverage.md) | Guarantees, test owners, useful overlap, shared support and acceptance gaps |
| [Proved red](proved-red.md) | Real historical failures, four complete-code mutants, classifier regression and green counterparts |
| [CI timings](timings.md) | All jobs/steps, critical path, selected skips and measurement limits |
| [WebKit retry assessment](retry-assessment.md) | The recovered attempt, inherited observer gap, bounded probe and limits |
| [Machine receipts](evidence/README.md) | Exact commands, source/log hashes, observations and the bundle integrity manifest |
| [Replay tool](reproduce.py) | Isolated, one-off reproduction of the historical/negative-calibration evidence |

With the pinned Git history available, the locked npm dependencies installed, and Python 3, Node, Git, Bash and jq
on PATH, run from the repository:

```bash
python3 docs/ci/issue-134/reproduce.py
```

The command creates a fresh temporary output directory and prints its location. It uses no browser, Docker or
network, rejects unsafe output locations, and checks every expected red/green result and retained log hash.

## Validation snapshots

| Snapshot | Observed result | Limit |
|---|---|---|
| Original candidate `c128aeec88b1c17c753c21bc91d619a1e5027411` | [Hosted CI 38880910402](https://github.com/xormania/uxor/actions/runs/38880910402): 18 successful jobs, four skipped jobs, 10m42s; all ten browser shards passed | One WebKit test passed on retry. This is smoke/example CI on the original candidate, not the final-head PR or full Release suite. |
| Original candidate's isolated historical/negative-calibration snapshot | 17 focused runner/workflow cases pass before and after four deliberately broken copies fail | These local proofs do not execute Docker, Symfony, browsers or remote Actions. |
| Classifier follow-up working-tree snapshot | [218 Node tests passed, zero failed/skipped](evidence/checks/full-node-tests.log); its four focused modules passed 45 cases | Source hashes in [local-test receipt](evidence/checks/local-test-receipt.json) identify this snapshot. A later commit needs its own exact-head CI. |

## Acceptance and owner handoff

Before merge, the actual PR into `dev` needs green required checks on its final head, both requested official reviews once, and addressed review conversations. **Official Codex review requests: zero; official Codex security review requests: zero** in this recorded snapshot. Internal parallel source checks are not those reviews. API access and PR creation remained unavailable while these receipts were assembled; the pending actions must remain visible.

The full candidate **Release checks workflow has not run**. Existing browser shards exclude the three dedicated release projects. Actual pinned list-only discovery covers both project families, but its narrow file filter lists only the primary release project's 11 tests; it does not execute full dark/harsh projects or PHP properties.

After the owner merges into `dev`, the repaired workflow/control tools must reach default `main` through normal promotion. Only then can a fresh genuine schedule prove the daily service repaired against a recorded `dev` SHA, including all release projects/specs, PHP properties and mandatory evidence. Dev merge alone cannot replace main's scheduled definition. The owner performs the merge; this work does not approve or merge PRs, change protections, or promote the default branch.
