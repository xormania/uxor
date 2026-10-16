# Evidence receipts

This bundle contains selected authored receipts and scoped logs, not extracted repositories, mutated source trees, dependencies, generated Playwright report directories, raw HTML or opaque network responses. Absolute argv/cwd paths in retained receipts record the original execution context; they are provenance, not required local inputs. Log references resolve relative to their receipt file. Source paths inside JSON refer to the repository root; pinned commit/blob hashes identify historical source.

| Directory | Read first | Contents |
|---|---|---|
| [red-proofs](red-proofs/receipts.json) | Fourteen command receipts | Unchanged stdout/stderr bytes and SHA-256s, source Git trees/blobs/SHA-256s, exact commands/exits/assertions; actual historical replay and four controlled mutants |
| [implementation](implementation/global-setup-source-receipt.json) | Real global-error observation/source hashes | Curated real-process observation and error log; classifier regression red/green JSON/logs; sparse-checkout existence receipt |
| [timings](timings/run-observation.json) | Run observation | All jobs/steps, published artifacts and warnings, exact base-classifier selection replay, selected-file hashes |
| [flake](flake/source-equivalence.json) | Source equality | Fourteen source hashes; bounded observer probe and original measured JSON result |
| [checks](checks/local-test-receipt.json) | Working-tree test snapshot | Exact full-suite command, 218-case log, runtime and classifier/test hashes; [portable replay receipt](checks/portable-replay.json) |

[Bundle hashes](bundle-hashes.json) use repository-relative paths and SHA-256 of exact bytes. The manifest excludes only itself; it includes the completed `reproduce.py`; original per-command log hashes remain unchanged. Timing hashes cover the three selected immutable JSON receipts, not rewritten prose. Published GitHub artifact digests are observed metadata and are not listed as verified downloaded contents.

Replay historical/negative-calibration commands with [reproduce.py](../reproduce.py), reading its prerequisites and execution boundary first. Replay the observer ordering probe with its command in [retry assessment](../retry-assessment.md). Red proof requires the expected behavioral assertion; missing imports and syntax errors do not qualify.

Raw generated global-setup reports remain only in execution scratch. Their SHA-256s are recorded in the curated source receipt; the equivalent minimal report shape lives in the tracked regression test. This bundle does not claim they can be independently reconstructed byte-for-byte without that original runtime context.

Verbatim error logs preserve their original whitespace for hash verification. Source/document whitespace checks
exclude these recorded `.log` files; application and test source checks are unchanged.
