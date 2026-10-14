// Execute CI's actual job-selection and result shell, with Git history and a read-only GitHub API fixture.
// No Actions runner or network is needed; git, bash and jq are the same command-line dependencies as the workflow.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const jobs = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows'];
const feature = 'feat/upgradeable-components';

// Read only this workflow's mapping-per-step layout and literal run blocks, not YAML in general.
function runBlock(job, key, value) {
    const lines = workflow.split('\n');
    const start = lines.indexOf(`    ${job}:`);
    assert.ok(start >= 0, `missing ${job} job`);
    const end = lines.findIndex((line, i) => i > start && /^ {4}[a-z-]+:/.test(line));
    const section = lines.slice(start, end < 0 ? undefined : end);
    const step = section.indexOf(`            - ${key}: ${value}`);
    assert.ok(step >= 0, `missing ${value} step`);
    const next = section.findIndex((line, i) => i > step && /^ {12}- /.test(line));
    const block = section.slice(step, next < 0 ? undefined : next);
    const run = block.indexOf('              run: |');
    assert.ok(run >= 0, `missing literal run block for ${value}`);
    const shell = [];
    for (const line of block.slice(run + 1)) {
        if (line.trim() && !line.startsWith('                  ')) break;
        shell.push(line.slice(18));
    }
    return `${shell.join('\n')}\n`;
}

const selection = runBlock('changes', 'id', 'jobs');
const verdict = runBlock('result', 'name', 'Every job passed or was skipped');

function git(repo, ...args) {
    const result = spawnSync('git', [
        '-c', 'user.name=CI test', '-c', 'user.email=ci@example.invalid',
        '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args,
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
}

function change(fx, path, contents = 'fixture\n') {
    const file = join(fx.repo, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    git(fx.repo, 'add', '--', path);
    git(fx.repo, 'commit', '-qm', `change ${path}`);
}

function fixture(t) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-profile-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const repo = join(dir, 'repo');
    const bin = join(dir, 'bin');
    mkdirSync(join(repo, 'tools'), { recursive: true });
    mkdirSync(bin);
    git(repo, 'init', '-q', '-b', 'topic');
    copyFileSync(join(root, 'tools/ci-changes.sh'), join(repo, 'tools/ci-changes.sh'));
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'base classifier');
    const dev = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'update-ref', 'refs/remotes/origin/dev', dev);
    const fx = { dir, repo, bin, dev };
    // Integration already contains a kit change. A sibling's comparison must exclude it.
    change(fx, 'button/src/Integrated.php');
    fx.integration = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'update-ref', `refs/remotes/origin/${feature}`, fx.integration);
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + '\\n');
if (process.env.GH_FAIL === 'true') { console.error('API unavailable'); process.exit(19); }
if (args.shift() !== 'api') throw new Error('Only read-only API calls are allowed');
let endpoint, query;
const fields = new URLSearchParams();
while (args.length) {
    const arg = args.shift();
    if (arg === '--method') { if (args.shift() !== 'GET') throw new Error('Only GET is allowed'); }
    else if (arg === '--paginate') {}
    else if (arg === '--jq') query = args.shift();
    else if (arg === '-f') { const field = args.shift(); const split = field.indexOf('='); fields.set(field.slice(0, split), field.slice(split + 1)); }
    else if (arg.startsWith('repos/')) endpoint = arg;
    else throw new Error('Unexpected argument ' + arg);
}
const url = new URL(endpoint, 'https://api.invalid/');
if (url.pathname !== '/repos/example/repository/pulls' || !query) throw new Error('Unexpected API request');
for (const [key, value] of fields) url.searchParams.set(key, value);
const pulls = JSON.parse(process.env.GH_PULLS).filter((pr) =>
    (!url.searchParams.has('head') || pr.head.label === url.searchParams.get('head')) &&
    (!url.searchParams.has('base') || pr.base.ref === url.searchParams.get('base')) &&
    (!url.searchParams.has('state') || pr.state === url.searchParams.get('state')));
const result = spawnSync('jq', ['-r', query], { input: JSON.stringify(pulls), encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status === null ? 1 : result.status);
`, { mode: 0o755 });
    return fx;
}

function pull(branch, base, draft = false, state = 'open') {
    return { number: 123, head: { label: `example:${branch}` }, base: { ref: base }, draft, state };
}

function execute(fx, shell, env = {}) {
    const temp = mkdtempSync(join(fx.dir, 'run-'));
    const output = join(temp, 'output');
    const summary = join(temp, 'summary');
    const calls = join(temp, 'calls');
    for (const file of [output, summary, calls]) writeFileSync(file, '');
    const script = join(temp, 'run.sh');
    writeFileSync(script, shell);
    // tee reopens /dev/stderr; Node's default socket pipe cannot be reopened on Linux.
    const stderr = join(temp, 'stderr');
    const errorFd = openSync(stderr, 'w');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
        cwd: fx.repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', errorFd],
        env: {
            ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, RUNNER_TEMP: temp,
            GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GH_CALLS: calls,
            GH_PULLS: '[]', GH_FAIL: 'false', REPO: 'example/repository', ...env,
        },
    });
    closeSync(errorFd);
    return {
        status: result.status,
        log: `${result.stdout}${readFileSync(stderr, 'utf8')}`,
        outputs: Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
            const equals = line.indexOf('=');
            return [line.slice(0, equals), line.slice(equals + 1)];
        })),
        summary: readFileSync(summary, 'utf8'),
        calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    };
}

function select(fx, branch = `${feature}--php`, env = {}) {
    return execute(fx, selection, { EVENT: 'push', REF: `refs/heads/${branch}`, ...env });
}

function selected(result, enabled) {
    assert.equal(result.status, 0, result.log);
    assert.deepEqual(
        Object.fromEntries(jobs.map((job) => [job, result.outputs[job]])),
        Object.fromEntries(jobs.map((job) => [job, String(enabled.includes(job))])),
        result.log,
    );
}

test('feature sibling runs PHP and workflows even with no diff; it compares with integration', (t) => {
    const fx = fixture(t);
    const result = select(fx);
    selected(result, ['php', 'workflows']);
    assert.equal(result.outputs.profile, 'feature-php');
    assert.equal(result.outputs.base, fx.integration);
    assert.match(result.summary, /deferred.*Full CI is required before promotion/);
    assert.equal(result.calls.length, 1);
});

test('the exact integration branch compares with dev and retains kit and contrast checks', (t) => {
    const fx = fixture(t);
    const result = select(fx, feature);
    selected(result, ['lint-kit', 'php', 'contrast', 'workflows']);
    assert.equal(result.outputs.profile, 'feature-php');
    assert.equal(result.outputs.base, fx.dev);
});

test('feature siblings retain changed kit and docs checks while deferring heavy jobs', (t) => {
    const fx = fixture(t);
    change(fx, 'docs/php-plan.md');
    selected(select(fx), ['php', 'contrast', 'workflows']);
    change(fx, 'button/src/New.php');
    selected(select(fx), ['lint-kit', 'php', 'contrast', 'workflows']);
});

test('a feature PR into integration stays minimal; closed or unrelated promotion PRs do not change it', (t) => {
    const fx = fixture(t);
    const branch = `${feature}--php`;
    const result = select(fx, branch, { GH_PULLS: JSON.stringify([
        pull(branch, feature), pull(branch, 'dev', false, 'closed'), pull('unrelated', 'main'),
    ]) });
    selected(result, ['php', 'workflows']);
    assert.equal(result.outputs.profile, 'feature-php');
});

test('the trusted comparison-base classifier decides even when HEAD edits the classifier', (t) => {
    const fx = fixture(t);
    change(fx, 'tools/ci-changes.sh', '#!/usr/bin/env bash\nprintf "php=false\\nworkflows=false\\nlint-kit=false\\ncontrast=false\\n"\n');
    const result = select(fx);
    selected(result, ['lint-kit', 'php', 'contrast', 'workflows']);
    assert.equal(result.outputs.base, fx.integration);
});

test('other and similarly named branches keep standard classification without querying feature PRs', (t) => {
    const fx = fixture(t);
    for (const branch of ['fix/php', 'feat/upgradeable-components-other', 'feat/upgradeable-components--', 'feat/upgradeable-components2']) {
        const result = select(fx, branch);
        selected(result, ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo']);
        assert.equal(result.outputs.profile, 'standard', branch);
        assert.equal(result.outputs.base, fx.dev, branch);
        assert.deepEqual(result.calls, [], branch);
    }
});

test('main, dev and manual feature runs select every job without a promotion lookup', (t) => {
    const fx = fixture(t);
    for (const [branch, event] of [['main', 'push'], ['dev', 'push'], [`${feature}--php`, 'workflow_dispatch'], [feature, 'workflow_dispatch']]) {
        const result = select(fx, branch, { EVENT: event });
        selected(result, jobs);
        assert.equal(result.outputs.profile, 'full');
        assert.equal(result.outputs.base, '');
        assert.deepEqual(result.calls, []);
    }
});

test('any open promotion target outside integration forces full CI, including draft PRs', (t) => {
    const fx = fixture(t);
    for (const branch of [feature, `${feature}--php`]) {
        for (const base of ['dev', 'main', 'release/candidate']) {
            const result = select(fx, branch, { GH_PULLS: JSON.stringify([pull(branch, feature), pull(branch, base, true)]) });
            selected(result, jobs);
            assert.equal(result.outputs.profile, 'full', `${branch} -> ${base}`);
            assert.equal(result.outputs.base, '');
        }
    }
});

test('a failed promotion API lookup fails selection instead of silently using reduced CI', (t) => {
    const result = select(fixture(t), `${feature}--php`, { GH_FAIL: 'true' });
    assert.equal(result.status, 19, result.log);
    assert.equal(result.outputs.profile, undefined);
    assert.match(result.log, /API unavailable/);
});

test('an unavailable integration comparison ref falls back to full CI', (t) => {
    const fx = fixture(t);
    git(fx.repo, 'update-ref', '-d', `refs/remotes/origin/${feature}`);
    const result = select(fx);
    selected(result, jobs);
    assert.equal(result.outputs.profile, 'full');
    assert.equal(result.outputs.base, '');
});

test('a comparison base without the classifier falls back to full CI', (t) => {
    const fx = fixture(t);
    git(fx.repo, 'rm', '-q', 'tools/ci-changes.sh');
    git(fx.repo, 'commit', '-qm', 'integration without classifier');
    const base = git(fx.repo, 'rev-parse', 'HEAD');
    git(fx.repo, 'update-ref', `refs/remotes/origin/${feature}`, base);
    const result = select(fx);
    selected(result, jobs);
    assert.equal(result.outputs.profile, 'full');
    assert.equal(result.outputs.base, base);
});

test('draft and unopened work orders still defer all jobs; ready orders and child jobs keep standard CI', (t) => {
    const fx = fixture(t);
    const branch = 'claude/wo-example';
    for (const pulls of [[], [pull(branch, 'dev', true)]]) {
        const result = select(fx, branch, { GH_PULLS: JSON.stringify(pulls) });
        selected(result, []);
        assert.equal(result.outputs['wo-draft'], 'true');
        assert.equal(result.outputs.profile, 'work-order-draft');
    }
    const ready = select(fx, branch, { GH_PULLS: JSON.stringify([pull(branch, 'dev')]) });
    selected(ready, ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo']);
    assert.equal(ready.outputs['wo-draft'], undefined);
    assert.equal(ready.outputs.profile, 'standard');
    const child = select(fx, `${branch}--php`);
    selected(child, ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo']);
    assert.deepEqual(child.calls, []);
});

test('CI result accepts deferred jobs with an explicit limitation and still rejects failures and cancellations', (t) => {
    const fx = fixture(t);
    const needs = { changes: { result: 'success' }, php: { result: 'success' }, demo: { result: 'skipped' } };
    const env = { NEEDS: JSON.stringify(needs), WO_DRAFT: '', CI_PROFILE: 'feature-php' };
    const passed = execute(fx, verdict, env);
    assert.equal(passed.status, 0, passed.log);
    assert.match(passed.log, /does not validate browsers.*Run full CI before promotion/);
    for (const state of ['failure', 'cancelled']) {
        const failed = execute(fx, verdict, { ...env, NEEDS: JSON.stringify({ ...needs, php: { result: state } }) });
        assert.equal(failed.status, 1, failed.log);
        assert.match(failed.log, new RegExp(`::error::php ended with ${state}`));
    }
    const draft = execute(fx, verdict, { ...env, WO_DRAFT: 'true', CI_PROFILE: 'work-order-draft' });
    assert.equal(draft.status, 1, draft.log);
    assert.match(draft.log, /::error::work order draft/);
});
