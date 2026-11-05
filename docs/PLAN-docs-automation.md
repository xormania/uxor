---
status: open
recipes: none
---

# Plan: documentation automation

_2026-11-04. Adopted by the owner on 2026-11-04 as the plan for automating the released documentation and its SEO and
AEO foundations. The proposal below is kept as written, after the owner's decisions and the refreshed findings of its
Stage 0. Repository and contributor guidance: it is not consumer documentation, and the consumer-agent index
(`llms.txt`) does not list it._

## Decisions (2026-11-04)

1. **Documentation corrections ship through ordinary releases** (section 4, *Documentation-only corrections*, the first
   policy). A documentation-only patch release is possible, so a correction need not wait for unrelated features.
   Publishing a separate documentation revision for an existing release stays a possible later option.
2. **One stage per pull request, as a starting point**, each into `dev`. A stage that would be hard to review is split
   further. The owner reviews each pull request before it merges; preparing the next one needs no new authorization,
   and dependent work goes ahead with its dependencies named.
3. **This plan is committed here** (Stage 1), with `status: open` and `recipes: none`, outside the consumer
   documentation and the consumer-agent index.

## Refreshed findings (Stage 0, 2026-11-04)

- **Commits.** `main` is `f7c94ef1f126996b2094ed02210585c2c9b21c2c`, the commit the proposal inspected; release `0.3.0`
  is tag commit `e2a9ae8caea0c9b23fcd6d3ba0dd5212b5319003`, 31 commits behind `main`. `dev` is 11 commits ahead of
  `main`. None of the files the evidence cites differs between `main` and `dev` (`pages.yml`, `release.yml`,
  `tools/build-static.sh`, `demo/templates/showcase/recipe.html.twig`, `tools/llms-txt.mjs`,
  `packages/uxor/tools/ReferenceGenerator.php`, the root documents, the demo's source), so E1–E9 hold as written.
- **E2:** `release.yml` passes Pages the commit CI passed on (its `check` job's `commit` output), not the tag's commit.
- **E3:** `--release-from-tags` reads the tag at the existing checkout and falls back to the branch.
- **E4:** the recipe page links to the README (`recipe.html.twig`) and does not render it.
- **E5:** `tools/llms-txt.mjs` switches its links and install line to `dev` while `## [Unreleased]` has entries; it has
  entries now, and `main`'s committed `llms.txt` already tells consumers to install `:dev`.
- **E7:** `ReferenceGenerator::DEFAULT_REF` is `main`.
- **E8:** the demo's lock still holds Symfony UX Toolkit 3.5.1; nothing in `demo/src` uses `RecipeDocRenderer` yet.
- **The live site** (`https://xormania.github.io/uxor/`) names release `0.3.0` and installs `:0.3.0`, but its footer
  links `README.md`, `CHANGELOG.md` and the contribution guide on `blob/main`; `llms.txt`, `sitemap.xml` and
  `robots.txt` answer 404, and the home page has no canonical URL. E1's risk (a manual `dev` build replacing the
  public site) is real by design; whether it ever happened was not measured.

## The proposal

**Date:** 2026-11-04  
**Owner:** xor  
**Status:** the proposal as submitted; the decisions above take precedence.  
**Repository:** https://github.com/xormania/uxor  
**Public site:** https://xormania.github.io/uxor/  
**Purpose:** Automate accurate, complete release documentation and its SEO/AEO foundations, while keeping development-branch guidance in contributor documentation.

This document is self-contained. It includes the relevant observed behavior, proposed requirements, implementation sequence, acceptance criteria, limitations, and verification sources. The source links support verification; reading an earlier conversation or report is not required.

### 1. Direction and scope

#### Confirmed direction from xor

- Automate as much documentation generation, checking, and publication as practical.
- General users should receive documentation for released UXor.
- The `dev` branch is development work before a release. Its usage belongs in developer/contributor guidance, not general installation and usage instructions.
- Examine the current Pages workflow and research better documentation automation.

An application developer or agent installing UXor is a **consumer** for this purpose. An agent changing UXor itself is a **contributor**. The fact that both write software does not make unreleased branch instructions appropriate for both.

#### Proposal status

The requirements below define the proposed implementation and its acceptance criteria. They are not a claim that every architectural choice has already been approved. xor's later direction takes precedence. Creating this plan does not deploy the site or authorize repository mutations.

The initial recommendation is to extend the existing Symfony demo, static exporter, Toolkit dependency, and GitHub Actions workflows. A replacement documentation platform remains an option if implementation evidence demonstrates a concrete benefit.

#### Included work

- Release selection and reliable Pages publication.
- Complete recipe documentation, public installation guidance, and consumer-agent documentation.
- Generation of API references and installation details from existing sources.
- Common release identity across HTML, Markdown, links, and generated references.
- Sitemap, canonical URLs, page metadata, and publication checks.
- Integration with existing CI and generated package references.

This plan does not require a new runtime hosting service, a public development preview site, a version archive, or an AI writing service. These remain possible later choices. Private search analytics access is not a prerequisite for these changes.

### 2. Evidence snapshot

Repository observations below refer to **main commit `f7c94ef1f126996b2094ed02210585c2c9b21c2c`**, inspected on 2026-11-04. They must be refreshed before implementation if the repository has moved.

The associated baseline recorded release **0.3.0**, resolving to commit **`e2a9ae8caea0c9b23fcd6d3ba0dd5212b5319003`**, as the published gallery version. It reported main 31 commits ahead of that release. This illustrates why a branch name alone is not sufficient release identity; those counts are historical observations, not permanent conditions. [B1]

| ID | Verified behavior | Consequence | Evidence |
| --- | --- | --- | --- |
| E1 | Pages accepts a required commit through a reusable workflow and also permits manual runs from main or dev. Its comments explicitly describe dev replacing the public site. | A manual development build can overwrite consumer documentation. | [R1] |
| E2 | The release process selects the commit that introduced a version heading for tagging, but passes the triggering CI commit to Pages. | The published code version and documentation source can diverge when those commits differ. This is a source-level risk, not proof that the current site is mismatched. | [R2] |
| E3 | The static build's release flag inspects tags at the existing checkout; it does not check out a release. Untagged builds can fall back to branch identity. | A release-looking build option does not guarantee release content. | [R3] |
| E4 | Gallery recipe pages render installation details, file/dependency information, and preview examples, but do not render the full recipe README body. | Usage explanations, caveats, and generated API sections are absent from the gallery page. | [R4] |
| E5 | The llms generator uses dev when the changelog has unreleased bullet entries. | Consumer-agent guidance follows development state rather than an explicitly selected published release. | [R5] |
| E6 | CI already runs the static build script, README dependency checks, example coverage, documentation lint, and package-reference consistency checks. | Extend existing checks and generation paths instead of duplicating them. | [R6], [R7] |
| E7 | The package reference generator copies selected documentation, rewrites links, records input digests, and defaults its source ref to main. It separately parses the recipe catalog. | Website generation alone will not repair package-bundled documentation or all reference drift. | [R8] |
| E8 | The demo locks Symfony UX Toolkit 3.5.1 and already includes CommonMark. That Toolkit version contains an HTML/Markdown recipe renderer. | The main rendering capability is already a dependency; a Toolkit upgrade is not inherently required. | [R9], [U1] |
| E9 | UXor components already use documented Twig props and blocks; recipe READMEs include Toolkit installation/API directives. | Existing source information can drive substantially more complete documentation. | [R10], [R11], [U4] |

The earlier baseline also found missing canonical URLs and sitemap, repeated page descriptions, and no published llms file at the site's expected path. Those are baseline findings to recheck after implementation. It did **not** establish actual index coverage, search ranking causality, or clean AI recommendation performance. [B1]

### 3. Required consumer behavior

**REQ-01 — Released documentation.** Public installation, recipe, API, and consumer-agent guidance must describe the selected published release. Work on dev may continue to build and validate documentation in CI without replacing that public output.

**REQ-02 — Accurate references.** Installation commands, displayed version, recipe source links, and API documentation must agree on release identity. Do not silently substitute main or dev when release resolution fails.

**REQ-03 — Contributor separation.** Move branch-install instructions and development workflow explanations into contributor guidance. A clear link to contributing is acceptable; routine consumer navigation should not offer dev as an installation choice.

**REQ-04 — Preserve legitimate terminology.** This is not a ban on the string “dev.” Composer's `--dev`, package names such as `tales-from-a-dev/twig-tailwind-extra`, local environment terminology, and contributor instructions remain valid.

**REQ-05 — Complete content.** A recipe's public page must contain its applicable usage explanation, caveats, examples, installation instructions, and API reference. Readers should not need to leave the site for GitHub merely to obtain information already authored in that recipe's README.

**REQ-06 — One authored source per fact.** Dependencies come from manifests; API facts come from declarations and annotations; narrative and examples come from recipe documentation. Derived website and Markdown outputs should not introduce separately maintained copies of those facts.

### 4. Release identity and publication

#### One explicit build context

Resolve a small, shared publication context once and pass it to every output generator. The following are conceptual fields, not a mandated new configuration file:

| Field | Meaning |
| --- | --- |
| Release version/tag | The published UXor version consumers are installing |
| Source commit | Full commit SHA obtained by resolving that tag, including annotated tags |
| Public base URL | Absolute deployment URL, including the project path /uxor/ |
| Publication mode | Public release build or contributor/CI validation build |
| Documentation revision | Needed if documentation-only updates later use a revision different from the released source |

The default implementation should build the release's content and renderer from the same resolved commit. If renderer code or editorial corrections come from another revision, record that distinction explicitly and preserve the release's API/source identity.

**REQ-07 — Validated release input.** The publication entry point must resolve a published, non-draft release eligible for the main documentation site. Under the initial latest-stable policy, exclude prereleases. A matching tag name by itself is not proof of publication. Release workflow output should supply the actual selected version and tag commit, not merely the commit whose CI triggered the workflow.

**REQ-08 — Repeatable repair.** A manual “rebuild current release” operation must resolve that release explicitly. It must work when the release already exists, including after a failed documentation build or deployment. Review whole-workflow reruns as well as reruns of failed jobs: creation of a new release must not be the only route to repairing its docs.

**REQ-09 — No stale publication.** Before deploying to the primary site, confirm that the artifact is still eligible under the selected latest-release policy. An older queued or retried run must not overwrite newer release documentation unintentionally. Keep the existing publication concurrency mechanism, but do not treat serialization alone as proof of freshness.

**REQ-10 — Build, validate, deploy the same artifact.** Validation must apply to the artifact actually deployed. Record release and commit identity in a small generated manifest or equivalent inspectable output. Preserve the prior working site if build or validation fails.

Retain the direct reusable-workflow call from Release to Pages. GitHub documents that events caused by GITHUB_TOKEN generally do not trigger another workflow; publishing a release with that token is therefore not sufficient to drive an independent release-event-only deployment. [U5]

#### Documentation-only corrections

Release accuracy must not become an accidental prohibition on correcting documentation.

Two viable policies are:

| Policy | Benefit | Tradeoff |
| --- | --- | --- |
| Ship corrections through an ordinary release | Simplest source/version relationship | A documentation correction waits for, or accompanies, a release |
| Publish an explicit documentation revision for an existing release | Corrects guidance without changing the product release | Must separate documentation revision from released API/source and validate against that release |

Choose and document the intended policy during publication design. The ordinary release path can be implemented first. Do not silently combine current-branch recipes with an older release label to obtain a documentation fix.

### 5. Documentation generation design

#### Reuse Toolkit's renderer

Use Toolkit's RecipeDocRenderer as the starting point. The inspected 3.5.1 class exposes HTML and portable Markdown rendering, expands the installation/API directives, and returns a table of contents with HTML output. Symfony's release announcement explains the motivation: recipes should carry their own documentation rather than requiring a separately maintained website copy. [U1], [U2]

The integration needs a small UXor-specific boundary:

- Register/use the renderer with the demo's Twig environment.
- Supply PreviewUrlGenerator behavior that resolves existing recipe examples to UXor's preview routes.
- Adapt the installation template to UXor's repository URL and exact release tag. The upstream template uses a kit identifier and is not automatically a correct external UXor install command.
- Apply UXor's existing presentation and accessibility conventions to documentation markup.
- Preserve compatible example identities and links while integrating the renderer.
- Ensure relative documentation links and assets resolve in both the HTML site and portable Markdown.

The renderer's availability has been verified in source. End-to-end compatibility with UXor's exporter has **not** been demonstrated by a build in this research task. Start integration with one representative component and one recipe with server-side behavior before generalizing. [U1], [U3], [U4]

**REQ-11 — Generated API accuracy.** Use declared props, defaults, types, blocks, and supported Stimulus annotations. Do not infer undocumented guarantees from implementation details. Missing descriptions should remain visible work for authors, not be filled with invented claims.

**REQ-12 — Narrative preservation.** Preserve applicable README prose and limitations. Generating an API table does not replace explanations of when to use a recipe or how it behaves with forms, Turbo, and Live Components.

**REQ-13 — Preview integrity.** Keep the existing example coverage and light/dark behavior. Server-dependent examples must retain clear limitations in the static site. Documentation completeness must not imply that a static preview performs backend operations it cannot perform.

**REQ-14 — Portable Markdown.** Consumer Markdown must contain expanded, usable content and release-correct links. It must not require the reader or consuming agent to interpret unresolved Toolkit directives.

Prefer the renderer's integration surface over building a second API parser. Its supporting parser is marked internal; keep any dependency on implementation details localized and covered by focused compatibility checks. [U4]

#### Public output inventory

Generate an explicit inventory of public pages from selected sources, then use it for navigation, metadata, sitemap, and link validation.

| Output | Source and intended audience |
| --- | --- |
| Home/overview | Reviewed project description and release identity |
| Installation guide | Consumer setup guidance matching the release |
| Recipe catalog | Existing catalog and released manifests |
| Recipe detail pages | Complete README rendering, generated API, examples |
| Consumer guide | Released usage/integration guidance |
| Consumer-agent entry point | Setup and usage of released UXor in another application |
| Portable Markdown | The same consumer documentation and release identity |
| llms.txt | Index of those consumer documents |
| Contributor entry point | Repository contribution guidance, where dev instructions belong |

Do not publish repository planning documents or contributor-agent instructions merely because they are Markdown files. Select content by purpose. Links to current contribution instructions or security-reporting policy can intentionally remain current; distinguish them from links claiming to describe the installed release's code.

#### Existing generated references

**REQ-15 — Package consistency.** Include the package reference generator in the work. Its default main links and copied narrative can otherwise preserve the same mismatch after the website is fixed. Consolidate duplicated catalog/reference logic where useful while keeping HTML presentation separate from package export.

Package-bundled references must be prepared before the release commit is tagged when they are shipped through the repository archive. A Pages-only generation step cannot alter an already published Composer archive.

Use the known planned release tag and existing input-digest mechanism where appropriate for committed references. Do not require a generated file to contain the hash of the commit that will itself contain that file. Record the final full source SHA in publication artifacts after the commit exists. Update generator defaults and check mode together so they validate the intended release references. [R8]

### 6. SEO/AEO outputs

**REQ-16 — Page metadata.** Generate distinct titles and useful descriptions from reviewed page/recipe content, with an editorial override when the source description is unsuitable. Do not generate unsupported marketing claims merely to fill a tag.

**REQ-17 — Canonical URLs.** Generate absolute canonical URLs using the real public origin and /uxor/ base path. Each primary document should identify its intended canonical page. Do not let an export request's localhost origin leak into output.

**REQ-18 — Sitemap.** Generate the sitemap from the public page inventory. Include canonical documentation pages that should be indexed. Exclude errors, contributor-only build artifacts, and duplicate preview variants. If lastmod is emitted, derive it from meaningful content changes; do not refresh every page's timestamp solely because a deployment ran. [U6]

**REQ-19 — Supporting metadata.** Generate consistent social-sharing metadata from the same page identity. Add structured data only where a suitable type describes facts visible on the page; special AI schema is not a prerequisite.

**REQ-20 — Preview discovery policy.** Make primary recipe pages the search destinations. Recommended initial behavior is to exclude standalone preview/theme pages from the sitemap and mark them noindex while keeping them usable as embedded examples. Verify that directives never accidentally exclude primary documentation.

**REQ-21 — Published agent index.** Publish the generated llms index at the intended site path and ensure its linked documents are available and consistent with the release. Treat this as a convenience for consuming tools, not an SEO ranking guarantee.

Google states that ordinary SEO fundamentals apply to its AI features, and that it does not use llms.txt to improve visibility. The strongest relevant improvements here are useful text on accessible pages, reliable links, and consistent released documentation. [U7]

A robots.txt file at /uxor/robots.txt does not control the github.io host's crawler policy. If host-level robots configuration becomes necessary, first establish control of the domain-root file. Its absence by itself is not a crawler prohibition. [U8]

### 7. CI and operational requirements

#### Extend existing verification

**REQ-22 — Reuse existing jobs.** Extend the Static site build/check path and the existing documentation/package checks. Avoid a second complete site build or another full browser suite solely for metadata validation.

**REQ-23 — Meaningful failures.** Fail on concrete inconsistencies such as:

- The publication source does not match the selected release commit.
- A released recipe or its applicable documentation is missing.
- Supported directives remain unresolved in consumer output.
- Expected API declarations are absent or render incorrectly.
- Internal links, anchors, or preview references target missing output.
- Consumer branch-install instructions leak into released output.
- Canonical/sitemap URLs use the wrong host or base path.
- Metadata or generated package references disagree with the release context.

Validate semantics, not arbitrary text matching. In particular, do not implement a blanket “dev must not occur” check or require API tables for recipes that have no applicable API declarations.

**REQ-24 — Low-cost post-deployment verification.** After deployment, check published release identity, the home page, a representative recipe, installation guidance, sitemap, and agent index. This detects deployment/path problems that inspecting local files cannot. Reuse existing tooling where practical and report actionable failures.

**REQ-25 — Reviewable changes.** Authoritative documentation and generator changes follow the repository's current contribution and PR rules. Automation should not introduce direct pushes to protected branches as a shortcut. Read current repository instructions before implementation; this plan does not supersede them.

Keep deterministic generation separate from optional AI assistance. Agents can draft missing prose alongside a feature change and explain the evidence for it. Automatically publishing model-written behavioral or accessibility claims is not part of this proposal.

#### Acceptance matrix

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC1 | A candidate on dev builds documentation | Existing CI validates it; it does not replace the public release site |
| AC2 | A released tag and a later triggering CI commit differ | Published content and install commands use the selected tag's resolved commit |
| AC3 | Release selection is missing, invalid, draft, or ineligible | Public publication stops with a specific error; no branch fallback |
| AC4 | An already published release needs its docs rebuilt | Recovery succeeds without creating another release |
| AC5 | An older run reaches deployment after a newer release | Freshness policy prevents unintended overwrite |
| AC6 | A representative Twig prop/default or supported Stimulus annotation changes | The generated reference reflects the source change without a second manual table |
| AC7 | A README contains usage guidance, caveats, and examples | Its applicable content appears on the public recipe page and in portable Markdown |
| AC8 | A consumer install example targets dev | Validation identifies the consumer instruction; legitimate Composer --dev remains valid |
| AC9 | An internal link, anchor, or project-base-path URL is broken | Existing static validation reports the exact source/target |
| AC10 | Public pages, sitemap, and llms index are generated | Their release identity and intended URLs agree; duplicate previews are not sitemap entries |
| AC11 | Bundled reference sources change | The package generator/check identifies stale outputs and produces release-correct references |
| AC12 | A static preview depends on a backend | The limitation remains visible; the page does not claim backend functionality was demonstrated |
| AC13 | A successful artifact is deployed | A small live-site check confirms expected release identity and representative resources |

These are acceptance scenarios, not a requirement to create thirteen independent test suites. Map them onto existing tests, small generator tests, artifact assertions, and one deployment smoke check.

### 8. Implementation sequence

The stages below are cohesive changesets, not a mandated PR count. Keep each review understandable and avoid publishing an intermediate state with misleading version claims.

#### Stage 0 — Refresh the implementation context

1. Read current repository instructions, branch state, workflows, and relevant open PRs.
2. Confirm the current release/tag commit, deployed documentation identity, and Toolkit lock.
3. Map existing checks to this plan before adding new ones.
4. Record any changed evidence and choose the documentation-only correction policy.

**Deliverable:** A short implementation note identifying current source commits, affected files, and any material change to this plan.

#### Stage 1 — Correct release selection and audience boundaries

1. Introduce the shared release/publication context.
2. Have Release pass the actual selected tag and resolved commit to Pages.
3. Make manual repair resolve a published release; retain validation builds for development.
4. Add publication freshness and retry behavior.
5. Remove consumer branch-install guidance; preserve it in contributor documentation.
6. Update llms and package-reference generation to accept the intended release identity.

**Acceptance focus:** AC1–AC5, AC8, AC11.

#### Stage 2 — Integrate complete rendering

1. Prove Toolkit rendering for a representative annotated component and a server-dependent recipe.
2. Adapt install templates, preview URLs, styles, and relative links.
3. Expand to all released recipes, retaining current preview coverage.
4. Publish the consumer installation and usage guides.
5. Emit portable Markdown and use the same selected sources for consumer-agent documentation.

**Acceptance focus:** AC6, AC7, AC9, AC12.

#### Stage 3 — Generate discovery metadata and verify deployment

1. Generate the page inventory, canonical URLs, sitemap, descriptions, and sharing metadata.
2. Publish the consumer llms index and linked Markdown.
3. Apply and verify the preview indexing policy.
4. Add lightweight artifact assertions to existing checks and a post-deployment check.
5. Compare the published result with the prior baseline and record only measured improvements.

**Acceptance focus:** AC9, AC10, AC13, plus release identity across every output.

### 9. Risks, choices, and limits

| Topic | Treatment |
| --- | --- |
| Toolkit renderer integration | Availability is verified; compatibility needs a focused build exercise. Keep adaptation localized. |
| Incorrect or incomplete annotations | Generate supported facts accurately; authors still supply meaning and limitations. |
| Root README on a moving branch | Keep its consumer entry point directed to released documentation. Move branch-specific installation guidance to contributing. |
| Package documentation drift | Prepare references as part of the release change; publishing Pages cannot repair an existing archive. |
| Documentation-only corrections | Adopt one explicit policy from section 4; do not relabel current development content. |
| Historical version documentation | Optional extension. Latest stable is the recommended initial public experience, not a permanent prohibition on archives. |
| Site search | Can be added later from generated content if needed; no new search service is required to deliver this plan. |
| Search/AI visibility | Artifact correctness is measurable in CI; indexing, traffic, and recommendations depend on external systems and require separate measurement. |
| CI cost | Reuse current builds and assertions; add browser coverage only for new rendering behavior that needs it. |

#### Completion criteria

The work is complete when the acceptance scenarios pass, the public site identifies the intended release, consumer installation/API/agent documentation agrees with that release, full authored recipe content is available, generated discovery files are present, and documented recovery works.

A completion report should state the deployed version and commit, the outputs checked, any unresolved limitations, and changes from the baseline. It should not equate successful publication with improved search rankings or AI recommendation share.

### 10. Source register

Repository links are pinned to the inspected commit unless stated otherwise. External documentation describes the capabilities researched on 2026-11-04.

#### UXor evidence

- **[R1] Pages workflow:** [pages.yml](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/.github/workflows/pages.yml).
- **[R2] Release selection and Pages handoff:** [release.yml](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/.github/workflows/release.yml).
- **[R3] Static build, tag detection, and checks:** [build-static.sh](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/tools/build-static.sh).
- **[R4] Current recipe presentation:** [recipe.html.twig](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/demo/templates/showcase/recipe.html.twig).
- **[R5] Agent index and catalog generation:** [llms-txt.mjs](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/tools/llms-txt.mjs).
- **[R6] Existing CI jobs and checks:** [ci.yml](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/.github/workflows/ci.yml).
- **[R7] README installation/dependency policy:** [readme-versions.mjs](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/tools/readme-versions.mjs).
- **[R8] Package reference generation:** [ReferenceGenerator.php](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/packages/uxor/tools/ReferenceGenerator.php).
- **[R9] Installed dependencies:** [demo/composer.lock](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/demo/composer.lock) and [demo/composer.json](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/demo/composer.json).
- **[R10] Example component annotations:** [Button.html.twig](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/button/templates/components/Button.html.twig).
- **[R11] Example authored recipe documentation:** [button/README.md](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/button/README.md).
- **[R12] Consumer entry points requiring audience review:** [README.md](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/README.md), [INSTALL.md](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/INSTALL.md), [GUIDE.md](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/docs/GUIDE.md), and [FOR-AGENTS.md](https://github.com/xormania/uxor/blob/f7c94ef1f126996b2094ed02210585c2c9b21c2c/FOR-AGENTS.md).
- **[B1] Prior measurement record:** [UXor-SEO-AEO-Baseline-2026-11-04(1).md](https://chatgpt.com/library?file_id=libfile_6da2aad37e5c8191b16ae5778f08d4ca&account_id=personal). Supporting release: [0.3.0](https://github.com/xormania/uxor/releases/tag/0.3.0). The relevant conclusions and measurement limits are reproduced in section 2.

#### Primary upstream and platform references

- **[U1] Renderer at UXor's locked Toolkit revision:** [RecipeDocRenderer.php](https://github.com/symfony/ux-toolkit/blob/eedbf3972bbc11fcd4823c87495e0c31bd9d77f8/src/Doc/RecipeDocRenderer.php) and [RenderedRecipeDoc.php](https://github.com/symfony/ux-toolkit/blob/eedbf3972bbc11fcd4823c87495e0c31bd9d77f8/src/Doc/RenderedRecipeDoc.php).
- **[U2] Symfony's documentation-generation rationale:** [Symfony UX 3.4.0 released — self-documenting Toolkit recipes](https://symfony.com/blog/symfony-ux-3-4-0-released).
- **[U3] Host integration contracts:** [PreviewUrlGenerator.php](https://github.com/symfony/ux-toolkit/blob/eedbf3972bbc11fcd4823c87495e0c31bd9d77f8/src/Markdown/PreviewUrlGenerator.php) and [installation template](https://github.com/symfony/ux-toolkit/blob/eedbf3972bbc11fcd4823c87495e0c31bd9d77f8/templates/doc/_installation.md.twig).
- **[U4] Twig API extraction and internal API status:** [ComponentDocParser.php](https://github.com/symfony/ux-toolkit/blob/eedbf3972bbc11fcd4823c87495e0c31bd9d77f8/src/Component/ComponentDocParser.php).
- **[U5] GitHub workflow triggering:** [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token) and [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
- **[U6] Sitemap generation and modification dates:** [Google Search Central — build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
- **[U7] AI-search guidance and limits:** [Google Search Central — AI features](https://developers.google.com/search/docs/appearance/ai-features) and [optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).
- **[U8] Robots scope and location:** [Google Search Central — robots.txt specifications](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt).
