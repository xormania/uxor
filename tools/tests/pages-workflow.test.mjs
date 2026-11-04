// Execute pages.yml's shell where it decides which release the site shows: the release it resolves, the tag the build
// checks out, and the deploy's check that the release is still the latest. GitHub's API is a stub answering from
// fixtures through jq, as gh's --jq would; Git is real.
// Run: node --test tools/tests/pages-workflow.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stepIn } from '../ci/step-attempts.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
const sha = (c) => c.repeat(40);

function scratch(t) {
    const dir = mkdtempSync(join(tmpdir(), 'pages-workflow-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'bin'));
    // gh api <path> --jq <filter>: the fixture for the path, or an error as gh gives for a missing resource
    writeFileSync(join(dir, 'bin', 'gh'), `#!/usr/bin/env bash
path=$2
payload=$(jq -r --arg path "$path" '.[$path] // empty' "$API")
[ -n "$payload" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
printf '%s' "$payload" | jq -r "$4"
`);
    chmodSync(join(dir, 'bin', 'gh'), 0o755);
    return dir;
}

function shell(script, dir, env) {
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
        cwd: dir, encoding: 'utf8',
        env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, REPO: 'example/project', GH_TOKEN: 'x', ...env },
    });
}

// The API as GitHub answers it: the latest Release, each Release by tag, each tag's commit
function api(dir, { latest = '0.4.0', releases = {}, commits = {} } = {}) {
    const answers = {};
    if (latest) answers['repos/example/project/releases/latest'] = JSON.stringify({ tag_name: latest });
    for (const [tag, release] of Object.entries({ '0.4.0': {}, '0.3.0': {}, ...releases })) {
        if (release) answers[`repos/example/project/releases/tags/${tag}`] = JSON.stringify({ tag_name: tag, draft: false, prerelease: false, ...release });
    }
    for (const [tag, commit] of Object.entries({ '0.4.0': sha('a'), '0.3.0': sha('b'), ...commits })) {
        answers[`repos/example/project/commits/${tag}`] = JSON.stringify({ sha: commit });
    }
    const file = join(dir, 'api.json');
    writeFileSync(file, JSON.stringify(answers));
    return file;
}

function resolve(t, fixtures) {
    const dir = scratch(t);
    const output = join(dir, 'output');
    writeFileSync(output, '');
    const run = shell(stepIn(workflow, 'resolve', 'release').run, dir, { API: api(dir, fixtures), GITHUB_OUTPUT: output });
    const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('=')));
    return { status: run.status, log: run.stdout + run.stderr, values };
}

test('the site publishes the latest published release, at the commit its tag points at', (t) => {
    const { status, log, values } = resolve(t);
    assert.equal(status, 0, log);
    assert.deepEqual(values, { version: '0.4.0', commit: sha('a') });
});

test('no draft, prerelease, malformed or missing release is ever published', (t) => {
    for (const [name, fixtures, message] of [
        ['a draft', { releases: { '0.4.0': { draft: true } } }, /not a published release/],
        ['a prerelease', { releases: { '0.4.0': { prerelease: true } } }, /not a published release/],
        ['a latest tag that is not a version', { latest: 'dev' }, /'dev' is not a version/],
        ['no published release at all', { latest: '' }, /No published release/],
        ['a tag GitHub resolves to no commit', { commits: { '0.4.0': 'not-a-commit' } }, /no commit for its tag/],
    ]) {
        const { status, log, values } = resolve(t, fixtures);
        assert.equal(status, 1, `${name}: ${log}`);
        assert.match(log, message, name);
        assert.deepEqual(values, {}, `${name}: no release is handed to the build`);
    }
});

test('what the build checks out comes from the Releases alone; release.yml version is only compared with it', (t) => {
    // no input reaches the step whose outputs choose the checkout (CodeQL: cache poisoning)
    const release = workflow.slice(workflow.indexOf('            - id: release'), workflow.indexOf('            - id: expected'));
    assert.doesNotMatch(release, /inputs\./);
    assert.match(workflow, /^\s+ref: \$\{\{ needs\.resolve\.outputs\.commit \}\}$/m);
    const expected = stepIn(workflow, 'resolve', 'expected').run;
    for (const [given, status] of [['0.4.0', 0], ['0.3.0', 1], ['dev', 1]]) {
        const run = shell(expected, scratch(t), { EXPECTED: given, VERSION: '0.4.0' });
        assert.equal(run.status, status, `${given}: ${run.stdout}${run.stderr}`);
        if (status) assert.match(run.stdout + run.stderr, /is not the latest release \(0\.4\.0\)/);
    }
});

test('the build stops unless the checkout and the release tag are the resolved commit', (t) => {
    const dir = scratch(t);
    const git = (...args) => {
        const run = spawnSync('git', ['-c', 'user.name=Local proof', '-c', 'user.email=proof@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        return run.stdout.trim();
    };
    git('init', '-q', '--initial-branch=main');
    git('commit', '-q', '--allow-empty', '-m', 'test: the release');
    const released = git('rev-parse', 'HEAD');
    git('tag', '-a', '0.4.0', '-m', 'release 0.4.0'); // annotated, as release.yml tags
    git('commit', '-q', '--allow-empty', '-m', 'test: after the release');
    const later = git('rev-parse', 'HEAD');
    const check = stepIn(workflow, 'build', 'tag').run;
    for (const [name, checkout, commit, expected] of [
        ['the tag commit', released, released, 0],
        ['a later commit than the tag', later, later, 1],
        ['a checkout other than the resolved commit', later, released, 1],
    ]) {
        git('checkout', '-q', '--detach', checkout);
        const run = shell(check, dir, { VERSION: '0.4.0', COMMIT: commit });
        assert.equal(run.status, expected, `${name}: ${run.stdout}${run.stderr}`);
    }
});

test('the deploy stops when a newer release came out, or the tag moved, after the build', (t) => {
    const fresh = stepIn(workflow, 'deploy', 'fresh').run;
    for (const [name, fixtures, expected] of [
        ['still the latest, at the same commit', {}, 0],
        ['a newer release is out', { latest: '0.5.0', releases: { '0.5.0': {} }, commits: { '0.5.0': sha('c') } }, 1],
        ['the tag now points elsewhere', { commits: { '0.4.0': sha('d') } }, 1],
        ['the Releases cannot be read', { latest: '' }, 1],
    ]) {
        const dir = scratch(t);
        const run = shell(fresh, dir, { API: api(dir, fixtures), VERSION: '0.4.0', COMMIT: sha('a') });
        assert.equal(run.status, expected, `${name}: ${run.stdout}${run.stderr}`);
        if (expected) assert.match(run.stdout + run.stderr, /Not deploying/, name);
    }
});

test('release.yml hands Pages the version it released, never the commit its CI passed on', () => {
    const release = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
    const call = release.slice(release.indexOf('uses: ./.github/workflows/pages.yml'));
    assert.match(call, /^\s+release: \$\{\{ needs\.check\.outputs\.newest \}\}$/m);
    assert.doesNotMatch(call, /^\s+ref:/m);
    // a manual run deploys only from main, and builds a release, never the branch it was started on
    assert.match(workflow, /^\s+if: github\.event_name != 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/main'$/m);
    assert.doesNotMatch(workflow, /github\.ref_name|github\.sha/);
});
