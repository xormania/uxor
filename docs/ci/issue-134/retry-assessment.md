# WebKit retry: evidence and limits

[Original candidate CI](https://github.com/xormania/uxor/actions/runs/38880910402) passed, with one public warning: Search/Back/Forward at `tests/e2e/lab.data-table-back.spec.ts:127` failed deep equality and passed on retry 1 in [WebKit 3/3](https://github.com/xormania/uxor/actions/runs/38880910402/job/116907304798). Job was green in 8m57s; annotation ID `90152702200`.

Public warning shows only expected/received diff line counts and an array prefix. The actual received value is unavailable; an empty array would fit but is not proved. Full first-attempt logs/trace/artifacts could not be downloaded. Published artifact metadata in [run receipt](evidence/timings/run-observation.json) is not evidence their contents were read.

| Affected artifact | Published ID | Contents |
|---|---|---|
| WebKit 3 HTML report | `12037228738` | Unavailable |
| WebKit 3 result JSON | `12037213723` | Unavailable |
| WebKit 3 advisory diagnosis | `12037498034` | Unavailable |

## Concrete source observation

The [spec's recorder](../../../tests/e2e/lab.data-table-back.spec.ts) schedules a `requestAnimationFrame` callback from `turbo:before-render`, then saves values once new body is document body. `pageVisitDone` waits for `turbo:load` and [busy/preview cleanup](../../../tests/e2e/fixtures.ts); neither guarantees this recorder's callback committed a record. Earlier control/row assertions establish correct DOM, not recorder readiness. The immediate array assertion can therefore run before its observation exists.

That is a concrete missing observation barrier and a plausible explanation for the retry. It is **not the proved root cause of the actual failed CI attempt** without its complete diff/trace.

## Bounded proof and baseline relationship

The [retained result](evidence/flake/late-frame-observer-result.json) comes from the current extracted helper in real host Chromium `154.0.8037.57`, with animation-frame callbacks deliberately queued. Correct default controls existed while immediate captured-array assertion failed with `[]`. Releasing the queued frame yielded exactly `[DEFAULTS]` and passed.

The [portable probe](evidence/flake/late-frame-observer-repro.mjs) uses the clone's locked Playwright package, host Chromium and bounded timeouts. With dependencies installed and a host browser available:

```sh
node docs/ci/issue-134/evidence/flake/late-frame-observer-repro.mjs /tmp/uxor-frame-observer.json
```

Set `CHROMIUM_EXECUTABLE` if Chromium is elsewhere. This deliberately controls observation order; it does not execute Turbo, Symfony, WebKit, the CI image or the full scenario. No screenshot is taken or changed, and the replay output must remain outside tracked evidence paths.

[Source-equivalence receipt](evidence/flake/source-equivalence.json) compares full SHA-256s for 14 relevant spec/helper/controller/template/config/lock/workflow files between dev `40d957c` and candidate `c128aee`; all match. The spec predates this scheduler repair. Reporting changes execute after browser command and cannot change that already-recorded DOM state. This supports inherited susceptibility, not a claim that a prior baseline CI run exhibited the same flake or that all environmental effects are impossible.

## Follow-up disposition

Obtain first-attempt result/error/trace, establish actual values and event/recorder ordering, then repeat boundedly under pinned WebKit with retries disabled. If record absence is confirmed, wait for that specific observation before comparing immutable captured values. Keep exact first-frame values and additional-render detection; eventual current-DOM assertions cannot replace them. If records contain wrong values, investigate restoration behavior. Do not raise retries/timeouts or weaken equality to conceal the failure.

No unproved browser fix is added to this scheduler PR. No source assertion, retry policy, timeout or screenshot baseline was changed to make CI green. The observed recovered attempt remains disclosed.
