# Coverage, overlap and gaps

| Guarantee | Scope | Coverage |
|---|---|---|
| Exact known-crashing build selects fallback without allocating a probe | Unit and real-browser functional | Four permanent [helper cases](../../../tools/tests/leak-detector.test.mjs); same tests red against old adapted helper and green against actual module; actual Chromium145 pair verifies zero new probe contexts/commands/crashes. |
| Nearby/different builds keep capability probing and close contexts | Unit | New cases require command plus renderer survival before true, and false/cleanup after unsupported command or renderer failure. Nearby145.0.7632.7 prevents broad major-version matching. |
| Full traversal/memory measurement remains intact | E2E functional, native focused | Actual final spec/module passed first attempt29.852s with all50 measured visits plus16 warm-up round trips and unchanged counter bounds. Source hashes and generic-body equivalence retained. |
| A real retained-controller leak is still detected | E2E negative calibration | Original full test passes; a single ignored served-controller listener mutation fails the existing nodes bound in both configured attempts; all182 compiled files and controller restored exactly. |
| A final goto error need not identify the earlier consumed phase | Controlled diagnostic | Actual Test runner with mocked pending CDP:200ms timeout, teardown rejection, helper false return, then goto spy while timedOut. Not a real-browser/CI reproduction. |
| Hosted required verdict preserves failed acceptance | Workflow observation | Original135pass/1fail run remains red despite passing evidence/PHP. Instrumented136pass run remains separate from final-fix checks. |

**Reused:** original long-session spec, fixtures, Turbo/controller waits, cache-drop fallback, forced collections and four limits; existing one-worker/configured retry1/retained-failure tracing; always-on Tool tests. **New shared support:** [leak-detector.mjs](../../../tests/e2e/leak-detector.mjs) owns one helper implementation shared by actual E2E and permanent unit cases. No product browser fixture or screenshot matrix is duplicated.

| Overlap | Distinct boundary and disposition |
|---|---|
| Four unit cases and real Chromium old/fixed pair | Units prove exact identity and other-build branches; real pair proves actual module avoids known renderer crash. Keep both; fake objects alone do not prove browser behavior. |
| Native full run and sentinel | Positive verifies original measurement still passes; sentinel proves the existing oracle detects a real leak. Keep; a timeout or broken asset would not qualify as counter red. |
| Hosted clocks and mock timeout proof | Hosted sample directly identifies a long probe; mock explains why a later navigation stack can mislead. Keep separate; do not call mock a reproduction or apply measured phase timings to earlier runs. |
| Twenty initial-sequence cases and full native case | Initial sampling exercises traced probe setup repeatedly; full case validates traversal/counters. Keep bounded summaries, not another permanent repetition suite. |

## Remaining acceptance

- Final exact-head normal CI, full hosted Release, both official reviews and addressed conversation resolution are pending at this snapshot; the PR carries later results. Native focused success does not satisfy hosted full-suite acceptance.
- Earlier failing hosted attempts lack phase clocks. The219-second passing diagnostic sample identifies a concrete budget sink, not every prior failure's complete cause or a measured speedup for the final patch.
- Other-build generic probe cancellation/cleanup suppression remains unchanged. The exact-build guard is intentionally narrow; browser upgrades require deliberate revalidation.
- Hosted artifact ZIP contents/traces/full server file remain uninspected. Published artifact metadata is not downloaded-integrity proof.
- OS/PHP/TLS/cache/history differences remain between native and hosted runs. Local Node24 units/mocks differ from hosted/native-full Node22.
- Promotion and any default-branch workflow operation remain owner-controlled. This work does not approve or merge its change.
