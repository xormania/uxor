# Issue 147: avoid the known crashing capability probe

The fix selects the existing memory-pressure fallback directly for exact Chromium build `145.0.7632.6`. It avoids opening the optional capability-probe context on that build. Other builds retain the original probe and cleanup behavior. The long-session spec imports the helper; its 50 measured visits, two warm-up rounds, 300-second budget, retry policy, waits, forced collections, same-document/controller checks and counter limits remain unchanged.

[Coverage, overlap and gaps](coverage-map.md) · [Red/green proofs](proofs.md) · [Receipts](evidence/README.md) · [Issue 147](https://github.com/xormania/uxor/issues/147).

## Measured hosted evidence

[Failed Release run 38994766044](https://github.com/xormania/uxor/actions/runs/38994766044) recorded 135 passes and one failure, zero flaky/skipped, with two long-session attempts timed out at initial `/lab` navigation (300.1s/300.2s whole-attempt durations). Its actual tested PR merge was `f69b17fc9b252e2c1b99e05b26d1a6a61e2215bd`; API branch head was dev `5b1e0a071fcfa151b9243fc889ceb16233a7c836`. Setup, structural evidence and PHP properties passed; the required verdict correctly failed. Those uninstrumented failures do not identify the consumed phase.

[Instrumented hosted run 38997813082](https://github.com/xormania/uxor/actions/runs/38997813082), telemetry head `6e3920fd750e2edbb547f50e36eb5b0bc6475b31`, directly measured the optional probe consuming **218.990 seconds**, then `/lab` loading in **1.137 seconds**. Seven heartbeats in probe.prepare showed about:blank and no main requests. This observed budget sink supports avoiding the known crashing probe; it does not retroactively establish identical causes for earlier unclocked failures.

| Hosted diagnostic phase | Time | Outcome |
|---|---:|---|
| Probe context / page / CDP session creation | 9 / 29 / 3ms | Completed |
| Memory.prepareForLeakDetection probe | **218,990ms** | Unsuccessful |
| Probe-context cleanup | 55ms | Completed |
| Main navigation, after probe | **1,137ms** | 52 requests finished; no failed/pending request |
| Full long-session test | 236.5s | All original visits/counter bounds passed using existing fallback |
| Whole diagnostic workflow | 18m27s | 136 browser tests passed, no retries/skips; evidence/PHP/verdict passed |

[Diagnostic summary](evidence/hosted-diagnostic.json) and [primitive telemetry](evidence/hosted-telemetry.json) retain timestamps, log line references and source hashes. This was an observed telemetry run, not final-fix CI or a controlled performance benchmark. Final exact-head normal CI, full hosted Release and official reviews are pending at this commit; the fix PR records later checks and conversation resolution. No green candidate is inferred from historical or native results. The owner performs approval and merge.

## Runtime boundaries

Native full tests and real-browser pair use Node **22.23.3**, Playwright **1.58.2**, Chromium **145.0.7632.6** from the cached authorized Xorder image `ghcr.io/xormania/playwright-browser@sha256:a9af6ee615412e5e941c1e164beddd157e9eca4c1701e5a08e09f84c016ca9c6`, Debian13 Trixie, native PHP **8.4.26** and HTTP with an external router. Hosted CI uses Node22, PHP8.5/FrankenPHP HTTPS and Noble. Local unit/mocked and earlier 20-case initial sampling use Node **24.19.0**. Browser-version equality does not erase OS/server/TLS/history/scheduling differences.

An initial native baseline executed and failed both attempts before final counters because `/forms` returned500 from an unavailable PHP session directory. A supported PHP CLI session.save_path override corrected that local runtime; no application/test assertion changed. The subsequent original baseline passed first attempt32.152s. These environmental failures remain disclosed in [native baseline](evidence/native-baseline.json), separate from the intentional counter red.

Published hosted results/trace artifact digests remain metadata, not verified downloaded contents. Official workflow-log archives were downloaded and path/hash checked. The workflow captures complete Compose PHP logs to an uploaded file and prints only its last300 lines; the full captured file and failure-window coverage remain uninspected. [Capture-source proof](evidence/server-log-capture.json). No claim is made that the full log is absent or truncated.

The generic probe on other builds still catches all errors and suppresses cleanup failures. The controlled cancellation proof records that known risk; this narrowly scoped exact-build fix does not change it. Revisit the guard when the pinned browser changes, using the same capability/renderer/cleanup tests and full counter contract.
