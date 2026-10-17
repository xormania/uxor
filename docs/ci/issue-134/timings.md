# CI timings and selected checks

[Push CI 38880910402, run 684](https://github.com/xormania/uxor/actions/runs/38880910402) passed at exact original candidate `c128aeec88b1c17c753c21bc91d619a1e5027411`: **10m42s, 18 successful jobs and four skipped jobs**. This observation does not apply to later commits or the eventual PR merge commit. There is no comparable before/after pair and no speedup claim.

[Run observation](evidence/timings/run-observation.json) records aggregate calculations, warnings and all 15 published artifact names/sizes/digests. [Job observations](evidence/timings/job-observations.json) include every exposed step for all 22 jobs. Public HTML was observed October 16, 2026; machine timestamps are UTC. Displayed duration is whole-second precision; inferred job start is completion minus duration, not a queue measurement.

| Browser shard | Whole job | Before test | Test step | After test |
|---|---:|---:|---:|---:|
| Chromium 1/4 | 9m19s | 72s | 482s | 5s |
| Chromium 2/4 | 9m40s | 81s | 494s | 5s |
| Chromium 3/4 | 7m34s | 82s | 367s | 5s |
| Chromium 4/4 | 7m34s | 72s | 377s | 5s |
| Firefox 1/3 | 9m56s | 83s | 506s | 7s |
| Firefox 2/3 | 9m19s | 99s | 454s | 6s |
| Firefox 3/3 | **10m03s** | **82s** | **514s** | **7s** |
| WebKit 1/3 | 9m16s | 74s | 468s | 14s |
| WebKit 2/3 | 8m00s | 93s | 382s | 5s |
| WebKit 3/3 | 8m57s | 70s | 460s | 7s |

The observed critical path is Changes → Importmap packages → Firefox 3/3 → CI result. Approximate decomposition: 28s before browsers, 603s critical browser, 2s until aggregate start, 9s aggregate = 642s. That browser's 514s test step is 80% of run duration. Changes took 7s, Importmap packages 14s, Workflows 8s, Tool tests 14s, Contrast 13s, Kit PHP 36s and Static site 26s; these overlap.

Across browsers, setup was 70–99s; image building 11–19s; combined Install Playwright 25–34s; test steps 367–514s. That installation step does not separate npm from image pull. Browser job durations sum to 5,378s; all successful job durations sum to 5,505s. These are parallel wall-time sums, not run duration or billing totals.

Longest-minus-shortest test-step spread was Chromium 127s (29.5% of mean), Firefox 60s (12.2%) and WebKit 86s (19.7%). This warrants inspecting per-test/shard-plan artifacts, not predicting benefit from changed sharding: step time includes process overhead and retries.

## Skips and recovered attempt

The [base-owned classifier replay](evidence/timings/ci-selection-proof.json) records immutable script SHA, exact changed paths, output and exit 0. It selected PHP, static, contrast, demo and workflow checks. Observed skipped jobs were Lint kit, both Fresh install lanes and Build cache. First three match path selection; cache writes are restricted to protected dev/main pushes. A skipped job is not a passed check.

CI **passed with one observed WebKit test passing on retry 1**, not a retry-free browser pass. Search/Back/Forward at `tests/e2e/lab.data-table-back.spec.ts:127` failed deep equality in WebKit 3/3, job `116907304798`, annotation `90152702200`. Public warning truncates actual/expected values. [Retry assessment](retry-assessment.md) separates the inherited observer susceptibility from unproved cause. Eighteen additional notices concerned the upcoming Ubuntu runner migration rather than patch failures.

Ordinary browser shards exclude `release`, `release-dark` and `release-harsh`. Their green status does not establish full Release suite behavior or scheduled repair.

## Measurement limits and next comparison

Published metrics artifact: `ci-metrics-38880910402-1`, 60.3 KB, digest `sha256:822b686f76c5a0df2e4693f8ee500453cef49e653d2acfaa941b77d2c94199ae`. Published shard timings: 51.6 KB, digest `sha256:9fe94b70e4d37012844db3932b7ead5d036da2a7353b825be866efce0a4b7738`. Presence/metadata are observed; contents and digest integrity were not independently downloaded/verified. Public artifact/log routes returned 404; authenticated API access was unavailable.

Queue time, cache hit counters, npm versus image-pull cost, attempt durations, total executed test count and worker use remain unknown. Obtain exact-head and matching-baseline metrics, shard durations, job metrics, shard plan, failed attempts and run-attempt jobs. Hold event/projects/shard count/versions/runner platform constant, then compare setup/test/retry/queue separately. A historical scheduler failure's short runtime is not a performance baseline for a successful suite. Current release timing harness 2 also cannot be compared as equivalent to the older harness-1 baseline; record supported baseline through the normal review path.
