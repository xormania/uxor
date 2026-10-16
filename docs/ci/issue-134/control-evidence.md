# Control-owned structural evidence

The once-requested official code review on `1a5e610c9c9d55ee643164d7017316315c1a0bed` found that the runner loaded `tools/ci/release-evidence.mjs` relative to the target working directory. A target revision could accidentally delete or incompatibly change the checker; an always-successful replacement could also bypass the fixed project/spec contract. [Review finding](https://github.com/xormania/uxor/pull/145#discussion_r4299791048).

The runner now resolves the checker beside its own module with `fileURLToPath(new URL('./release-evidence.mjs', import.meta.url))`. That keeps validator implementation in the workflow's revision-pinned control checkout while selection and report paths remain target-owned data. The existing selection-schema and complete-project/spec checks remain fatal. The target's checker is never invoked by this evidence command.

This fixes validator selection and compatibility. The maintained target remains trusted code on the same runner filesystem; this change does not create process isolation or prevent arbitrary deliberate filesystem writes by that code.

## Same-source red and green proof

One new process regression copies the real runner and checker into an isolated control directory and launches them from a separate target directory. It exercises both supported project families with the same real evidence CLI, using a stub browser launcher only to produce selection/report data.

| Target state | Required control result |
|---|---|
| Always-successful checker; report lacks a project, required spec, required execution or the entire report | Exit 1 from control validation |
| Incompatible checker that exits 97; complete report | Exit 0 using the control checker |
| Checker deleted; complete report | Exit 0 using the control checker |

A target sentinel additionally proves that its replacement checker never executes. Existing evidence parser cases are reused; this regression adds the ownership/handoff boundary, not another complete parser matrix.

[The unchanged final test against the old runner](evidence/control-evidence/control-evidence-red.json) fails at the intended assertion: an incomplete project report incorrectly exits 0 through the target's always-successful checker. [Red output](evidence/control-evidence/control-evidence-red.log) is an assertion failure. [The fixed run](evidence/control-evidence/control-evidence-green.json) passes all 50 focused cases, including the existing evidence CLI suite. The paired receipts contain the same test hash and distinct runner hashes.

The complete tool suite passes **220 cases, zero failed/skipped**; [suite log](evidence/control-evidence/full-node-tests.log) and [source/log receipt](evidence/control-evidence/receipt.json) identify that snapshot. Current regression command:

```bash
node --test --test-name-pattern='control evidence rejects' tools/tests/release-checks.test.mjs
```

Fresh hosted CI and candidate Release execution after this runtime correction are recorded in [PR 145](https://github.com/xormania/uxor/pull/145). The earlier passing Release run and earlier green head are historical evidence. Both official reviews were requested exactly once after CI was green on `1a5e610`. The code review returned the finding above; [security review completed without findings](https://github.com/xormania/uxor/pull/145#issuecomment-6225698513). This follow-up implements the code finding; the PR records later validation and conversation resolution. No additional review request is made. The owner performs the merge.
