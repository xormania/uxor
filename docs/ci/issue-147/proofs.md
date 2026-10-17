# Red/green calibration and preserved measurement

## Same permanent tests, old and fixed implementation

[Unit receipt](evidence/unit-red-green.json) uses identical four-case test bytes. Old helper is the immutable5b body with only TypeScript signature removal and an export for the new module boundary. It fails the known-build allocation tripwire (three pass/one fail); the actual final module passes all four. No missing import or syntax error qualifies. [Old output](evidence/unit-red.log) · [fixed output](evidence/unit-green.log).

Run the self-contained no-install replay with Python3 and Node installed:

```bash
python3 docs/ci/issue-147/replay-unit.py
```

It writes only a fresh temporary directory, verifies shipped source hashes, copies each unchanged test into its original relative import layout, requires old exit1/fixed exit0 with the intended failure text and rejects import/syntax failures. New output hashes are recorded; they are not expected to equal historical timing-dependent logs. Local full Tool tests also passed224 cases, zero failed/skipped, on Node24; [summary/source hashes](evidence/local-checks.json).

## Actual browser guard and full unchanged contract

[Actual production-module pair](evidence/browser-guard-pair.json) runs with a main page already allocated. Old helper creates one context, issues one detector command and crashes one renderer: the added zero-crash setup invariant fails. The actual final module returns fallback with zero probe contexts/commands/crashes and passes that same invariant. This negative invariant is separate from the existing memory oracle; it is not a mocked or missing-module failure.

[Actual fixed full test](evidence/fixed-full.json) passes first attempt29.852s, runner31.697s. It executes the same50 measured visits, two warm-up rounds,300s deadline/configured retry1 and original assertions. Documents5→5≤5; nodes6969→6969≤7517; listeners34→34≤56; heap5,490,324→6,059,448≤6,563,644 bytes. [Production provenance](evidence/fixed-provenance.json) records exact source/helper/config/runtime hashes and verifies the generic probe body is unchanged after type conversion. Native focused proof is not a hosted full136-test pass.

## Intentional real leak, genuine counter failure, exact restoration

[Sentinel receipt](evidence/sentinel.json) changes only one ignored generated date-picker controller line: an unremoved window listener closes over its controller/element. Browser trace network entries independently show the mutant hashed asset returning200 in each actual attempt; manual preflight is explicitly excluded.

| Full original contract | Result |
|---|---|
| Corrected native baseline | First attempt32.152s; nodes6969→6969≤7517 |
| Sentinel attempt0 |34.901s; nodes106,630>28,012; existing nodes assertion fails |
| Sentinel attempt1 |34.365s; nodes106,628>28,012; same existing assertion fails |

Both mutant attempts reach final sampling and emit counter annotations. This is leak sensitivity, not timeout/navigation/setup/asset/guard/import failure. Listener and heap annotations also exceed limits, but execution throws at the earlier nodes assertion; do not claim later assertions separately ran. [Restoration manifest](evidence/restoration-assets.json) and receipt confirm original controller bytes, exact182 compiled file hashes/file set, asset mapping and served original hash restored, no extras and clean tracked status. No sentinel enters product source or a committed baseline.

## Controlled timeout attribution

[Mock receipt](evidence/mock-cancellation.json) and [ordered phases](evidence/mock-phases.jsonl) retain the deliberate200ms test: actual Playwright timeout begins custom fixture teardown, mocked CDP rejects, unchanged helper catches it and returnsfalse, then goto spy runs while status is timedOut. One immediate-known-error control passes. No real browser/app/CDP is used. This proves a control-flow possibility; it does not prove the earlier CI timeout followed that lifecycle. The production300s test is unchanged.
