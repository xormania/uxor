#!/usr/bin/env bash
#
# Which CI jobs a change could affect. Reads the changed paths, one per line, on stdin and prints one
# `<job>=true|false` line per job of .github/workflows/ci.yml, for $GITHUB_OUTPUT. A job is skipped only when none of
# the paths could change what it checks. A path not listed counts as part of the kit, which runs every job but
# Contrast and Workflows (a recipe's templates and markdown run Contrast too). A workflow runs Workflows (actionlint)
# and the jobs that run the same commands it runs; a workflow or a file under .github/ that is not listed runs
# everything.
#
# Usage: git diff --name-only --no-renames <base> HEAD | tools/ci-changes.sh
# Test:  tools/tests/ci-changes.sh

set -euo pipefail

jobs=(lint-kit php static-site fresh-install contrast demo workflows)
declare -A run
for job in "${jobs[@]}"; do run[$job]=false; done

all() { for job in "${jobs[@]}"; do run[$job]=true; done; }
on() { for job in "$@"; do run[$job]=true; done; }

while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
        # The workflow and this script decide what runs: a change to either runs everything
        .github/workflows/ci.yml | tools/ci-changes.sh | tools/tests/ci-changes.sh) all ;;

        # Read by people and agents: Contrast checks the generated lists, the plans' status (tools/llms-txt.mjs
        # reads CHANGELOG.md for the links' ref) and what the markdown teaches (tools/docs-lint.mjs)
        docs/* | CHANGELOG.md | CONTRIBUTING.md | FOR-AGENTS.md | AGENTS.md | SECURITY.md) on contrast ;;
        .github/pull_request_template.md) on contrast ;;
        LICENSE | NOTICE | .github/dependabot.yml) ;;

        # The other workflows. CI cannot run them (they deploy, tag or upload), so it runs the jobs that run what they
        # run: pages.yml builds the static site, release.yml checks the install from GitHub (docker-install.sh) and
        # calls pages.yml. audit.yml and codeql.yml run themselves on the pull request that changes them.
        .github/workflows/pages.yml) on static-site workflows ;;
        .github/workflows/release.yml) on static-site fresh-install workflows ;;
        .github/workflows/audit.yml | .github/workflows/codeql.yml | .github/actionlint.yaml) on workflows ;;
        # monthly.yml runs on its schedule and by hand on dev, never on a push, and no job here runs what it runs (the
        # browser tests' opt-in coverage, tests/e2e/coverage.ts, is part of the browser tests below)
        .github/workflows/monthly.yml) on workflows ;;
        # release-checks.yml runs on the release pull request, daily on dev and by hand, never on a push: the browser
        # job runs its setup (the demo's image and start, the sync, Playwright in the pinned image) and the tests it
        # runs (the @release ones, left out there, run with the same projects and fixtures)
        .github/workflows/release-checks.yml) on demo workflows ;;
        .github/*) all ;;

        # The browser tests and their tools. tools/test-inventory.mjs (Contrast) reads which specs exist, the accessibility
        # scan's list of lab pages and, below, the PHPUnit tests, the lab's routes and which recipes ship a controller
        tests/e2e/*.spec.ts) on contrast demo ;;
        tests/* | playwright.config.ts | tools/prepare-tests.mjs) on demo ;;
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
        # the rest (the results summary) is the browser job's
        tools/ci/junit-attempts.mjs) on php ;;
        tools/ci/jev-diagnosis.mjs | tools/ci/jev-ci.json) on php demo ;;
        tools/ci/*) on demo ;;
        # Tools' cases and their fixtures, and the monthly report tools: Tool tests runs them on every run
        # The name check reads every file, so Tool tests runs it on every run too
        tools/tests/*.test.mjs | tools/tests/fixtures/playwright-results/* | tools/tests/fixtures/junit/* | tools/monthly/*) ;;
        tools/name-check.mjs) ;;
        # release.yml's plan: Workflows runs its cases and its dry run
        tools/release-plan.sh | tools/tests/release-plan.sh) on workflows ;;
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

        # Anything else is part of the kit (recipes, kit.css, kit.js, manifest.json, README.md, .gitattributes...).
        # Contrast checks the theme's roles, what the markdown teaches and the palette colors of the recipes' templates
        # (tools/docs-lint.mjs), the recipe tables and the controllers' rows; it reads every file in a directory (a
        # recipe: tools/readme-pairing.mjs pairs its code with its README, tools/readme-versions.mjs its README with its
        # manifest) and the root files below
        *)
            on lint-kit php static-site fresh-install demo
            case "$path" in
                # manifest.json: llms.txt holds its description, name and homepage (tools/llms-txt.mjs)
                */* | kit.css | README.md | INSTALL.md | manifest.json) on contrast ;;
            esac
            ;;
    esac

    # What Contrast's lints read wherever it lies: any markdown outside demo/ (tools/docs-lint.mjs, tools/icon-lint.mjs)
    # and a recipe's templates (tools/docs-lint.mjs, tools/icon-lint.mjs). The demo's copies of the recipes are not read.
    if [[ $path != demo/* && ( $path == *.md || $path =~ ^[^/]+/templates/ ) ]]; then on contrast; fi
done

for job in "${jobs[@]}"; do echo "$job=${run[$job]}"; done
