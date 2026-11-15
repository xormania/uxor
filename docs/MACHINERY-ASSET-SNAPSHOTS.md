# Frontend validation from captured facts

Date: 2026-11-10. Status: experimental runtime machinery.

The recovered frontend validator mixed dependency decisions with installed-file reads.
It now consumes a `FrontendSnapshot`: package metadata and provenance, canonical local
file identities, selected imports, and any failed observations. Pure callers can supply
those facts without Composer, AssetMapper, an HTTP request, or an installed filesystem.

`FrontendSnapshotReader` owns path canonicalization, file existence, metadata hashes and
package containment checks. It captures only recognizable local references; declaration
shape, range, ownership, entrypoint and compatibility rules stay in
`FrontendContractValidator`. A missing or unreadable metadata file becomes a failed
observation. It cannot disappear into an empty successful package set.

`FrontendAssets` remains the Symfony adapter. It reads Composer and AssetMapper state,
captures the snapshot, and invokes the policy. The command's report and compile guard
use the same path. The bundle registers the reader explicitly.

Snapshots detach nested PHP array references so later caller mutations cannot change
captured facts. Objects, resources and cyclic references are rejected; malformed scalar
declarations are retained for policy validation. The reader also leaves caller-owned
selection arrays unchanged.

A snapshot records one observation. If an installed file is later removed, validation of
that captured snapshot still describes its original state; a fresh capture rejects the
missing file. The snapshot is not an authorization certificate or an atomic Composer
transaction. Normal commands and asset compilation capture current state on each run.

## Verification

```bash
php tools/tests/frontend-contract.php --policy-only
php tools/tests/frontend-contract.php
php tools/tests/frontend-reader.php demo/vendor/autoload.php
```

The first command supplies synthetic registry and local-file facts with no filesystem
fixtures. It checks provenance, mismatched selections, missing imports and failed reads.
The full run retains the recovered compatibility scenarios and adds capture/recapture,
missing or escaping metadata and unreadable metadata checks. Existing reader cases cover
Composer discovery, malformed JSON and import-map diagnostics. These tests do not claim
automatic stylesheet aggregation, a dependency solver, or production upgrade coverage.
