# Checkout trust: CodeQL finding and regression proof

The first PR scan at `b683745735d52114b73214f83a47536f2b53cbe7` failed the required CodeQL check with three new high-severity cache-poisoning findings. All three trace to the same source: the target checkout accepted `needs.changed.outputs.ref`, a dynamic resolver output, while schedule/manual jobs can have the default branch's cache scope. The findings were investigated without suppressions, dismissals or changes to the scanning gate. [Original thread](https://github.com/xormania/uxor/pull/145#discussion_r4299557090); [retained check annotations](evidence/security-trust/codeql-before-annotations.json).

The target checkout now independently selects the maintained `refs/heads/dev` branch for a schedule and the immutable triggering `github.sha` for other events. A fully qualified branch prevents fallback to a same-named tag. The resolver output remains the frozen expected SHA, and the existing provenance shell must match it before setup or target commands execute. A substituted resolver value cannot authorize its own checkout. If development advances between resolution and checkout, the run fails closed and must retry; it never labels or executes the newer checkout as the earlier resolved target.

This policy trusts the repository's maintained development branch. It does not claim to sandbox malicious code already admitted to that branch. No cache permission, required check, browser assertion or verdict is weakened.

## Red and green evidence

The exact final regression evaluates the real workflow checkout expression, performs real isolated Git checkouts, and runs the real provenance shell before a sentinel target command. Its supported expression subset is deliberately small; this is not execution of the checkout action or a live cache service.

| Case | Required result |
|---|---|
| Substituted resolver SHA under schedule, manual dispatch or pull request | Independently authorized checkout differs; provenance exits 1; no tested identity or target command |
| Development advances after resolution | Exit 1 before target execution; retry required |
| Stable scheduled branch; unchanged manual/PR event SHA | Exact expected revision exported; target command executes |
| Development branch absent but a same-named tag exists | Fully qualified branch checkout fails |

[Unchanged final test against the historical workflow](evidence/security-trust/resolver-trust-red-final-test.json) exited 1 at its intended assertion: the old checkout and comparison both accepted the substituted schedule revision, so the target command ran. [Red output](evidence/security-trust/resolver-trust-red-final-test.log) is an assertion failure, not a missing-module or syntax failure. [The fixed focused run](evidence/security-trust/resolver-trust-green.json) passed all 46 cases. The red and green receipts carry the same test-source hash and distinct workflow hashes.

The [complete Node run](evidence/security-trust/full-node-tests.log) passed **219 tests, zero failed/skipped**. Pinned actionlint/ShellCheck, repository security policy, docs lint and the test inventory also passed. [Combined receipt](evidence/security-trust/receipt.json) hashes the exact workflow/test sources and retained logs. Raw logs preserve their original whitespace.

Run the current regression with Git and Node installed:

```bash
node --test --test-name-pattern='checkout trust rejects' tools/tests/release-checks-workflow.test.mjs
```

## Integration acceptance

This source-level proof cannot replace a fresh CodeQL scan and CI on the follow-up head. The [PR](https://github.com/xormania/uxor/pull/145) records that outcome, requested official reviews and conversation resolution. Full candidate Release execution and a genuine default-branch schedule remain separate boundaries. The owner performs the merge.
