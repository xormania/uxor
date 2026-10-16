# UXor configuration concept

Date: 2026-10-16, America/New_York  
Status: concept outline for the single-repository migration  
Project: [UXor](https://github.com/xormania/uxor)

UXor should have a small, easy-to-find set of authoritative configuration files that its development tools, CI, release process, and generators work from. A shared decision should usually require one authored change, with its consumers reading that value or receiving a reproducible generated representation.

The move to one repository and `packages/uxor/` will involve many small changes. Use those changes to discover duplicated decisions, assign ownership, and connect consumers to the right source. This is a proposal for that work; configuration filenames, formats, schemas, and implementation are not finalized.

This concept complements `uxor-single-repository-plan-2026-10-16.md`. It retains the selected UXor identity and repository layout. It does not require a broader redesign of the Toolkit or application runtime.

## 1. What the configuration should accomplish

The intended result is that maintainers and agents can answer four questions quickly:

- Where do I change this setting?
- What consumes it?
- What changes automatically?
- What verifies that the change reached the relevant consumers?

A few authoritative files can serve many native tool files. Composer, Toolkit, Symfony applications, GitHub Actions, and development environments still have their own configuration interfaces. The aim is to make shared decisions originate in a few places, and to make any required copies traceable.

Configuration should describe stable facts and choices. Scripts and application code should implement behavior using those inputs. Introduce an abstraction when it removes repeated ownership or makes a real boundary clearer.

## 2. Candidate ownership map

Start with the formats that already own a concern. Add shared repository configuration only for facts that lack a suitable existing owner.

| Concern | Candidate authoritative home | Consumers |
| --- | --- | --- |
| Composer identity, dependencies, autoloading, executable and Mate metadata | Proposed root `composer.json` | Composer, package checks, installed tooling, relevant generators |
| Kit identity and recipe definitions | Root and recipe Toolkit manifests | Toolkit, recipe checks, catalogs and reference generation |
| Repository directory roles and relationships | Small shared repository configuration, if existing metadata cannot express them | CI classification, archive checks, development helpers, repository map |
| Shared toolchain choices and environment profiles | Existing tool/image configuration, consolidated where appropriate | Local setup, CI setup, environment verification |
| Application-specific dependencies and settings | The demo's and consumer fixture's native configuration | Their respective applications and tests |
| Machine-specific paths, ports and credential bindings | Explicit environment inputs | The selected local or CI environment |

These are ownership categories, not a requirement to create six new files. The first pass should establish which existing files can serve these roles and how few additional sources are actually needed.

For each value, distinguish the decision from its resolution. A dependency constraint describes supported versions; a lockfile records a selected dependency graph. A CI compatibility matrix describes what is exercised. Those are related facts with different jobs and should not be collapsed into one ambiguous “version” setting.

## 3. How consumers use the sources

Prefer direct reading when a consumer can use the authoritative format. A checker can read declared Composer paths rather than maintain its own copy of them.

Where a tool needs a native representation, choose one of these approaches:

| Approach | Appropriate use |
| --- | --- |
| Read directly | The consumer can load the authoritative value without special setup |
| Generate | A native file or reference must contain a derived representation |
| Validate consistency | A small amount of deliberate repetition is clearer than introducing generation |
| Keep independently owned | Similar values express genuinely different requirements |

Generated output should identify its source and regeneration entry point. Generation should be deterministic, and CI should detect stale output without silently repairing it and passing. Files required in a published repository archive must already be present in the tagged source.

A generated file should not become an alternative place to author a decision. Documentation should link to the owner or describe the rule, with mechanically repeated facts generated or checked where worthwhile.

Avoid circular dependencies: the command that reads configuration must be discoverable and runnable before it has loaded that configuration. Likewise, a generated file cannot use its own contents as the authoritative input for regeneration.

## 4. Concrete opportunities during the migration

| Example | Proposed treatment |
| --- | --- |
| Package source, executable and resource paths move | Use Composer metadata for declared package paths; give repository-specific paths one owner |
| A shared tool or image version changes | Update its owning declaration; have local and CI setup consume it |
| A directory is classified as recipe, package, demo, fixture or generated output | Declare the role once and reuse it in the relevant tooling |
| CI and local development perform the same check | Use the same maintained entry point and explicit environment inputs |
| Kit identity appears in generated documentation | Read it from the kit identity source |
| Agent references duplicate recipe documentation | Generate them from canonical source files and check freshness |
| The same URL is required by several native metadata formats | Select an owner and generate or validate the repetitions |
| Demo and consumer dependency sets differ | Preserve explicit, independently justified application configurations |

The package directory deserves particular clarity: under the proposed layout, the Composer root is the repository root, while `packages/uxor/` holds implementation. Agents and helpers should obtain that relationship from the repository map instead of guessing it from the directory name.

For archive handling, distinguish the distributable payload from temporary validation views. The complete archive must support both installation routes. Toolkit lint may use a view that excludes explicitly recognized non-recipe directories, but that exclusion must not become an instruction to remove the package from distribution.

## 5. The configuration ownership inventory

Before selecting a new format, build an inventory while making the migration edits.

| Field | Question it answers |
| --- | --- |
| Decision or value | What is being configured? |
| Current declarations | Where is it repeated today? |
| Authoritative source | Which declaration should own it? |
| Consumers | Which commands, applications, workflows or generated files use it? |
| Propagation | Direct read, generation, consistency check, or independent ownership? |
| Scope and overrides | Where may it vary, and why? |
| Verification | What demonstrates that the consumers received the right value? |

Equal text alone is not evidence of one shared decision. For example, two applications may currently resolve the same dependency version while testing different compatibility requirements.

Conversely, slightly different representations may come from one decision: a repository identifier, its HTTPS URL, and a documentation link can share a source when the transformation is explicit.

Keep the inventory useful as a navigation aid. Once ownership is established, it should point to the authoritative files rather than become another manually maintained table of all their values.

## 6. Local development, CI, and release use

Local development and CI should invoke the same maintained checks. Their environments may differ, but the underlying check should not be independently rewritten inside workflow YAML.

Repository configuration can describe the relationships needed for change classification: source areas, generated outputs, shared inputs, and affected checks. The classifier remains responsible for interpreting those relationships. Changes to classification controls should themselves trigger sufficient checks, preserving the existing safeguards around how PR changes are classified.

Use explicit profiles for intentional environment differences. An override should have a documented scope and origin. Machine-specific settings should not silently redefine package identity, archive requirements, or the release contract.

A useful diagnostic capability would show effective non-sensitive values together with their source file and selected profile. The output should make a wrong directory, stale image selection, or unexpected override easy to explain.

Publication should consume the same package metadata and installation checks used earlier in development, evaluated for the release candidate. It should not carry a separate collection of package paths or reconstruct configuration differently.

## 7. Agent orientation

The root agent guidance should begin with a concise map of responsibilities:

- Where Composer commands run.
- Which directories contain Toolkit recipes, package code, the demo, and the consumer fixture.
- Which files are generated and where their sources live.
- Which configuration owns each shared concern.
- Which entry points perform validation and regeneration.

Keep repository-maintenance instructions distinct from packaged guidance intended for agents in consuming applications. Both use UXor terminology, but their audiences and working directories differ.

When an agent needs to change a shared setting, the expected path should be: locate its owner, change it once, update generated output if applicable, and run the affected checks. Existing comments and instructions that teach the previous layout must be updated in the same migration work.

## 8. Incremental implementation approach

1. **Inventory encountered duplication.** Record repeated names, paths, versions, URLs, image references and command sequences while moving the package.
2. **Choose owners.** Reuse native metadata and existing helpers where they already express the decision.
3. **Connect one group of consumers.** Update all uses of a shared fact together and remove superseded declarations.
4. **Check propagation.** Exercise the relevant command, generated output or installation route.
5. **Document the ownership.** Add a short navigation entry explaining where future changes belong.
6. **Review what remains.** Introduce further shared configuration only where the inventory demonstrates a need.

Keep changes reviewable and preserve a working repository as they land. The goal is a smaller set of maintained decisions and predictable behavior; it does not require a new general-purpose configuration framework.

Do not make configuration validation the only evidence of correctness. An archive producer and its checker could agree on the same mistaken path. Independent consumer installation and actual Toolkit behavior still provide necessary evidence.

## 9. Signs the concept is working

- A shared setting has one clear owner.
- Local development and CI use the same check implementation.
- Changing a shared path or tool selection does not require hunting through workflows and scripts.
- Required copies are generated or checked, and stale output produces an actionable failure.
- Application-specific differences remain understandable.
- Agents can identify the correct edit location from a short repository map.
- The published archive contains what both installation routes need.
- Moving or renaming an area produces useful failures where an assumption was missed.

The initial deliverables would be the ownership inventory, a proposed small set of authoritative files, a consumer map, and the first migration changes demonstrating the approach. Exact filenames, formats, override rules, and generation boundaries should be selected from that inventory.

## Context and references

This document develops xor's stated goal: use the small changes involved in the single-repository migration to reduce duplicated configuration and make everything work from a few authoritative sources.

The repository references below are from the snapshot inspected earlier in this discussion; this outline is not a new exhaustive configuration audit.

- [UXor CI at the inspected revision](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.github/workflows/ci.yml): existing orchestration and aggregate result.
- [Changed-path classifier](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/tools/ci-changes.sh): existing relationships between repository inputs and checks.
- [Archive rules](https://github.com/xormania/uxor/blob/40d957cd1ea7766ac0dee742816948ce5ae05bc3/.gitattributes): assumptions that need adaptation for the combined distribution.
- [Composer schema](https://getcomposer.org/doc/04-schema.md): native package metadata and root-package responsibilities.
- Companion proposal: `uxor-single-repository-plan-2026-10-16.md`.

