#!/usr/bin/env bash
#
# Which CI jobs a change could affect. Reads the changed paths, one per line, on stdin and prints one
# `<job>=true|false` line per job of .github/workflows/ci.yml, for $GITHUB_OUTPUT. A job is skipped only when none of
# the paths could change what it checks. A path not listed counts as part of the kit, which runs every job but
# Contrast, Workflows and Package (a recipe's templates and markdown run Contrast too, its README.md and manifest.json
# Package too: the package's generated references copy them). A workflow runs Workflows
# (actionlint) and the jobs that run the same commands it runs; a workflow or a file under .github/ that is not listed
# runs everything. Tool tests runs on every push, so a file only it reads selects no job; it also checks the package's
# references, its archive and the test inventory, which a renamed or added file anywhere can break.
#
# Usage: git diff --name-only --no-renames <base> HEAD | tools/ci-changes.sh
# Test:  tools/tests/ci-changes.sh

set -euo pipefail

jobs=(lint-kit php static-site fresh-install contrast demo workflows package)
declare -A run
for job in "${jobs[@]}"; do run[$job]=false; done

all() { for job in "${jobs[@]}"; do run[$job]=true; done; }
on() { for job in "$@"; do run[$job]=true; done; }

while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
        # The workflow and this script decide what runs: a change to either runs everything
        .github/workflows/ci.yml | tools/ci-changes.sh | tools/tests/ci-changes.sh) all ;;

        # The Composer package's generated references copy these (packages/uxor/tools/ReferenceGenerator.php: its GUIDES,
        # the kit's manifest.json and each recipe's README.md and manifest.json, the last ones with the kit below):
        # Package checks the copies are up to date (generate-reference.php --check)
        docs/GUIDE.md | docs/RECIPES.md | docs/PROJECT-AGENTS-SNIPPET.md | docs/TESTING.md | FOR-AGENTS.md) on contrast package ;;
        LICENSE | NOTICE) on package ;;

        # Read by people and agents: Contrast checks the generated lists, the plans' status (tools/llms-txt.mjs
        # reads CHANGELOG.md for the links' ref) and what the markdown teaches (tools/docs-lint.mjs)
        docs/* | CHANGELOG.md | CONTRIBUTING.md | AGENTS.md | SECURITY.md) on contrast ;;
        .github/pull_request_template.md) on contrast ;;
        .github/dependabot.yml) ;;

        # The other workflows. CI cannot run them (they deploy, tag or upload), so it runs the jobs that run what they
        # run: pages.yml builds the static site, release.yml checks the install from GitHub (docker-install.sh) and
        # calls pages.yml. audit.yml and codeql.yml run themselves on the pull request that changes them.
        .github/workflows/pages.yml) on static-site workflows ;;
        .github/workflows/release.yml) on static-site fresh-install workflows ;;
        .github/workflows/audit.yml | .github/workflows/codeql.yml | .github/actionlint.yaml) on workflows ;;
        # monthly.yml runs on its schedule and by hand on dev, never on a push, and no job here runs what it runs (the
        # browser tests' opt-in coverage, tests/e2e/coverage.ts, is part of the browser tests below)
        .github/workflows/monthly.yml) on workflows ;;
        # The advisory Jev step every job calls on a failure (.github/actions/jev-diagnosis): a passing job never runs
        # it, so no job checks it by passing; actionlint checks each call's inputs against it
        .github/actions/jev-diagnosis/*) on workflows ;;
        # release-checks.yml runs on the release pull request, daily on dev and by hand, never on a push, and no job
        # here runs it: actionlint only (it is required on the release pull request)
        .github/workflows/release-checks.yml) on workflows ;;
        # jev.yml and metadata.yml run on their own events, never in CI: actionlint only. CODEOWNERS and the mentions'
        # allowlist are read by Tool tests (the security policy, the mention check's cases), on every run
        .github/workflows/jev.yml | .github/workflows/metadata.yml) on workflows ;;
        .github/CODEOWNERS | .github/mention-allowlist) ;;
        .github/*) all ;;

        # The Composer package xormania/uxor: the root composer.json and the implementation under packages/uxor/. The
        # root metadata is in both archives, the kit's and the package's (one GitHub archive), but the toolkit's
        # installs and its lint never read it: Package checks it (composer validate, the archive's payload); the lock
        # file is export-ignored and only the package installs from it. .gitattributes decides what both archives hold.
        # The package's markdown runs Contrast too (the markdown rule below); .gitattributes, another directory under
        # packages/ and the references' inputs in the kit are below, with the kit.
        composer.json) on package ;;
        composer.lock | packages/uxor/*) on package ;;

        # The browser tests and their tools. tools/test-inventory.mjs (Contrast) reads which specs exist, the accessibility
        # scan's list of lab pages and, below, the PHPUnit tests, the lab's routes and which recipes ship a controller
        # The release checks' own specs and their leak detector run in the release projects only (playwright.config.ts,
        # with RELEASE_CHECKS: release-checks.yml), never in CI's browser job; the inventory names the specs, and the
        # detector's cases run in Tool tests
        tests/e2e/release.*.spec.ts) on contrast ;;
        tests/e2e/leak-detector.mjs) ;;
        tests/e2e/*.spec.ts) on contrast demo ;;
        # tools/playwright-image.*: the browser image the browser job pulls and playwright.config.ts runs (its cases run
        # in Tool tests, on every run)
        tests/* | playwright.config.ts | tools/prepare-tests.mjs | tools/playwright-image.mjs | tools/playwright-image.json) on demo ;;
        package.json | package-lock.json) on contrast demo ;;

        # Repository tools, each with the jobs that run it
        tools/contrast/* | tools/llms-txt.mjs | tools/docs-lint.mjs | tools/test-inventory.mjs | llms.txt) on contrast ;;
        # The kit's name and repository from manifest.json: llms-txt (Contrast) writes them, name-check reads them; the
        # demo reads manifest.json itself
        tools/kit-identity.mjs) on contrast ;;
        # icon-lint runs in Contrast; its cases in Tool tests, on every run
        tools/icon-lint.mjs) on contrast ;;
        tools/fence-coverage.mjs) on contrast static-site ;;
        # The README checks: Contrast runs them and their cases, the browser job's node --test runs the cases too
        tools/readme-versions.mjs | tools/readme-pairing.mjs) on contrast ;;
        tools/build-static.sh) on static-site ;;
        tools/tests/fresh-install.sh | tools/tests/check-fresh-app.sh | tools/tests/docker-install.sh) on fresh-install ;;
        tools/tests/install-scenario.sh) on fresh-install ;;
        tools/tests/live-action.php | tools/tests/fixtures/fresh-app/*) on fresh-install ;;
        tools/tests/sync-demo.sh | tools/tests/fixtures/sync-kit/*) on demo ;;
        tools/phpstan.neon) on php ;;
        # The jobs' own CI tools: Kit PHP turns its JUnit report into failed attempts; Jev diagnoses both jobs' failures;
        # the rest (the results summary, the job metrics, the shard plan) is the browser job's. CI result, which runs on
        # every run, also runs ci-metrics.mjs and the shard plan's timings
        # Advisory steps only (after a failure, or the job metrics), Jev's diagnosis from jev.yml's own checkout, and the
        # release checks' tools: no CI job's verdict depends on them, so their cases (Tool tests) check them
        tools/ci/junit-attempts.mjs | tools/ci/jev-diagnosis.mjs | tools/ci/jev-ci.json | tools/ci/step-attempts.mjs) ;;
        tools/ci/ci-metrics.mjs | tools/ci/release-checks.mjs | tools/ci/release-evidence.mjs | tools/ci/release-failure.mjs | tools/ci/release-timings.mjs) ;;
        # the shard plan and the results summary (run-provenance.mjs is its import) decide the browser job's verdict
        tools/ci/*) on demo ;;
        # Tools' cases and their fixtures, and the monthly report tools: Tool tests runs them on every run
        # The name check reads every file, so Tool tests runs it on every run too
        tools/tests/*.test.mjs | tools/tests/fixtures/playwright-results/* | tools/tests/fixtures/junit/* | tools/tests/fixtures/ci-metrics/* | tools/monthly/*) ;;
        tools/name-check.mjs) ;;
        # release.yml's plan: Workflows runs its cases and its dry run
        tools/release-plan.sh | tools/tests/release-plan.sh) on workflows ;;
        # Tool tests runs each of these against the real kit or its own config, on every run, and nothing else does
        tools/check-github-mentions.mjs | tools/hooks/* | tools/js-duplication.mjs | tools/kit-former-names.json) ;;
        tools/recipe-imports.mjs | tools/security-policy.mjs | tools/security-sinks.json | tools/tests/fixtures/release-checks/*) ;;
        # the PHP binary of the browser tests against a Docker demo (playwright.config.ts, PHP_BINARY)
        tools/demo-php) on demo ;;
        tools/*) on php static-site demo ;;

        # The demo app: its PHP tests, its static export and the browser tests run against it. docker-install.sh copies
        # the demo's Compose file and Caddyfile into a fresh Symfony Docker project.
        demo/compose.yaml | demo/frankenphp/Caddyfile) on php static-site demo fresh-install ;;
        demo/tests/* | demo/src/Controller/LabController.php) on php static-site demo contrast ;;
        demo/*) on php static-site demo ;;

        # A recipe's own tests (upstream specs, screenshot baselines): only the browser tests read them, and the
        # inventory check which specs exist
        */tests/*.spec.ts) on contrast demo ;;
        */tests/*) on demo ;;

        # The kit's README.md and INSTALL.md are read by people and agents, by Contrast (what the markdown teaches) and
        # by the package's references (Package); no install, lint, PHP test or page reads them
        README.md | INSTALL.md) on contrast package ;;

        # Anything else is part of the kit (recipes, kit.css, kit.js, manifest.json, .gitattributes...).
        # Contrast checks the theme's roles, what the markdown teaches and the palette colors of the recipes' templates
        # (tools/docs-lint.mjs), the recipe tables and the controllers' rows; it reads every file in a directory (a
        # recipe: tools/readme-pairing.mjs pairs its code with its README, tools/readme-versions.mjs its README with its
        # manifest) and the root files below
        *)
            # A recipe's README.md (one level down): the toolkit's lint checks its headings, the static site and the
            # browser tests' examples render its examples, Contrast reads it (above) and the references copy it
            # (Package); Kit PHP and the installs never read it
            if [[ $path =~ ^[^/]+/README\.md$ ]]; then
                on lint-kit static-site demo contrast package
                continue
            fi
            on lint-kit php static-site fresh-install demo
            case "$path" in
                # manifest.json: llms.txt holds its description, name and homepage (tools/llms-txt.mjs)
                */* | kit.css | manifest.json) on contrast ;;
            esac
            # What both archives hold (.gitattributes' export-ignore), and another directory under packages/, which
            # the archive also ships: Package checks its payload too. The kit's manifest.json and a recipe's
            # manifest.json (one level down, as the generator reads them) are inputs of the package's generated
            # references: Package checks they are up to date
            case "$path" in
                .gitattributes | packages/* | manifest.json) on package ;;
            esac
            if [[ $path =~ ^[^/]+/manifest\.json$ ]]; then on package; fi
            ;;
    esac

    # What Contrast's lints read wherever it lies: any markdown outside demo/ (tools/docs-lint.mjs, tools/icon-lint.mjs)
    # and a recipe's templates (tools/docs-lint.mjs, tools/icon-lint.mjs). The demo's copies of the recipes are not read.
    if [[ $path != demo/* && ( $path == *.md || $path =~ ^[^/]+/templates/ ) ]]; then on contrast; fi
done

for job in "${jobs[@]}"; do echo "$job=${run[$job]}"; done
