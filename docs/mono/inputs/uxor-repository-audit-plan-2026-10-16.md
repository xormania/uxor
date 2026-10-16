# UXor repository audit plan

Prepared: 2026-10-16, America/New_York  
Intended auditor: 6.1 Sol  
Primary repository: https://github.com/xormania/uxor  
Deliverable: one evidence-backed audit and change-inventory document  
Status: audit plan; repository implementation and settings changes are a later step

Audit the whole existing UXor system and identify the concrete work needed to make it coherent, maintainable, and ready for the selected single-repository direction. Cover product code, packaging, tests, local development, CI, every workflow and action, GitHub governance, releases, documentation, and configuration ownership. Find existing defects and unnecessary complexity as well as migration changes.

The result must let xor decide what to do and in what order without asking another agent to rediscover the repository. Every recommended change needs an exact location, evidence, a reason, its affected consumers, and a way to verify the result. An area that is already sound should be recorded as such; the audit is not an instruction to rewrite everything.

## 1. Direction and evidence

### Selected direction

Use the two supplied documents together:

- `uxor-single-repository-plan-2026-10-16(1).md`: one active UXor repository, implementation under `packages/uxor/`, removal of uxorscient as an active product identity, Composer delivery alongside the existing Toolkit kit, and coordinated CI and release work.
- `uxor-configuration-concept-2026-10-16(1).md`: a small, discoverable set of authoritative configuration sources; explicit consumers and propagation; native tool configuration retained where it owns the concern.

The first document distinguishes selected direction from proposed implementation. Preserve that distinction. Root Composer metadata, exact public identifiers, shared versioning, archive treatment, and CI organization must be verified against current code and external requirements. A difference from a proposal is not automatically a defect.

Existing Toolkit recipes still become application-owned files when installed. The proposed Composer package delivers agent guidance and development tooling. Do not silently turn the migration into vendor-managed UI components, a theme platform, or a replacement for Symfony UX Toolkit. If the audit discovers that the stated goal needs an additional capability, explain the dependency rather than narrowing the goal or implementing a redesign.

xor's current direction takes precedence over earlier plans and repository wording. Separate useful capabilities from obsolete names, paths, and assumptions. Where competing meanings cannot be reconciled safely, record a specific owner decision and its consequences.

### Preparation snapshot

These navigation facts were checked while preparing this plan. Sol must refresh them at audit start; they are not completed audit findings.

| Surface | Observed starting point | Audit implication |
| --- | --- | --- |
| UXor development branch | `dev` at `40d957cd1ea7766ac0dee742816948ce5ae05bc3` | Inspect a fixed commit and record subsequent drift. |
| UXor default and promotion branch | `main` at `9b2fa7309786cee435503de87cf0cd5f0a9d9782` | Compare `dev` and `main`; do not import `master` assumptions from another repository. |
| Merge settings | Merge commits enabled; squash and rebase disabled | Reconcile actual settings with repository instructions and migration/history proposals. |
| Workflow inventory on `dev` | Nine workflows, listed below | Inspect every workflow, including scheduled and advisory ones. |
| Local action inventory on `dev` | `.github/actions/jev-diagnosis/action.yml` | Follow action calls and their scripts, not only workflow YAML. |
| Ruleset list | Active `dev`, `main`, and `work-orders`; disabled `MergeCommitsOnly` | Names and enforcement flags do not establish the effective rules. Read details, conditions, and overlapping protections. |
| Former companion baseline in the supplied plan | `xormania/uxorscient` at `614aa28fd937baa9feffa7730d02b58dc73afe18` | Refresh its branches and pending work before building the import inventory. |

The nine current workflows are `audit.yml`, `ci.yml`, `codeql.yml`, `jev.yml`, `metadata.yml`, `monthly.yml`, `pages.yml`, `release-checks.yml`, and `release.yml`, all under `.github/workflows/`.

Preparation sources: [repository metadata](https://api.github.com/repos/xormania/uxor), [branches](https://api.github.com/repos/xormania/uxor/branches?per_page=100), [development tree](https://api.github.com/repos/xormania/uxor/git/trees/40d957cd1ea7766ac0dee742816948ce5ae05bc3?recursive=1), and [ruleset list](https://api.github.com/repos/xormania/uxor/rulesets?includes_parents=true&per_page=100). GitHub settings are time-dependent; final findings must include their observation time.

## 2. Audit boundaries

This pass is read-only against repository source and live services. Produce the audit document and supporting evidence. Do not push code, open or edit PRs, request reviews, resolve threads, merge, change rulesets, dispatch workflows, publish, rotate credentials, or retire the former repository as part of the audit.

Read both repositories where necessary to understand the import and preserve existing functionality. UXor is the primary audit target; the former companion is an import source and compatibility reference. Consult xorder and other dependencies when UXor actually consumes them. Do not extend the assignment into an unrelated audit of those projects.

Use isolated scratch checkouts and disposable fixtures for existing local checks and reproductions. Inspect commands before execution; a nominal dry run may still contact services or write state. Local generated output is evidence, not a source change. Record commands, environment, commit, and result. Installation or browser evidence unavailable in the environment remains unverified; static review does not substitute for it.

Inspect credential bindings and permissions only through safe metadata. Never print secret values or copy credentials into the report. If an API or connection cannot expose a setting, record the exact missing read and continue with the rest. Permission failures and unsupported endpoints do not mean a feature is absent.

Read root and applicable nested agent instructions, `CONTRIBUTING.md`, the PR template, security guidance, current recipe contracts, and testing documentation. Their established behavior is evidence to reconcile with the new direction. Historical plans and instructions from other repositories are not substitutes for current UXor facts.

## 3. Work sequence

| Pass | Work | Required output before moving on |
| --- | --- | --- |
| A. Establish the baseline | Refresh branches, commits, open work, tags, instructions, settings access, and the two input documents. | Baseline record, decision assumptions, and access gaps. |
| B. Build the complete inventory | Enumerate tracked paths, runtime entry points, tests, config, workflows, actions, generated files, and external settings. | Coverage ledger and a map of producers, consumers, and ownership. |
| C. Audit each domain | Apply the domain checks below, following actual call and dependency relationships. | Evidence-backed findings and explicitly assessed areas with no change needed. |
| D. Reconcile across domains | Trace installation, development, PR, release, and update journeys end to end. | Missing links, contradictory contracts, configuration ownership proposal, and dependency map. |
| E. Verify important findings | Run existing focused checks or disposable reproductions; inspect representative historical runs. | Confirmed findings separated from hypotheses and unverified operational facts. |
| F. Produce the final change inventory | Deduplicate findings, sequence work, identify coupled changes and owner decisions, and check coverage. | One self-contained final document meeting section 10. |

Do not select a new configuration format or divide the work into PRs before the ownership and dependency inventory exists. Conversely, do not defer a concrete finding until every domain is finished: record evidence while it is available.

## 4. Complete inventory and evidence method

Begin with the entire tracked tree, including repository control files. Use a local Git inventory where available or a complete recursive API tree. Check truncation and pagination explicitly. Enumerate open PRs and active branches separately; unfinished work is not implemented functionality.

For each tracked file, assign an area and disposition: directly reviewed; generated output checked against its source; fixture reviewed with its consumer; asset or baseline inspected for its relevant role; external/vendor content accounted for; or not yet inspected. Group repetitive assets only when the underlying exact file list remains available. A few representative recipes are not adequate coverage of all recipe implementations.

Search with `rg` to locate names, paths, versions, URLs, environment variables, and commands, then inspect the surrounding definitions and callers. Search results alone do not establish absence, reachability, or shared ownership. Follow computed paths, globs, Composer autoloading, service discovery, template includes, JavaScript imports, workflow calls, and generated references.

For source findings, cite commit-pinned paths and line anchors. For live settings, record the repository, setting or ruleset ID, exact field, observation time, and API/UI source. For CI evidence, include run ID, attempt, event, ref, commit, job/check name, conclusion, and the relevant logs or artifact. Label evidence as source-inspected, executed, historical-run evidence, or inference.

Retain an explicit coverage ledger:

| Scope | Exact inventory or source | Review method | Status | Findings | Remaining gap |
| --- | --- | --- | --- | --- | --- |
| Each source area, workflow/action, and live-setting family | Paths or endpoint and timestamp | Inspection, execution, derivation check, or historical evidence | Assessed / partial / inaccessible | Finding IDs or no change needed | Specific missing evidence |

Keep facts, target requirements, and recommendations separate. A duplicated string is an investigation lead, not proof that it should be centralized. A passing workflow is evidence about the work that ran, not proof that every intended guarantee was exercised.

## 5. Domain audit

### 5.1 Product code and recipe contracts

Inspect every recipe and shared module: manifests, Twig components and blocks, PHP, Stimulus controllers, CSS, service/config fragments, examples, and imports. Include code in the demo and test/tool support; do not limit code review to files that will move.

- Compare declared dependencies and copy/install rules with files and symbols actually used. Trace cross-recipe imports, shared modules, namespace/autoload assumptions, template paths, and asset resolution in a fresh consumer.
- Review behavior, error paths, dead or duplicated logic, broken extension points, resource cleanup, and accidental coupling to the demo. Distinguish reusable product code from demo fixtures and mocks.
- Verify the existing contracts around Stimulus, Turbo Drive/cache/history, Frames/Streams, permanent elements, and Live Component re-renders. Include listener cleanup, reconnection, focus, state preservation, and async races where applicable.
- Trace AssetMapper/importmap and Tailwind/Flowbite use, CSS ownership and ordering, theme roles, CSP compliance, keyboard behavior, accessibility, responsive behavior, and reduced motion. Confirm how tests prove these contracts.
- Inspect actual security-sensitive boundaries: rendered or sanitized content, Markdown/editor previews, uploads, URLs/redirects, OAuth/session/CSRF handling, trusted demo execution, and CLI/file inputs, where present. A mocked demo flow is not proof of a complete production integration.
- Compare documentation promises with implemented capabilities and tests. Classify missing implementation, broken implementation, misleading documentation, and future capability separately.

Output: per-area findings and a capability map showing implementation, public contract, tests, and migration impact. Recommend extraction or consolidation only where it simplifies a verified relationship without erasing required independence.

### 5.2 Package import, identity, and distribution

Inventory the former companion's actual CLI, classes, Mate tools/resources, skills, reference generators, configuration, tests, independent consumer, Docker support, and Serena support. Map every imported capability to its proposed destination or give an explicit reason and consequence for another disposition.

- Verify repository-root Composer metadata with implementation under `packages/uxor/`: autoload, development autoload, binaries, service includes, Mate discovery, scripts, resource paths, and licenses.
- Trace every relative path and working-directory assumption in installed use, direct repository use, CI, containers, generators, and test fixtures. Identify code that assumes its parent is the repository root or every top-level directory is a recipe.
- Separate the package, demo, and independent consumer dependency environments. Check dependency constraints, root-only Composer settings, required plugin authorization, lockfile roles, and development-only versus consumer runtime needs.
- Map active names, PHP namespaces, executable names, Composer identity, tool IDs, resource URIs, environment labels, URLs, and generated material. Preserve historical attribution and intentional regression fixtures. Do not apply a blind repository-wide rename.
- Inspect actual consumers and pending source PRs before proposing aliases, `replace`, deprecations, or retirement. Record import provenance and any history decision; GitHub reviews and discussions require their own references.
- Inspect `.gitattributes`, ignore/archive settings, symlinks/file modes, package payload checks, and both Composer and GitHub/Toolkit archive routes. Required installed resources must be in the shipped payload; development exclusions must not remove them.
- Verify the Toolkit discovery and lint behavior for the supported version. Evaluate the proposed temporary lint view without hiding unexpected directories or treating `packages/` as a fake recipe.
- Require independent evidence for archive installation, initialization, repeated discovery, update, consumer-authored content preservation, and application operation after development dependencies are removed. Test both delivery routes from the same candidate commit.

Output: import map, public-identifier map, distribution contract, exact path/config changes, and the compatibility questions that need evidence or xor's decision.

### 5.3 Tests, guarantees, and diagnostics

Inventory recipe tests, demo PHPUnit tests, browser specs, tool tests, installation tests, static export checks, release tests, monthly analyses, security checks, and generated testing inventories. Start from `docs/TESTING.md`, `docs/TEST-INVENTORY.md`, and the actual test configuration; reconcile all three.

- Map each promised guarantee to the test that asserts it and the CI route that runs it. Distinguish assertion coverage from simply listing a test, route, or component.
- Find omitted areas, overlapping tests with no independent value, weak assertions, implementation-mirroring tests, stale fixtures, tests of mocks only, quarantine/skips, retries that hide failures, and incomplete failure handling.
- Check unit, integration, browser, install/update, and production-without-dev-dependency boundaries. Preserve the independent consumer's purpose alongside the demo.
- Examine browser projects, shard completeness, timing inputs, fallback behavior, test discovery, lifecycle setup/teardown, ports, timeouts, and supported platform/version coverage.
- Review screenshot baselines and refresh policy, flaky evidence, artifact completeness and retention, first-failure visibility, attempt-aware JUnit/Playwright parsing, and diagnostics under cancellation or partial failure.
- Verify which code and languages static analysis, CodeQL, audits, coverage, and mutation tooling actually examine. A green analysis job does not imply coverage of every language or runtime boundary.
- Treat Jev output and timing/coverage reports according to their actual advisory or gating role. Check provenance and links from a diagnosis back to the original failure.

Output: guarantee-to-test-to-check map, missing and redundant evidence, and targeted validation changes. Do not recommend a new test for every mechanical edit; identify the concrete risk each proposed test addresses.

### 5.4 CI selection, execution, and aggregate result

Trace the classifier, workflow DAG, job conditions, matrices, dependencies, caches, artifacts, and aggregate result. Start with `tools/ci-changes.sh`, its tests, `.github/workflows/ci.yml`, and the CI reporting helpers.

- Verify base/head selection for feature branches, PRs, work orders, promotion, and manual runs. Inspect merge-base handling, renamed/deleted files, unknown paths, shallow histories, and large changesets.
- Verify which revision supplies classification and control logic. A change must not silently bypass its own required validation. Account for newly introduced jobs and configuration that the base classifier does not yet understand.
- Map each changed input, including indirect inputs, to expected checks. Cover package-only, recipe-only, documentation/reference, root Composer, archive, environment, workflow/action, and classifier/configuration changes.
- Inspect `CI result` against planned work, all actual job outcomes, missing results, skips, cancellations, `continue-on-error`, matrix fail-fast, and failures in the classifier or orchestration itself. A skip is acceptable only when its reason matches the execution plan.
- Check intentional draft-work-order behavior and transitions to ready status. Reconcile reruns, head changes, push/PR events, and the exact commit counted by branch rules.
- Identify redundant push/PR/manual/scheduled execution, unnecessary full matrices, repeated installs/builds, cache misses or unsafe reuse, and duplicate artifact processing. Preserve existing guarantees when proposing savings.
- Verify cache producer/consumer pairs and isolation by dependency root, lockfile, toolchain, operating system, and relevant inputs. Separate a dependency cache from an artifact intended to represent tested source.
- Assess concurrency groups, cancellation, timeouts, runner capacity, build/test resource usage, and failure artifact handling.

Use recent run data to support optimization. Start with a stated 30-day window and extend it for missing release/monthly routes. Record sample sizes, workload mix, queue/setup/test time, cache outcomes, retries, and critical-path effects. Do not claim a speedup from YAML inspection alone.

Output: execution and check map, change-selection matrix, correctness gaps, and measured or explicitly hypothetical optimization opportunities.

### 5.5 Every workflow and action

Inspect all nine currently listed workflows plus anything added by audit time. Include disabled workflows and manual, scheduled, release, Pages, metadata, security, Jev, and maintenance routes. Follow every local or remote `uses` entry and recursively resolve reusable workflow/composite-action relationships relevant to behavior.

For each workflow/job/action, record:

- Purpose, owner, callers, events, branch/path/activity filters, inputs/defaults, outputs, conditions, check names, and scheduled timezone/ref assumptions.
- Checkout/ref provenance, working directory, invoked scripts, external tools/images/actions and pins, runtime compatibility, and update mechanism.
- Permissions, secret bindings, environments, runner selection, fork/Dependabot behavior, untrusted input handling, and any write/deployment capability.
- Dependencies, reusable-workflow/composite-action interfaces, artifact/cache contracts, concurrency, cancellation, timeout, retry, and failure behavior.

Inspect trust transitions such as PR-to-privileged-workflow handoffs, `workflow_run`, artifacts consumed with credentials, dynamic expressions entering shells, and executable content from a changed checkout. Check the existing `tools/security-policy.mjs`, its inputs, and its tests against actual behavior.

Recommend a shared script when local and CI use the same operation; a composite action when runner-step setup is shared; or a reusable workflow when a job-level contract is shared. Justify each extraction by its callers and behavior. Do not replace understandable repetition with an opaque orchestration framework.

Output: a complete workflow/action register and proposed retain, simplify, combine, extract, replace, or retire dispositions with evidence.

### 5.6 GitHub rulesets, protection, and repository settings

Read live settings independently from repository documentation. Retrieve all rulesets, each ruleset's details, effective branch rules, and classic protection where accessible. Check inherited rules if applicable. Include branch and tag targets, inactive/evaluate rules, conditions/exclusions, bypass actors/modes, and overlapping requirements.

Build a matrix for `dev`, `main`, representative work-order parent and job names, normal feature branches, release tags, and any other protected pattern discovered. Use concrete representative names when testing wildcard applicability.

For each target, compare:

- Required PRs, review counts, CODEOWNERS reviews, stale approvals, last-push approval, conversation resolution, and applicable review automation.
- Required status contexts and their expected source app/integration, required workflows, security/analysis requirements, up-to-date requirements, and merge-queue behavior if configured.
- Merge methods, linear-history or signing requirements, force-push/deletion/create restrictions, bypasses, and release-bot needs.
- Actual check names emitted by workflows, including reusable/matrix names, duplicate contexts, events that do not emit them, and workflow filtering that leaves a required check pending.

Inspect CODEOWNERS path coverage and precedence, the base-branch version used for reviews, and ownership of workflows, security policy, package paths, generated config, and release controls. Verify relevant access where visible; a CODEOWNERS subdirectory is not a separate repository permission boundary.

Inspect repository merge/default-branch settings, Actions policy and token defaults, fork approvals, environment protections, Pages deployment settings, artifact retention, runner availability, relevant app/webhook bindings, and update/security automation where accessible. Record only non-sensitive metadata. Existing connections may not expose administration endpoints even when repository metadata reports broad user permissions.

Output: current-versus-proposed governance matrix and exact setting deltas, each tied to a concrete workflow or ownership requirement. Read effective rules as well as the list of rule definitions. Preserve unknowns rather than filling them from memory.

Useful read-only endpoint families include repository metadata; branches; rulesets and ruleset details; `rules/branches/{branch}`; classic branch protection; workflow definitions/runs/jobs; commit check runs and statuses; environments; and Actions permissions. Use only endpoints supported by the available authenticated tool, and record any inaccessible family for owner verification.

### 5.7 Configuration ownership and streamlining

Build this inventory while inspecting all domains, then consolidate it. Search for repeated or conflicting names, paths, URLs, tool/image versions, dependency assumptions, test matrices, command sequences, environment inputs, policy settings, and generated facts.

Start with existing owners, including Toolkit manifests, Composer manifests, package manifests/locks, `tools/kit-identity.mjs`, `tools/playwright-image.json`, `.xorder/testing.json`, `tools/ci/jev-ci.json`, and native application configuration. Their presence is a starting point, not proof of correct ownership or complete propagation.

For each shared decision record:

| Field | Required content |
| --- | --- |
| Meaning | What decision the value expresses, and whether it is identity, policy, compatibility, resolved dependency, or environment choice. |
| Current declarations | Every authored copy and derived representation, with exact paths/keys or external setting fields. |
| Proposed owner | Existing native metadata where suitable; justification if a new shared source is needed. |
| Consumers | Code, scripts, workflows, tests, generators, docs, and external services that depend on it. |
| Propagation | Direct read, deterministic generation, consistency validation, or intentionally independent ownership. |
| Overrides | Allowed scope, precedence, defaults, provenance, and validation of missing/invalid values. |
| Verification | Evidence that a change reaches all consumers and that the resulting behavior remains correct. |
| Removal | Superseded declarations, helpers, exceptions, and documentation to remove together. |

Do not collapse supported dependency ranges, resolved lockfiles, CI compatibility matrices, image contents, and machine-specific overrides into one ambiguous version. Similar values may express independent requirements. Each recipe may still need its native manifest.

Check feasibility before promising centralization: GitHub evaluates some fields before runner steps, so a file loaded later cannot automatically supply all triggers, permissions, action references, or other early configuration. For each proposed generated native file, define bootstrap, regeneration, source markers, deterministic output, stale-output checks, and how tagged source contains the required result.

Account for GitHub-hosted settings as configuration with their own owner and synchronization/drift approach. If proposing declarative settings management, explain who would apply it and its operational cost; do not introduce a settings writer in this audit. Keep credentials out of shared config.

Output: the smallest justified ownership map, all affected consumers, concrete consolidation candidates, intentional exceptions, and the expected number of authored edit locations before and after. Recommend effective-value diagnostics where they resolve observed ambiguity.

### 5.8 Local development and agent orientation

Trace a new maintainer and a consuming-app agent separately. Verify working directories, setup commands, Docker/Compose and native execution, Symfony/FrankenPHP behavior, xorder references, mounts, service names, health checks, port/environment overrides, proxy/CA assumptions, and reproducibility from a clean checkout.

Review Mate and Serena setup, discovery, session/recovery behavior, available diagnostic entry points, and production separation. Inspect both existing UXor support and the former companion's support before proposing a single developer entry point.

Map root and nested agent instructions, `FOR-AGENTS.md`, `llms.txt`, consumer guidance, and packaged skills/resources to their intended audiences. Find stale roots, names, commands, paths, conflicting instructions, and misleading examples. Give an agent a clear route from a shared decision to its owner, regeneration command, and affected checks.

Output: setup and operating-path changes, environment ownership, and a concise proposed repository map. Preserve intentional demo/consumer differences; consolidate behavior and shared facts where justified.

### 5.9 Release, Packagist, and publication

Trace the actual release planner, changelog, promotion PR, CI result, install checks, selected candidate commit, tag, GitHub release, Pages deployment, and proposed Packagist refresh.

- Verify which commit each stage reads, tests, archives, tags, and publishes. Account for branch advancement, reruns, older releases, artifact reuse, and promotion merge behavior.
- Verify root package metadata, public identity availability/access, tag/version compatibility, and package registration requirements against current Composer/Packagist documentation.
- Assess the proposed shared version sequence and migration of consumers. Consider breaking changes on both Toolkit and tooling surfaces; avoid accidental loss of existing upgrade capabilities.
- Ensure proposed publication uses distribution evidence for the actual release commit and separates code execution from publication credentials.
- Inspect how publication is invoked; do not assume a tag created by a workflow token triggers another workflow. Account for retries, partially completed publication, asynchronous indexing, and verification of version/source reference.
- Compare recovery documentation with tag immutability and consumer impact. Flag incompatible policies for decision rather than adopting tag deletion or movement as routine recovery.

Output: release dependency map, missing gates/integrations, exact settings or bindings needed, and a retry/recovery proposal. Public metadata alone cannot prove authenticated Packagist ownership or permission.

### 5.10 Documentation, generated material, and remaining work

Reconcile README/install/contributor/security guidance, PR templates, community files, manifests, testing inventories, existing plans, release support policy, and generated agent material with code and live settings. Include documentation embedded in executable previews and packaged resources.

Identify each generated section/file, its source, generator, consumers, update trigger, and stale check. Check that generators cannot validate the same mistaken assumption without independent behavioral evidence. Preserve meaningful historical records while removing obsolete active instructions.

Review open PRs, unresolved review findings, relevant issues, and active branches in both repositories. Record implemented, pending, superseded, or abandoned work with source links. Do not recreate work already underway or silently discard a capability when planning the import.

Output: exact documentation/generation changes and an outstanding-work reconciliation linked to the change register.

## 6. Cross-domain scenarios

Use these as audit traces. First inspect how existing code and evidence handle them; run targeted local checks only where needed. A future acceptance scenario is not a claim that it already passes.

| Scenario | Relationships to verify |
| --- | --- |
| Clean repository setup | Instructions → configuration → environment → shared local checks → CI equivalents. |
| New recipe or recipe dependency change | Manifest → installed files/imports → demo → tests → generated catalog → classifier. |
| Package-only change | Package paths → archive → package/consumer checks → aggregate gate without unrelated full browser work. |
| Shared path, metadata, or archive change | Configuration owner → every consumer → both installation routes → release evidence. |
| Guidance or skill update | Authored source → generated/reference payload → installed discovery → consumer-owned content preservation. |
| Dependency/tool/image update | Constraint or pin owner → locks/matrix/environment → updater configuration → actual executed versions. |
| Delete/rename or unknown directory | Tree/classifier → stale imports/references → lint/archive rules → explicit failure or intended selection. |
| Feature PR and work-order job | Event/ref → trusted classifier → selected checks → actual check contexts → effective branch rules. |
| Draft work order becomes ready | State transition → full intended validation → latest tested commit → final merge gate. |
| Skipped, failed, cancelled, or partially rerun jobs | Execution plan → job outcomes/artifacts → aggregate result → merge eligibility. |
| Release and interrupted publication | Candidate SHA → install proof → immutable tag/release → indexing/deployment → retry of the same release. |
| Installed update and removal of dev dependencies | Distributed payload → tooling update → preserved custom code → surviving production application. |

Where a scenario cannot be exercised, specify the exact missing evidence and proposed later acceptance check. Continue auditing other scenarios.

## 7. Findings and proposed changes

Use stable IDs such as `UXOR-AUD-001`. Do not produce an unstructured list of suggestions.

Each finding must contain:

1. **Summary and category:** migration requirement, existing defect, maintainability/configuration improvement, documentation mismatch, or owner decision.
2. **Evidence and confidence:** pinned files/lines, settings or run evidence; observed versus inferred; reproduction if available.
3. **Current behavior and impact:** what fails, becomes confusing, duplicates ownership, or prevents the selected direction, and who is affected.
4. **Required outcome and proposed change:** concrete behavior and exact paths/keys/settings; options where the choice is unresolved.
5. **Affected consumers and preservation requirements:** downstream callers, install/runtime boundaries, data or user customization to retain.
6. **Dependencies and coupling:** other finding IDs, existing PRs, generated outputs, check-name/settings changes that must land together.
7. **Acceptance evidence:** existing check to run/extend, targeted reproduction, independent consumer result, or live-setting readback needed later.
8. **Priority, effort, and risk:** release/migration blocker; necessary before migration completion; follow-up improvement; rough size with rationale; implementation and rollback considerations.
9. **Execution location:** repository code/docs, GitHub settings, external registry/service, or explicit owner action.

Keep urgency distinct from certainty: an unverified high-impact risk is not a confirmed critical defect. Record already-compliant areas in the coverage ledger. Do not turn an owner preference into a mandatory task without identifying the decision.

Deduplicate related symptoms into one change when they share an owner and fix, but list every affected location. Keep independent causes separate even if their visible symptom is similar. Include remove/retire work only when the replacement and remaining consumers are accounted for.

## 8. Implementation sequencing proposal

Derive work packages from the completed register, rather than assigning a PR to each directory. A likely ordering to evaluate is:

1. Resolve blocking facts and decisions; reconcile open work and import provenance.
2. Establish any configuration owners and shared entry points needed by the migration.
3. Land tightly coupled package paths, metadata, archive, lint, and minimum CI changes together where splitting would break the repository.
4. Complete consumer integration, generation, and environment consolidation; update guidance alongside changed behavior.
5. Finish CI/workflow improvements and align live required checks/settings with checks that actually exist and have passed.
6. Complete release and Packagist preparation, then handle transition/retirement actions when xor chooses.

Change this order when evidence requires it. Identify independent work, atomic groups, and dependencies explicitly. For renamed checks, propose an overlap sequence that avoids both an unprotected merge window and an impossible required check. Do not recommend temporarily disabling protections as routine migration mechanics.

For each proposed work package give its goal, finding IDs, files/settings, prerequisites, acceptance evidence, and any separate owner action. Follow the current UXor merge/review process; do not import older squash policies or initiate review comments during the audit.

## 9. Completion criteria

The audit is complete when:

- The current baseline and the input documents are identified, with branch/settings drift and pending work accounted for.
- Every tracked source area, recipe, workflow, local action, external action relationship, and in-scope settings family has a recorded disposition.
- The companion capability/import map accounts for preservation, relocation, or an explicitly justified alternative for each capability.
- Every claimed guarantee can be followed to its implementation, test evidence, execution route, and applicable merge/release gate, or has a recorded gap.
- Configuration proposals identify existing declarations, owners, consumers, propagation, overrides, verification, and what duplication they remove.
- Required checks reconcile with effective rules and observed emitted contexts for the relevant branch/event paths.
- Each change is evidence-backed, actionable, prioritized, and linked to dependencies and acceptance criteria.
- Runtime checks, historical evidence, static review, assumptions, and unavailable access remain distinguishable.
- The final cross-domain pass finds no unexplained omissions in the coverage ledger; remaining gaps have concrete retrieval or verification steps.

Completeness means accountable coverage of the inventory, not a claim that inspection proves the absence of every possible bug. Do not label the result exhaustive while silently omitting settings or source areas that could not be read.

## 10. Final document contract for Sol

Produce `uxor-repository-audit-and-change-inventory-YYYY-MM-DD.md` with this order:

1. Executive assessment: what is sound, what blocks the selected direction, and what xor must decide.
2. Baseline, scope, evidence method, access limits, and relevant drift.
3. Current repository/capability map and companion import map.
4. Code, distribution, and test/guarantee findings.
5. Complete CI/workflow/action register and execution/check map.
6. Effective GitHub governance matrix and proposed setting deltas.
7. Configuration ownership inventory and justified consolidation proposal.
8. Complete change register with stable IDs and concrete acceptance evidence.
9. Ordered work packages, coupled changes, existing-PR dependencies, and owner actions.
10. Coverage ledger, validation results, unresolved facts, and source index.

Keep the main assessment readable; place large complete inventories in appendices of the same document. Supporting machine-readable files may help, but they must not be required to discover the actual recommended work. Do not present a proposed future layout as already implemented. The final document should be ready for xor to use in a subsequent implementation decision.

## 11. Reference starting points

Repository references below are navigation anchors. Read the corresponding files at the audit's recorded commit and follow their current dependencies.

- [UXor agent instructions](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/AGENTS.md), [contributor guide](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/CONTRIBUTING.md), and [consumer-agent guide](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/FOR-AGENTS.md).
- [UXor workflow directory](https://github.com/xormania/uxor/tree/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/workflows), [classifier](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/tools/ci-changes.sh), and [archive rules](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.gitattributes).
- [Former companion baseline](https://github.com/xormania/uxorscient/tree/614aa28fd937baa9feffa7730d02b58dc73afe18): inventory current code and pending work before relying on this snapshot.
- [GitHub rules REST API](https://docs.github.com/en/rest/repos/rules) and [ruleset layering](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets): distinguish listed rulesets from active effective branch rules and classic protection.
- [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) and [workflow reuse](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows): verify event, required-check, token, input/output, environment, and credential behavior against current documentation.
- [Composer schema](https://getcomposer.org/doc/04-schema.md), [Packagist submission requirements](https://packagist.org/about), and [Packagist API](https://packagist.org/apidoc): validate package metadata, publication setup, and refresh verification.
- The supplied single-repository plan's pinned Symfony UX Toolkit implementation references: recheck behavior for the versions the audit actually finds.

The official GitHub rules, triggering/reuse, Composer schema, and Packagist submission pages were consulted during plan preparation. Sol must verify version-sensitive behavior again when it becomes evidence for a final finding.
