// Execute the release workflow's shell where its launcher, evidence and required verdict meet. Network, Docker and
// browsers are not needed: a failed launcher is stubbed, while its summary and diagnosis adapters are real tools.
// Run: node --test tools/tests/release-checks-workflow.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stepIn } from '../ci/step-attempts.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const file = '.github/workflows/release-checks.yml';
const workflow = readFileSync(join(root, file), 'utf8');
const indent = (line) => line.length - line.trimStart().length;
const unquote = (value) => value.replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');

function jobText(job) {
    const lines = workflow.split('\n');
    const first = lines.indexOf(`    ${job}:`);
    assert.ok(first >= 0, `missing job ${job}`);
    let end = first + 1;
    while (end < lines.length && !/^ {4}[a-z-]+:\s*$/.test(lines[end])) end++;
    return lines.slice(first, end).join('\n');
}

// Only this workflow's layout: a mapping per step, simple scalar values and multiline run/env/with values.
function steps(job) {
    const lines = jobText(job).split('\n');
    const list = [];
    let step;
    for (let i = lines.indexOf('        steps:') + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^ {12}- /.test(line)) list.push((step = { env: {}, with: {} }));
        const entry = /^ {12}(?:- | {2})([a-z-]+):\s?(.*)$/.exec(line);
        if (!entry || !step) continue;
        const [, key, value] = entry;
        if (key === 'run' && value.startsWith('|')) {
            const block = [];
            while (i + 1 < lines.length && (!lines[i + 1].trim() || indent(lines[i + 1]) > 14)) block.push(lines[++i]);
            const depth = Math.min(...block.filter((l) => l.trim()).map(indent));
            step.run = block.map((l) => l.slice(depth)).join('\n');
        } else if (key === 'with' || key === 'env') {
            while (i + 1 < lines.length && (!lines[i + 1].trim() || indent(lines[i + 1]) > 14)) {
                const item = /^ {18}([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[++i]);
                if (item) step[key][item[1]] = unquote(item[2]);
            }
        } else step[key] = unquote(value);
    }
    return list;
}

// Evaluate the scalar/boolean subset used by these conditions and checkout references. Unknown syntax fails closed.
function expressionValue(condition, context = {}, failed = false) {
    const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
        .replace(/\b(success|failure|always|cancelled)\(\)/g, (_, name) => JSON.stringify({ success: !failed, failure: failed, always: true, cancelled: false }[name]))
        .replace(/\b(?:steps|github|needs)\.[A-Za-z0-9_.-]+/g, (path) => JSON.stringify(path.split('.').reduce((value, part) => value?.[part], context) ?? ''));
    const operators = expression.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\b(?:true|false|[0-9]+)\b/g, '');
    assert.match(operators, /^[\s!<>=&|().-]*$/, `unsupported condition ${condition}`);
    return Function(`return (${expression});`)();
}

function holds(condition, context = {}, failed = false) {
    if (!condition) return !failed;
    const explicitStatus = /\b(?:success|failure|always|cancelled)\(\)/.test(condition);
    return (explicitStatus || !failed) && Boolean(expressionValue(condition, context, failed));
}

function scratch(t) {
    const dir = mkdtempSync(join(tmpdir(), 'release-checks-workflow-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const bin = join(dir, 'bin');
    const temp = join(dir, 'temp');
    mkdirSync(bin);
    mkdirSync(temp);
    return { dir, bin, temp };
}

function shell(script, fx, extra = {}) {
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
        cwd: fx.dir,
        encoding: 'utf8',
        env: { PATH: `${fx.bin}:${process.env.PATH}`, RUNNER_TEMP: fx.temp, ...extra },
    });
}

function executable(fx, name, script) {
    writeFileSync(join(fx.bin, name), `#!/usr/bin/env bash\n${script}\n`);
    chmodSync(join(fx.bin, name), 0o755);
}

const result = (outcome, outputs = {}) => ({ outcome, conclusion: outcome, outputs });
const context = (tests, outputs = {}) => ({
    github: { event_name: 'schedule' },
    steps: { tests: result(tests), results: result(outputs.status === 'valid' ? 'success' : 'failure', outputs), tested: result('success') },
});

test('a launcher failure retains its exit status and error, and missing browser evidence produces a captured-step diagnosis', (t) => {
    const fx = scratch(t);
    const error = 'Error: Project(s) "unknown-project" not found.';
    const stub = `echo '${error}' >&2\nexit 37`;
    executable(fx, 'node', stub);
    executable(fx, 'npx', stub);
    const launch = shell(stepIn(workflow, 'checks', 'tests').run, fx, { RELEASE_RUNNER: join(fx.dir, 'release-runner.mjs') });
    assert.equal(launch.status, 37, launch.stdout + launch.stderr);
    assert.match(launch.stdout + launch.stderr, /unknown-project/);
    assert.match(readFileSync(join(fx.temp, 'jev-tests.log'), 'utf8'), /unknown-project/);

    const report = join(fx.dir, 'playwright-results/results.json');
    const output = join(fx.temp, 'summary-output');
    const summary = spawnSync(process.execPath, [join(root, 'tools/ci/playwright-summary.mjs'), report], {
        cwd: fx.dir, encoding: 'utf8', env: { PATH: process.env.PATH, TESTS_OUTCOME: 'failure', GITHUB_OUTPUT: output },
    });
    assert.equal(summary.status, 2, summary.stdout + summary.stderr);
    assert.equal(existsSync(report), false, 'no fabricated browser report');
    const browserAttempts = JSON.parse(readFileSync(join(fx.dir, 'playwright-results/failed-attempts.json'), 'utf8'));
    assert.equal(browserAttempts.status, 'missing');
    assert.equal(browserAttempts.counts, null, 'missing evidence is not measured zero failures');
    assert.deepEqual(browserAttempts.attempts, []);

    const attempts = join(fx.temp, 'release-step-attempts.json');
    const capture = steps('checks').find((step) => step.id === 'step-attempts');
    const adapter = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', capture.run], {
        cwd: root, encoding: 'utf8', env: {
            PATH: process.env.PATH, RUNNER_TEMP: fx.temp, GITHUB_JOB: 'checks',
            RELEASE_STEPS: JSON.stringify({ tests: result('failure') }),
        },
    });
    assert.equal(adapter.status, 0, adapter.stderr);
    const data = JSON.parse(readFileSync(attempts, 'utf8'));
    assert.equal(data.attempts.length, 1);
    assert.equal(data.attempts[0].testId, 'checks::tests');
    assert.match(data.attempts[0].error, /unknown-project/);
    assert.match(data.attempts[0].error, /Command:/);
});

test('diagnosis selects browser attempts or the failed launcher log, and stays advisory without a secret', () => {
    const diagnosis = steps('checks').filter((step) => step.uses?.endsWith('/jev-diagnosis'));
    const browser = diagnosis.find((step) => step.with.attempts?.endsWith('playwright-results/failed-attempts.json'));
    const captured = diagnosis.find((step) => step !== browser);
    const capture = steps('checks').find((step) => step.id === 'step-attempts');
    assert.ok(browser, 'browser-attempt diagnosis remains present');
    assert.ok(captured, 'a failed launcher without browser attempts can be diagnosed');
    assert.equal(capture.env.RELEASE_STEPS, '${{ toJSON(steps) }}');
    assert.equal(capture['continue-on-error'], 'true');
    assert.equal(captured.with.attempts, '${{ runner.temp }}/release-step-attempts.json');
    for (const step of diagnosis) {
        assert.equal(step['continue-on-error'], 'true');
        assert.ok(Number(step['timeout-minutes']) > 0 && Number(step['timeout-minutes']) <= 3);
    }
    assert.doesNotMatch(jobText('checks'), /\bsecrets\s*(?:\.|\[)/);
    for (const [name, tests, outputs, failed, expected] of [
        ['configuration failed before a report', 'failure', { status: 'missing' }, true, [false, true]],
        ['failed browser test', 'failure', { status: 'valid', failed: '1', flaky: '0' }, true, [true, false]],
        ['retry-recovered browser test', 'success', { status: 'valid', failed: '0', flaky: '1' }, false, [true, false]],
        ['complete pass', 'success', { status: 'valid', failed: '0', flaky: '0' }, false, [false, false]],
        ['setup failure before tests', 'skipped', { status: 'not-reached' }, true, [false, true]],
    ]) {
        const ctx = context(tests, outputs);
        ctx.steps['step-attempts'] = result(holds(capture.if, ctx, failed) ? 'success' : 'skipped');
        assert.deepEqual([holds(browser.if, ctx, failed), holds(captured.if, ctx, failed)], expected, name);
    }
});

test('missing structural evidence remains fatal, and required evidence and browser steps cannot be tolerated', (t) => {
    const fx = scratch(t);
    const check = steps('checks');
    for (const id of ['tests', 'evidence', 'results', 'properties']) {
        assert.notEqual(check.find((step) => step.id === id)?.['continue-on-error'], 'true', `${id} must remain fatal`);
    }
    const evidence = spawnSync(process.execPath, [join(root, 'tools/ci/release-evidence.mjs'), '--project', 'release', join(fx.dir, 'missing.json')], { encoding: 'utf8' });
    assert.equal(evidence.status, 1, evidence.stdout + evidence.stderr);
});

test('the required verdict rejects a failed or skipped suite and target resolution, retaining only the trusted skips', (t) => {
    const fx = scratch(t);
    const verdict = steps('verdict').find((step) => step.run);
    for (const [event, changed, run, suite, expected] of [
        ['schedule', 'success', 'true', 'success', 0],
        ['schedule', 'success', 'true', 'failure', 1],
        ['schedule', 'success', 'true', 'skipped', 1],
        ['schedule', 'failure', '', 'skipped', 1],
        ['schedule', 'success', 'false', 'skipped', 0],
        ['workflow_dispatch', 'success', 'false', 'skipped', 1],
        ['pull_request', 'success', 'true', 'failure', 1],
        ['pull_request', 'success', 'true', 'skipped', 1],
        ['pull_request', 'success', 'false', 'skipped', 0],
        ['pull_request', 'failure', 'false', 'skipped', 1],
    ]) {
        const out = shell(verdict.run, fx, { EVENT: event, CHANGED: changed, RUN: run, SUITE: suite });
        assert.equal(out.status, expected, `${event}/${changed}/${run}/${suite}: ${out.stdout}${out.stderr}`);
    }
});

test('failed or pull-request runs cannot record a reusable pass marker', () => {
    const check = steps('checks');
    const record = check.find((step) => step.id === 'tested');
    const upload = check.find((step) => step.with.name?.startsWith('release-checks-passed-'));
    assert.ok(record && upload);
    for (const [event, failed, recorded, expected] of [
        ['schedule', false, 'success', true],
        ['workflow_dispatch', false, 'success', false],
        ['pull_request', false, 'success', false],
        ['schedule', true, 'success', false],
        ['workflow_dispatch', true, 'success', false],
        ['schedule', false, 'failure', false],
    ]) {
        const ctx = { github: { event_name: event }, steps: { tested: result(recorded) } };
        assert.equal(holds(record.if, ctx, failed) && holds(upload.if, ctx, failed), expected, `${event}/${failed}/${recorded}`);
    }
});

test('the scheduler reuses only an unexpired same-repository schedule pass from this workflow revision', (t) => {
    const fx = scratch(t);
    // gh's --jq filtering is part of the trust decision, so use jq against the API fixtures instead of prefiltering
    // canned ids in the stub. jq, like bash and git, is available on the workflow's Ubuntu runner.
    executable(fx, 'gh', `
case "$2" in
    */commits/dev) payload="$API_HEAD" ;;
    */actions/artifacts?*) echo "$2" >> "$API_CALLS"; payload="$API_ARTIFACTS" ;;
    */actions/runs/73) payload="$API_RUN" ;;
    *) echo "unexpected API path: $2" >&2; exit 2 ;;
esac
printf '%s' "$payload" | jq -r "$4"`);
    const target = 'a'.repeat(40);
    const definition = 'b'.repeat(40);
    const compare = steps('changed').find((step) => step.id === 'compare');
    for (const [name, modify, expected] of [
        ['trusted current schedule', () => {}, 'false'],
        ['manual pass', (a, run) => { run.event = 'workflow_dispatch'; }, 'true'],
        ['old workflow revision', (a, run) => { run.head_sha = 'c'.repeat(40); }, 'true'],
        ['failed scheduled run', (a, run) => { run.conclusion = 'failure'; }, 'true'],
        ['another workflow', (a, run) => { run.path = '.github/workflows/ci.yml'; }, 'true'],
        ['fork artifact', (a) => { a.workflow_run.head_repository_id = 11; }, 'true'],
        ['expired artifact', (a) => { a.expired = true; }, 'true'],
    ]) {
        const artifact = { expired: false, workflow_run: { id: 73, repository_id: 10, head_repository_id: 10 } };
        const run = { id: 73, path: file, event: 'schedule', head_sha: definition, conclusion: 'success' };
        modify(artifact, run);
        const output = join(fx.temp, 'compare-output');
        const calls = join(fx.temp, 'api-calls');
        writeFileSync(output, '');
        writeFileSync(calls, '');
        const actual = shell(compare.run, fx, {
            EVENT: 'schedule', REPO: 'example/project', WORKFLOW_SHA: definition,
            GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(fx.temp, 'summary'), API_CALLS: calls,
            API_HEAD: JSON.stringify({ sha: target }), API_ARTIFACTS: JSON.stringify({ artifacts: [artifact] }), API_RUN: JSON.stringify(run),
        });
        assert.equal(actual.status, 0, `${name}: ${actual.stdout}${actual.stderr}`);
        const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=')));
        assert.equal(values.run, expected, name);
        assert.equal(values.ref, target, name);
        assert.equal(values.target_ref, 'dev', name);
        assert.match(readFileSync(calls, 'utf8'), new RegExp(`name=release-checks-passed-v2-${target}&`), 'legacy marker names are never queried');
    }
});

test('a pull request skips the suite only after a same-repository pass on the same base, with nothing it reads changed since', (t) => {
    const fx = scratch(t);
    executable(fx, 'gh', `
case "$2" in
    */workflows/release-checks.yml/runs?*) payload="$API_RUNS" ;;
    */actions/runs/*/jobs?*) payload="$API_JOBS" ;;
    *) echo "unexpected API path: $2" >&2; exit 2 ;;
esac
printf '%s' "$payload" | jq -r "$4"`);
    const git = (...args) => {
        const out = spawnSync('git', args, {
            cwd: fx.dir, encoding: 'utf8',
            env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
        });
        assert.equal(out.status, 0, out.stderr);
        return out.stdout.trim();
    };
    const commit = (path, text) => {
        mkdirSync(join(fx.dir, path, '..'), { recursive: true });
        writeFileSync(join(fx.dir, path), text);
        git('add', path);
        git('-c', 'user.name=Local proof', '-c', 'user.email=proof@example.invalid', 'commit', '-q', '-m', `test: ${path}`);
        return git('rev-parse', 'HEAD');
    };
    git('init', '-q', '--initial-branch=main');
    const base = commit('kit.css', 'base');
    const passed = commit('calendar/Calendar.html.twig', 'passed');
    const docs = (() => {
        commit('CHANGELOG.md', 'release');
        commit('llms.txt', 'links');
        commit('docs/TESTING.md', 'docs');
        commit('AGENTS.md', 'rules');
        return commit('packages/uxor/README.md', 'package');
    })();
    const code = commit('calendar/Calendar.html.twig', 'changed');
    const workflowChange = (() => {
        git('checkout', '-q', docs);
        return commit('.github/workflows/release-checks.yml', 'changed');
    })();
    const compare = steps('changed').find((step) => step.id === 'compare');
    for (const [name, head, modify, expected, baseSha = base] of [
        ['only paths the suite never reads', docs, () => {}, 'false'],
        ['same head', passed, () => {}, 'false'],
        ['a path the suite reads', code, () => {}, 'true'],
        ['the workflow itself', workflowChange, () => {}, 'true'],
        ['the earlier run skipped the suite', docs, (run, jobs) => { jobs[0].conclusion = 'skipped'; }, 'true'],
        ['the base moved since', docs, (run) => { run.run_started_at = '2025-12-01T00:00:00Z'; }, 'true'],
        ['a fork run', docs, (run) => { run.head_repository.full_name = 'fork/project'; }, 'true'],
        ['an unknown commit', docs, (run) => { run.head_sha = 'd'.repeat(40); }, 'true'],
        ['no earlier run', docs, (run, jobs, runs) => { runs.length = 0; }, 'true'],
        ['an unknown head', 'f'.repeat(40), () => {}, 'true'],
        ['an unknown base', docs, () => {}, 'true', 'f'.repeat(40)],
    ]) {
        const run = { id: 81, head_sha: passed, run_started_at: '2026-02-01T00:00:00Z', head_repository: { full_name: 'example/project' } };
        const jobs = [{ name: 'Release suite', conclusion: 'success' }, { name: 'Release checks', conclusion: 'success' }];
        const runs = [run];
        modify(run, jobs, runs);
        const output = join(fx.temp, 'compare-output');
        writeFileSync(output, '');
        const actual = shell(compare.run, fx, {
            EVENT: 'pull_request', REPO: 'example/project', HEAD_SHA: head, BASE_SHA: baseSha,
            GITHUB_SHA: 'e'.repeat(40), GITHUB_REF_NAME: '170/merge',
            GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(fx.temp, 'summary'),
            API_RUNS: JSON.stringify({ workflow_runs: runs }), API_JOBS: JSON.stringify({ jobs }),
        });
        assert.equal(actual.status, 0, `${name}: ${actual.stdout}${actual.stderr}`);
        const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=')));
        assert.equal(values.run, expected, name);
        assert.equal(values.ref, 'e'.repeat(40), name);
        assert.equal(values.target_ref, '170/merge', name);
    }
});

test('checkout provenance must match the frozen target before the workflow exposes a tested revision', (t) => {
    const fx = scratch(t);
    const actual = 'a'.repeat(40);
    executable(fx, 'git', `echo '${actual}'`);
    const provenance = stepIn(workflow, 'checks', 'provenance');
    const output = join(fx.temp, 'environment');
    for (const resolved of [actual, 'b'.repeat(40)]) {
        writeFileSync(output, '');
        const run = shell(provenance.run, fx, { RESOLVED_SHA: resolved, RESOLVED_REF: 'dev', GITHUB_ENV: output });
        if (resolved === actual) {
            assert.equal(run.status, 0, run.stdout + run.stderr);
            const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=')));
            assert.deepEqual(values, { TESTED_SHA: actual, TESTED_REF: 'dev', RESOLVED_SHA: resolved, RESOLVED_REF: 'dev' });
        } else {
            assert.equal(run.status, 1, run.stdout + run.stderr);
            assert.match(run.stdout + run.stderr, /differs from resolved target/);
            assert.equal(readFileSync(output, 'utf8'), '', 'a mismatched checkout gets no tested revision');
        }
    }
});

test('checkout trust rejects a substituted resolver revision and a moving dev head before executing target code', (t) => {
    const fx = scratch(t);
    const git = (...args) => {
        const run = spawnSync('git', args, { cwd: fx.dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
        assert.equal(run.status, 0, run.stdout + run.stderr);
        return run.stdout.trim();
    };
    git('init', '--initial-branch=dev');
    const commit = (text) => {
        writeFileSync(join(fx.dir, 'candidate.txt'), `${text}\n`);
        git('add', 'candidate.txt');
        git('-c', 'user.name=Local proof', '-c', 'user.email=proof@example.invalid', 'commit', '-m', 'test: candidate revision');
        return git('rev-parse', 'HEAD');
    };
    const eventSha = commit('reviewed event revision');
    git('checkout', '-b', 'outside-maintained-branch');
    const substitutedSha = commit('resolver-selected code outside the maintained branch');
    git('checkout', 'dev');
    const advancedDev = commit('dev advanced after target resolution');
    const checkout = steps('checks').find((step) => step.id === 'checkout');
    const provenance = stepIn(workflow, 'checks', 'provenance');
    const output = join(fx.temp, 'environment');
    const executed = join(fx.dir, 'target-executed');

    // Render the actual checkout action's ref, perform that checkout using real Git, then run the actual provenance
    // shell. Only after it passes may a target command run. Resolver output is not its own source of trust: the
    // maintained branch or immutable triggering event must independently agree with the frozen target.
    for (const [name, event, resolved, expectedCheckout, expectedStatus] of [
        ['schedule cannot substitute another commit', 'schedule', substitutedSha, advancedDev, 1],
        ['manual dispatch cannot substitute another commit', 'workflow_dispatch', substitutedSha, eventSha, 1],
        ['pull request cannot substitute another commit', 'pull_request', substitutedSha, eventSha, 1],
        ['dev advancing after resolution fails closed', 'schedule', eventSha, advancedDev, 1],
        ['stable scheduled target executes', 'schedule', advancedDev, advancedDev, 0],
        ['manual dispatch retains its immutable event', 'workflow_dispatch', eventSha, eventSha, 0],
        ['pull request retains its immutable event', 'pull_request', eventSha, eventSha, 0],
    ]) {
        const ref = expressionValue(checkout.with.ref, {
            github: { event_name: event, sha: eventSha },
            needs: { changed: { outputs: { ref: resolved } } },
        });
        git('checkout', '--detach', ref);
        const actual = git('rev-parse', 'HEAD');
        writeFileSync(output, '');
        rmSync(executed, { force: true });
        const checked = shell(`${provenance.run}\nprintf 'target command ran\\n' > target-executed`, fx, {
            RESOLVED_SHA: resolved, RESOLVED_REF: event === 'schedule' ? 'dev' : 'event', GITHUB_ENV: output,
        });
        assert.equal(checked.status, expectedStatus, `${name}: ${checked.stdout}${checked.stderr}`);
        assert.equal(actual, expectedCheckout, name);
        assert.equal(existsSync(executed), expectedStatus === 0, name);
        if (expectedStatus) {
            assert.match(checked.stdout + checked.stderr, /differs from resolved target/, name);
            assert.equal(readFileSync(output, 'utf8'), '', `${name}: no false tested revision is exported`);
        }
    }

    // A missing maintained branch must not turn an identically named tag into trusted scheduled code.
    git('branch', '-D', 'dev');
    git('tag', 'dev', substitutedSha);
    const missingBranch = spawnSync('git', ['checkout', '--detach', expressionValue(checkout.with.ref, {
        github: { event_name: 'schedule', sha: eventSha },
        needs: { changed: { outputs: { ref: substitutedSha } } },
    })], { cwd: fx.dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.notEqual(missingBranch.status, 0, 'a dev tag cannot replace the maintained branch');
});

test('issue classification names the first causal failure without turning advisory failures into failures', async () => {
    const { classifyFailure } = await import('../ci/release-failure.mjs');
    const check = steps('checks');
    const name = (id) => check.find((step) => step.id === id).name;
    const failed = result('failure');
    const passed = result('success');
    const advisory = { outcome: 'failure', conclusion: 'success' };
    for (const [context, status, category, id] of [
        [{ start: failed, tests: result('skipped'), results: failed }, 'not-reached', 'setup failure', 'start'],
        [{ tests: failed, evidence: failed, results: failed }, 'missing', 'Playwright invocation failure (report unavailable)', 'tests'],
        [{ tests: failed, evidence: passed, results: result('success', { failed: '1' }) }, 'valid', 'browser test failure', 'tests'],
        [{ tests: passed, evidence: failed, results: passed }, 'valid', 'incomplete release evidence', 'evidence'],
        [{ tests: passed, evidence: passed, properties: failed, results: passed }, 'valid', 'PHP property failure', 'properties'],
        [{ tests: passed, results: failed }, 'invalid', 'missing or invalid browser evidence', 'results'],
        [{ tests: passed, evidence: passed, properties: passed, results: passed, timings: advisory, diagnosis: advisory }, 'valid', '', null],
    ]) {
        assert.deepEqual(classifyFailure(context, status), { category, step: id ? name(id) : '' });
    }
});

test('issue classification CLI preserves unavailable counts and exports only its category and causal step', (t) => {
    const fx = scratch(t);
    const output = join(fx.temp, 'classification-output');
    const run = spawnSync(process.execPath, [join(root, 'tools/ci/release-failure.mjs')], {
        cwd: fx.dir, encoding: 'utf8', env: {
            PATH: process.env.PATH, GITHUB_OUTPUT: output, REPORT_STATUS: 'missing',
            RELEASE_STEPS: JSON.stringify({ tests: result('failure'), evidence: result('failure'), results: result('failure') }),
        },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const data = JSON.parse(readFileSync(join(fx.dir, 'playwright-results/release-failure.json'), 'utf8'));
    assert.equal(data.category, 'Playwright invocation failure (report unavailable)');
    assert.equal(data.step, 'Playwright (release checks)');
    assert.equal(data.counts, undefined, 'classification does not manufacture browser measurements');
    const exported = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=')));
    assert.deepEqual(exported, { category: data.category, step: data.step });
});

test('a valid report with a global error and no failed test does not claim a browser test failure', (t) => {
    const fx = scratch(t);
    mkdirSync(join(fx.dir, 'playwright-results'));
    // Shape captured from locked Playwright 1.58.2 after a real globalSetup exception: discovery succeeds, the
    // run exits 1 and writes a valid JSON report, but no browser test has an attempt. No browser install is needed
    // for this regression; the summary and classifier are the actual CLI tools, not substitutes for them.
    const error = 'Error: Global setup failed before any browser test';
    writeFileSync(join(fx.dir, 'playwright-results/results.json'), JSON.stringify({
        config: { version: '1.58.2', rootDir: fx.dir, projects: [{ name: 'release' }, { name: 'release-dark' }, { name: 'release-harsh' }] },
        suites: [],
        errors: [{ message: error }],
        stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
    }));
    const summaryOutput = join(fx.temp, 'summary-output');
    const summary = spawnSync(process.execPath, [join(root, 'tools/ci/playwright-summary.mjs'), 'playwright-results/results.json'], {
        cwd: fx.dir, encoding: 'utf8', env: { PATH: process.env.PATH, TESTS_OUTCOME: 'failure', GITHUB_OUTPUT: summaryOutput },
    });
    assert.equal(summary.status, 0, summary.stdout + summary.stderr);
    const outputs = Object.fromEntries(readFileSync(summaryOutput, 'utf8').trim().split('\n').map((line) => line.split('=')));
    assert.equal(outputs.status, 'valid');
    assert.equal(outputs.failed, '0');
    const attempts = JSON.parse(readFileSync(join(fx.dir, 'playwright-results/failed-attempts.json'), 'utf8'));
    assert.deepEqual(attempts.attempts, []);
    assert.deepEqual(attempts.globalErrors, [error]);
    assert.deepEqual(attempts.counts, { passed: 0, failed: 0, flaky: 0, skipped: 0 });

    const classified = spawnSync(process.execPath, [join(root, 'tools/ci/release-failure.mjs')], {
        cwd: fx.dir, encoding: 'utf8', env: {
            PATH: process.env.PATH, REPORT_STATUS: outputs.status,
            RELEASE_STEPS: JSON.stringify({ tests: result('failure'), evidence: result('failure'), results: result('success', outputs) }),
        },
    });
    assert.equal(classified.status, 0, classified.stdout + classified.stderr);
    const failure = JSON.parse(readFileSync(join(fx.dir, 'playwright-results/release-failure.json'), 'utf8'));
    assert.deepEqual(failure, { category: 'Playwright run failure (no failed test reported)', step: 'Playwright (release checks)' });
});
