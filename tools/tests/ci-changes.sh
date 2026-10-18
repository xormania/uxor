#!/usr/bin/env bash
#
# tools/ci-changes.sh: for each change below, the CI jobs it runs. A job missing from a case's list must be skipped.
# check takes the changed paths; check_git makes the change in a scratch repository and reads its paths as CI does
# (git diff --name-only --no-renames), so a deletion or a rename is classified by every path it touches.

set -euo pipefail
cd "$(dirname "$0")/../.."

failures=0
check() {
    local expected="$1"; shift
    local actual
    actual=$(printf '%s\n' "$@" | tools/ci-changes.sh | sed -n 's/=true$//p' | paste -sd ' ' -)
    if [ "$actual" != "$expected" ]; then
        echo "FAIL: $* -> '$actual', expected '$expected'"
        failures=$((failures + 1))
    fi
}

# the change, as git commands run in a scratch repository holding every workflow of this one
check_git() {
    local expected="$1" change="$2"
    local repo actual
    repo=$(mktemp -d)
    (
        cd "$repo"
        git init -q && mkdir -p .github/workflows
        cp "$OLDPWD"/.github/workflows/*.yml .github/workflows/
        git add -A && git -c user.name=t -c user.email=t@t commit -qm base
        eval "$change"
        git -c user.name=t -c user.email=t@t commit -qam change
    )
    actual=$(git -C "$repo" diff --name-only --no-renames HEAD^ HEAD | tools/ci-changes.sh | sed -n 's/=true$//p' | paste -sd ' ' -)
    rm -rf "$repo"
    if [ "$actual" != "$expected" ]; then
        echo "FAIL: $change -> '$actual', expected '$expected'"
        failures=$((failures + 1))
    fi
}

all='lint-kit php static-site fresh-install contrast demo workflows package'
kit='lint-kit php static-site fresh-install demo'
kit_contrast='lint-kit php static-site fresh-install contrast demo'

# Read by people only
check ''                          LICENSE NOTICE .github/dependabot.yml

# Read by people and agents: Contrast checks the generated lists, the plans and what the markdown teaches
check 'contrast'                  docs/TESTING.md CHANGELOG.md FOR-AGENTS.md .github/pull_request_template.md
check 'contrast'                  docs/ROADMAP.md CONTRIBUTING.md AGENTS.md
check 'contrast'                  tools/docs-lint.mjs tools/llms-txt.mjs llms.txt
check 'contrast'                  tools/test-inventory.mjs
check 'contrast'                  tools/icon-lint.mjs
check ''                          tools/tests/icon-lint.test.mjs
# What the lints read wherever it lies: a recipe's templates (icon-lint) and any markdown outside demo/ (docs-lint,
# icon-lint); the demo's copies of the recipes are not read
check "$kit_contrast"             input/templates/components/Input.html.twig
check "$kit_contrast"             dropdown/templates/components/Dropdown/SubTrigger.html.twig
check 'contrast demo'             tests/e2e/NOTES.md
check 'php static-site contrast demo' tools/NOTES.md
check 'php static-site demo'      demo/templates/components/Input.html.twig
check 'php static-site demo'      demo/README.md
check 'static-site contrast'      tools/fence-coverage.mjs
check 'static-site'               tools/build-static.sh
check "$kit_contrast"             INSTALL.md

# A workflow: actionlint reads it, and the jobs that run what it runs check that part (a workflow's own triggers run
# the rest: audit.yml and codeql.yml run on the pull request that changes them)
check 'static-site workflows'     .github/workflows/pages.yml
check 'static-site fresh-install workflows' .github/workflows/release.yml
check 'workflows'                 .github/workflows/audit.yml
check 'workflows'                 .github/workflows/codeql.yml
check 'workflows'                 .github/actionlint.yaml
# monthly.yml runs on its schedule and by hand, never on a push: actionlint only. Its tools' cases (tools/monthly/) run
# in Tool tests, on every run, so they select no job; the browser tests' opt-in coverage (tests/e2e/coverage.ts) is part
# of the browser tests
check 'workflows'                 .github/workflows/monthly.yml
# release-checks.yml runs on the release pull request, daily and by hand, never on a push: the browser job runs its
# setup; its report tool (tools/ci/release-timings.mjs) is the browser job's, its cases are Tool tests', the baseline
# is read by the release checks only, with the browser tests
check 'demo workflows'            .github/workflows/release-checks.yml
check 'demo'                      tools/ci/release-timings.mjs tests/perf/baseline.json
check ''                          tools/tests/release-timings.test.mjs
check 'contrast demo'             tests/e2e/release.fuzz.spec.ts
check ''                          tools/monthly/js-coverage.mjs tools/monthly/php-scope.php tools/monthly/monthly.test.mjs
check 'demo'                      tests/e2e/coverage.ts
check "$all"                      .github/workflows/ci.yml
check "$all"                      .github/workflows/nightly.yml
check "$all"                      .github/actions/setup/action.yml
check_git 'static-site workflows' 'git rm -q .github/workflows/pages.yml'
check_git 'workflows'             'git rm -q .github/workflows/codeql.yml'
check_git 'workflows'             'git rm -q .github/workflows/monthly.yml'
check_git 'demo workflows'        'git rm -q .github/workflows/release-checks.yml'
check_git "$all"                  'git mv .github/workflows/pages.yml .github/workflows/site.yml'
check_git "$all"                  'git mv .github/workflows/ci.yml .github/workflows/checks.yml'

# A path no rule names is part of the kit
# A manifest makes a directory a recipe, which the inventory check (Contrast) reads
check "$kit_contrast"             new-recipe/manifest.json
check "$kit_contrast"             tabs/manifest.json
check "$kit"                      some-new-file.txt
# the kit's manifest: llms.txt (Contrast) holds its name, homepage and description
check "$kit_contrast"             manifest.json
check 'contrast'                  tools/kit-identity.mjs
# the name check and its cases: Tool tests, on every run
check ''                          tools/name-check.mjs tools/tests/name-check.test.mjs

check "$all"                      tools/ci-changes.sh
check 'workflows'                 tools/release-plan.sh
check 'workflows'                 tools/tests/release-plan.sh
# tools/test-inventory.mjs (Contrast) reads which specs and PHPUnit tests exist, the lab's routes and the recipes'
# controllers; a helper or a baseline it does not read
check 'contrast demo'             tests/e2e/lab.side-nav.spec.ts
check 'demo'                      tests/e2e/transitions.ts
check 'contrast demo'             tabs/tests/tabs.spec.ts
check 'demo'                      playwright.config.ts tools/prepare-tests.mjs tools/tests/prepare-tests.test.mjs
check 'demo'                      tools/playwright-image.mjs tools/playwright-image.json
check ''                          tools/tests/playwright-image.test.mjs
check 'demo'                      alert/tests/screenshots/default-light.png
check 'php static-site contrast demo' demo/tests/Editor/EditorTypeTest.php
check 'php static-site contrast demo' demo/src/Controller/LabController.php
check 'contrast demo'             package-lock.json
check 'contrast'                  tools/contrast/pairs.json
check 'php static-site demo'      demo/src/Demo/DataTableCollector.php
check 'php'                       tools/phpstan.neon
check 'fresh-install'             tools/tests/fresh-install.sh
check 'fresh-install'             tools/tests/install-scenario.sh
check 'fresh-install'             tools/tests/live-action.php
check 'fresh-install'             tools/tests/fixtures/fresh-app/templates/home.html.twig
check 'demo'                      tools/tests/fixtures/sync-kit/manifest.json
check 'demo'                      tools/ci/playwright-summary.mjs
# the job metrics run in the browser job (job) and in CI result, which runs on every run (run)
check 'demo'                      tools/ci/ci-metrics.mjs
# the shard plan runs in the browser job (plan, verify) and in CI result (timings); the timings it reads are a test file
check 'demo'                      tools/ci/shard-plan.mjs
check 'demo'                      tests/shard-timings.json
check ''                          tools/tests/shard-plan.test.mjs
check 'php'                       tools/ci/junit-attempts.mjs
check 'php demo'                  tools/ci/jev-diagnosis.mjs tools/ci/jev-ci.json
# a failed step's log as Jev's attempts: the jobs run it only after a failure, so only its cases (Tool tests) check it
check ''                          tools/ci/step-attempts.mjs
# a failed step's log as Jev's attempts: the jobs run it only after a failure, so only its cases (Tool tests) check it
check ''                          tools/ci/step-attempts.mjs
# the Jev step's composite action: a passing job never runs it; actionlint (Workflows) checks every call's inputs
check 'workflows'                 .github/actions/jev-diagnosis/action.yml
# tools' cases and their fixtures run in Tool tests, on every run: no other job
check ''                          tools/tests/playwright-summary.test.mjs tools/tests/fixtures/playwright-results/timed.json
check ''                          tools/tests/fixtures/junit/phpunit.xml tools/tests/fixtures/junit/node-test.xml
check ''                          tools/tests/ci-metrics.test.mjs tools/tests/fixtures/ci-metrics/jobs.jsonl
check 'php static-site demo'      tools/sync-demo
check 'php static-site fresh-install demo' demo/compose.yaml
check 'php static-site fresh-install demo' demo/frankenphp/Caddyfile
check "$kit_contrast"             side-nav/assets/controllers/side_nav_controller.js
check "$kit_contrast"             side-nav/README.md
check "$kit_contrast"             kit.css
# the theme recipe's copy of kit.css (contrast check) and a recipe's template (tools/docs-lint.mjs: no palette color)
check "$kit_contrast"             theme/assets/styles/uxor.css
check "$kit_contrast"             button/templates/components/Button.html.twig
check "$kit_contrast"             layouts/templates/layouts/app.html.twig
# what both archives hold, the kit's and the Composer package's: the kit's jobs and Package
check "$kit package"              .gitattributes
# tools/readme-pairing.mjs (Contrast) pairs a recipe's code with its README, tools/readme-versions.mjs its README with
# its manifest: any file of a recipe runs Contrast, a README alone and a manifest alone too
check "$kit_contrast"             alert/templates/components/Alert.html.twig
check "$kit_contrast"             data-table/src/Table/DataTable.php
check "$kit_contrast"             alert/README.md
check "$kit_contrast"             alert/manifest.json
check_git "$kit_contrast"         'mkdir -p alert/templates && echo a > alert/templates/x.html.twig && git add alert'
check 'contrast'                  tools/readme-pairing.mjs tools/readme-versions.mjs
check ''                          tools/tests/readme-pairing.test.mjs
check ''                          tools/tests/jev-diagnosis.test.mjs
check ''                          tools/tests/step-attempts.test.mjs
check "$kit_contrast"             docs/NOTES.md kit.css

# The Composer package xormania/uxor. Its root metadata is in the kit's archive too (Lint kit, Fresh install); the lock
# file is the package's alone; its implementation and tests run Package, its markdown Contrast too. A recipe's README
# is copied into the package's references, whose freshness is not checked yet: a recipe does not run Package
check 'lint-kit fresh-install package' composer.json
check 'package'                   composer.lock
check 'package'                   packages/uxor/src/Operations.php
check 'package'                   packages/uxor/tests/OperationsTest.php
check 'package'                   packages/uxor/bin/uxor packages/uxor/tools/check-package.py
check 'contrast package'          packages/uxor/skills/build/SKILL.md
check 'contrast package'          packages/uxor/INSTRUCTIONS.md
# the independent consumer and its development environment (packages/uxor/dev/): Package runs its checks. Its own
# package.json and browser check are not the kit's browser suite: they run neither Contrast nor the browser job
check 'package'                   packages/uxor/dev/run.py packages/uxor/dev/tests/test_runner.py
check 'package'                   packages/uxor/dev/app/composer.lock packages/uxor/dev/app/templates/development.html.twig
check 'package'                   packages/uxor/dev/package.json packages/uxor/dev/e2e/customer-workflow.spec.mjs
check 'package'                   packages/uxor/dev/compose.yaml packages/uxor/dev/Caddyfile
check 'contrast package'          packages/uxor/dev/README.md
# another directory under packages/ is shipped in the same archive: the kit's jobs, as for any unlisted path, and Package
check "$kit_contrast package"     packages/other/x

if [ "$failures" -gt 0 ]; then
    exit 1
fi
echo 'ci-changes: every case runs the expected jobs'
