// Execute pages.yml's shell where it decides which release the site shows: the release it resolves, the tag the build
// checks out, and the deploy's check that the release is still the latest. GitHub's API is a stub answering from
// fixtures through jq, as gh's --jq would; Git is real.
// Run: node --test tools/tests/pages-workflow.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

test('no local action runs where the release is checked out; the Jev job collects the build log with its own tools', (t) => {
    const job = (name) => {
        const start = workflow.indexOf(`\n    ${name}:\n`);
        const next = workflow.slice(start + 1).search(/\n {4}[a-z-]+:\n/);
        return workflow.slice(start, next < 0 ? undefined : start + 1 + next);
    };
    // the build checks out a commit chosen at run time, in the default branch's context: no local action there
    // (CodeQL: cache poisoning)
    assert.doesNotMatch(job('build'), /uses: \.\//);
    const jev = job('diagnose');
    assert.match(jev, /ref: \$\{\{ github\.workflow_sha \}\}/);
    assert.doesNotMatch(jev, /outputs\.commit/);
    assert.match(jev, /job-id: build/);
    // the step the Jev job names is the build job's build step, whose log the build uploads
    assert.equal(stepIn(workflow, 'build', 'build').name, 'Build and check the site');
    const steps = JSON.parse(/steps: '([^']+)'/.exec(jev)[1]);
    assert.deepEqual(Object.keys(steps), ['build']);

    // step-attempts names the build job's step from another job, with --job
    const dir = scratch(t);
    writeFileSync(join(dir, 'jev-build.log'), 'PHP Fatal error: the export failed\n');
    const out = join(dir, 'attempts.json');
    const run = spawnSync('node', [join(root, 'tools/ci/step-attempts.mjs'), '--steps', JSON.stringify(steps), '--logs', dir,
        '--workflow', join(root, '.github/workflows/pages.yml'), '--job', 'build', out], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(run.status, 0, run.stderr);
    const [attempt] = JSON.parse(readFileSync(out, 'utf8')).attempts;
    assert.equal(attempt.title, 'Build and check the site');
    assert.match(attempt.error, /tools\/build-static\.sh _site/);
});

// the deployed site as curl gets it: files under a fixture directory, by their path after the site's URL; a missing
// one answers 404 (curl -f fails); release.json answers only from the READY_AFTER-th request on (a deployment Pages
// is still propagating)
function deployedSite(t, files) {
    const dir = scratch(t);
    const site = join(dir, 'site');
    for (const [path, body] of Object.entries(files)) {
        const file = join(site, path.endsWith('/') ? `${path}index.html` : path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, body);
    }
    writeFileSync(join(dir, 'bin', 'curl'), `#!/usr/bin/env bash
url=\${!#}
path=\${url#https://example.github.io/project/}
[ -z "$path" ] || [ "\${path%/}" != "$path" ] && path="\${path}index.html"
if [ "$path" = release.json ]; then
    count=$(( $(cat "$SITE_DIR/../count" 2>/dev/null || echo 0) + 1 )); echo "$count" > "$SITE_DIR/../count"
    [ "$count" -ge "\${READY_AFTER:-1}" ] || exit 22
fi
[ -f "$SITE_DIR/$path" ] || exit 22
cat "$SITE_DIR/$path"
`);
    chmodSync(join(dir, 'bin', 'curl'), 0o755);
    return { dir, site };
}

function liveSite(overrides = {}) {
    const url = 'https://example.github.io/project';
    const page = (path) => `<html><head><link rel="canonical" href="${url}/${path}"></head></html>`;
    return {
        'release.json': JSON.stringify({ version: '0.4.0', commit: sha('a'), repository: 'https://github.com/example/project' }),
        'index.html': page(''),
        'r/button/': page('r/button/'),
        'install/': page('install/'),
        'guide/': page('guide/'),
        'sitemap.xml': `<urlset><url><loc>${url}/</loc></url><url><loc>${url}/r/button/</loc></url></urlset>`,
        'llms.txt': `# Project\n\n- [button](${url}/r/button.md): a button\n`,
        'r/button.md': '# Button\n\nA button.\n',
        ...overrides,
    };
}

test('the deploy checks the site where readers get it: the release it shows, its pages, sitemap, llms.txt and Markdown', (t) => {
    const check = stepIn(workflow, 'deploy', 'live').run;
    const run = (files, env = {}) => {
        const { dir, site } = deployedSite(t, files);
        const result = shell(check, dir, { SITE_DIR: site, PAGE_URL: 'https://example.github.io/project/', VERSION: '0.4.0', COMMIT: sha('a'), ATTEMPTS: '1', WAIT: '0', ...env });
        return { status: result.status, log: result.stdout + result.stderr };
    };

    const ok = run(liveSite());
    assert.equal(ok.status, 0, ok.log);
    assert.match(ok.log, /shows release 0\.4\.0/);

    for (const [name, site, message] of [
        ['an older release still served', liveSite({ 'release.json': JSON.stringify({ version: '0.3.0', commit: sha('b') }) }), /release\.json is .*0\.3\.0.*not 0\.4\.0/],
        ['a page naming another host as canonical', liveSite({ 'r/button/': '<link rel="canonical" href="https://elsewhere.example/r/button/">' }), /\/r\/button\/ does not name https:\/\/example\.github\.io\/project\/r\/button\/ as its canonical URL/],
        ['a guide missing', liveSite({ 'guide/': undefined }), /\/guide\/ does not answer/],
        ['a sitemap under another base path', liveSite({ 'sitemap.xml': '<loc>https://example.github.io/r/button/</loc>' }), /sitemap\.xml does not list/],
        ["llms.txt linking the repository's README", liveSite({ 'llms.txt': '- [button](https://raw.githubusercontent.com/example/project/0.4.0/button/README.md)' }), /llms\.txt does not link/],
        ["a recipe's Markdown missing", liveSite({ 'r/button.md': undefined }), /r\/button\.md does not answer/],
    ]) {
        const failed = run(Object.fromEntries(Object.entries(site).filter(([, body]) => undefined !== body)));
        assert.equal(failed.status, 1, `${name}: ${failed.log}`);
        assert.match(failed.log, message, name);
        assert.match(failed.log, /::error::The deployed site at https:\/\/example\.github\.io\/project:/, name);
    }

    // a deployment Pages is still propagating: asked again, it passes once it answers
    const late = run(liveSite(), { ATTEMPTS: '3', READY_AFTER: '3' });
    assert.equal(late.status, 0, late.log);
    assert.match(late.log, /Attempt 1: release\.json does not answer[\s\S]*Attempt 2:/);
});
