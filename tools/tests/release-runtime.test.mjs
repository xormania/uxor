import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { productionPass, runtimeChanges, sameHeadTree } from '../ci/release-runtime.mjs';

function fixture(t) {
    const dir = mkdtempSync(join(tmpdir(), 'release-runtime-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const git = (args, input) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', input }).trim();
    git(['init', '-q']);
    git(['config', 'user.name', 'Release Test']);
    git(['config', 'user.email', 'release@example.test']);
    function files(entries) {
        for (const [name, body] of Object.entries(entries)) {
            const file = join(dir, name);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, body);
        }
        git(['add', '--all']);
        return git(['write-tree']);
    }
    return { dir, git, files };
}

const manifest = { require: { php: '>=8.4' }, scripts: { test: 'vendor/bin/phpunit' } };
const docManifest = { ...manifest, scripts: { ...manifest.scripts, 'docs:check': 'node tools/llms-txt.mjs --check', 'docs:generate': 'node tools/llms-txt.mjs' } };

test('standalone website, package references, and a scripts-only Composer edit leave release runtime inputs unchanged', (t) => {
    const { dir, files } = fixture(t);
    const before = files({ 'composer.json': JSON.stringify(manifest) });
    const after = files({
        'composer.json': JSON.stringify(docManifest, null, 2),
        'CONTRIBUTING.md': 'Release contributor guidance',
        'FOR-AGENTS.md': 'Agent guidance',
        'README.md': 'Installation links',
        'SECURITY.md': 'Security reporting guidance',
        'CHANGELOG.md': 'New site guides',
        'llms.txt': 'Guide discovery',
        'docs/APPLICATION-TESTING.md': 'Testing notes',
        'tools/llms-txt.mjs': 'Guide generator',
        'tools/tests/llms-txt.test.mjs': 'Guide generator test',
        'website/src/GuideDocs.php': 'Guide builder',
        'packages/uxor/resources/guides.json': 'Guide index',
        'packages/uxor/resources/uxor/docs/README.md': 'Bundled documentation',
    });
    assert.deepEqual(runtimeChanges(dir, before, after), []);
});

test('runtime, discovery, checkout controls and other Composer changes remain release inputs', (t) => {
    const { dir, files } = fixture(t);
    const before = files({ 'composer.json': JSON.stringify(docManifest) });
    const changes = {
        'composer.json': JSON.stringify({ ...docManifest, require: { php: '>=8.5' } }),
        'alert/assets/controllers/alert_controller.js': 'shipped JavaScript',
        'alert/manifest.json': 'recipe manifest',
        'alert/templates/components/Alert.html.twig': 'rendered template',
        'demo/assets/styles/toolkit-fixtures.css': 'runtime CSS',
        'demo/Dockerfile': 'build instructions',
        'demo/Dockerfile.dockerignore': 'build context exclusions',
        'docs/manifest.json': 'new recipe-discovery root',
        'kit.css': 'kit CSS',
        'kit.js': 'kit JavaScript',
        'manifest.json': 'kit manifest',
        'packages/uxor/resources/browser/Dockerfile': 'recorder runtime',
        'packages/uxor/.gitattributes': 'checkout control',
        'tests/e2e/release.long-session.spec.ts': 'release test',
        'tools/ci/release-runtime.mjs': 'qualification policy',
        'tools/kit/KitReader.php': 'kit discovery',
        'tools/sync-demo': 'runtime sync',
        'tools/tests/prod-image.sh': 'image harness',
        'unknown/input.php': 'unknown input',
        'website/manifest.json': 'new recipe-discovery root',
        'website/.ignore': 'Tailwind discovery control',
    };
    const after = files(changes);
    assert.deepEqual(runtimeChanges(dir, before, after).sort(), Object.keys(changes).sort());
    const script = files({ 'composer.json': JSON.stringify({ ...docManifest, scripts: { ...docManifest.scripts, test: 'other tests' } }) });
    assert.deepEqual(runtimeChanges(dir, after, script), ['composer.json']);
    const invalid = files({ 'composer.json': 'null' });
    assert.throws(() => runtimeChanges(dir, script, invalid), /invalid root Composer manifest/);
    assert.throws(() => runtimeChanges(dir, 'f'.repeat(40), invalid), /ls-tree failed/);
});

test('a release merge can use push evidence only when it tests exactly its head tree', (t) => {
    const { dir, files, git } = fixture(t);
    const baseTree = files({ 'shared': 'base' });
    const base = git(['commit-tree', baseTree], 'base');
    const headTree = files({ 'shared': 'head' });
    const head = git(['commit-tree', headTree, '-p', base], 'head');
    const merge = git(['commit-tree', headTree, '-p', base, '-p', head], 'merge');
    const otherTreeMerge = git(['commit-tree', baseTree, '-p', base, '-p', head], 'different tree');
    assert.equal(sameHeadTree(dir, merge, head), true);
    assert.equal(sameHeadTree(dir, otherTreeMerge, head), false);
    assert.equal(sameHeadTree(dir, merge, base), false);
    assert.equal(sameHeadTree(dir, head, head), false);
});

const repo = 'example/uxor';
const head = 'a'.repeat(40);
const branch = 'release/1.2.3';
const start = Date.parse('2026-11-24T10:00:00Z');
const push = {
    id: 501, path: '.github/workflows/ci.yml', event: 'push', repository: { full_name: repo },
    head_repository: { full_name: repo }, head_sha: head, head_branch: branch, run_attempt: 1, status: 'in_progress',
};
const image = {
    name: 'Production image', run_id: push.id, run_attempt: push.run_attempt, head_sha: head, status: 'completed',
    conclusion: 'success', completed_at: new Date(start - 1000).toISOString(),
    steps: ['Build the production image', 'Run the production image'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
};

function lookup(runs, imageJobs, latest = push) {
    return (path) => {
        if (path.includes('/workflows/')) {
            assert.match(path, /[?&]event=push&/);
            assert.ok(path.endsWith(`head_sha=${head}&branch=release%2F1.2.3`));
            return { workflow_runs: runs };
        }
        if (path.endsWith('/runs/501')) return latest;
        assert.match(path, /\/runs\/501\/attempts\/1\/jobs\?/);
        return { jobs: imageJobs, total_count: imageJobs.length };
    };
}

test('an independently successful image job can be reused before unrelated CI lanes finish', async () => {
    const calls = [];
    let now = start;
    const read = (path) => {
        calls.push(path);
        return lookup([push], now === start ? [{ ...image, status: 'in_progress' }] : [image])(path);
    };
    const pass = await productionPass({ repo, head, branch, read, now: () => now, wait: (ms) => { now += ms; } });
    assert.deepEqual(pass, push);
    assert.equal(calls.length, 5);
});

test('missing, foreign, failed, stale, skipped or incomplete CI evidence requires the release image job', async () => {
    for (const [runs, jobs] of [
        [[], []],
        [[{ ...push, head_repository: { full_name: 'another/uxor' } }], [image]],
        [[{ ...push, event: 'workflow_dispatch' }], [image]],
        [[{ ...push, head_sha: 'b'.repeat(40) }], [image]],
        [[{ ...push, head_branch: 'another-branch' }], [image]],
        [[{ ...push, status: 'completed', conclusion: 'cancelled' }], [image]],
        [[push], [{ ...image, run_attempt: 2 }]],
        [[push], [{ ...image, run_id: 502 }]],
        [[push], [{ ...image, conclusion: 'failure' }]],
        [[push], [{ ...image, conclusion: 'skipped' }]],
        [[push], [{ ...image, completed_at: '2026-11-22T09:00:00Z' }]],
        [[push], [{ ...image, steps: [image.steps[0]] }]],
        [[push], [image, image]],
    ]) {
        const result = await productionPass({
            repo, head, branch, read: lookup(runs, jobs), now: () => start,
            wait: () => assert.fail('invalid evidence must not wait'),
        });
        assert.equal(result, null);
    }
});

test('an active CI push gets a bounded wait while it plans or tests the image', async () => {
    for (const [jobs, expected] of [[[], 20_000], [[{ ...image, status: 'in_progress' }], 150_000]]) {
        let now = start;
        const result = await productionPass({
            repo, head, branch, read: lookup([push], jobs), now: () => now, wait: (ms) => { now += ms; },
        });
        assert.equal(result, null);
        assert.equal(now - start, expected);
    }
});

test('a rerun which overtakes an image pass or an incomplete jobs page requires a fresh image check', async () => {
    const verify = (read) => productionPass({ repo, head, branch, read, now: () => start });
    assert.equal(await verify(lookup([push], [image], { ...push, run_attempt: 2 })), null);
    assert.equal(await verify((path) => path.includes('/attempts/')
        ? { jobs: [image], total_count: 101 } : lookup([push], [image])(path)), null);
});

test('production reuse reads the workflow at the push head and fails closed when either implementation drifts', (t) => {
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const release = readFileSync(new URL('../../.github/workflows/release-checks.yml', import.meta.url), 'utf8');
    const checker = readFileSync(new URL('../ci/release-runtime.mjs', import.meta.url), 'utf8');
    const imageJob = ci.indexOf('    prod-image:\n');
    assert.ok(imageJob > 0);
    function changeProduction(before, after) {
        const original = ci.slice(imageJob);
        const changed = original.replace(before, after);
        assert.notEqual(changed, original);
        return ci.slice(0, imageJob) + changed;
    }
    for (const [label, ciSource, releaseSource, expected] of [
        ['known implementation', ci, release, 0],
        ['unrelated sibling job', ci.replace('        name: Start on dev', '        name: Start CI on dev'), release, 0],
        ['named successful no-op build', changeProduction(/docker buildx build[^\n]*/, ':'), release, 1],
        ['changed checkout', changeProduction('                  persist-credentials: false', '                  persist-credentials: false\n                  ref: main'), release, 1],
        ['changed Docker target', changeProduction('--target frankenphp_prod', '--target frankenphp_dev'), release, 1],
        ['changed job environment', changeProduction('        steps:', '        env:\n            DOCKER_HOST: fake\n        steps:'), release, 1],
        ['changed global environment', ci.replace('\nenv:\n', '\nenv:\n    DOCKER_HOST: fake\n'), release, 1],
        ['changed global shell default', ci.replace('\njobs:\n', '\ndefaults:\n    run:\n        shell: custom-shell {0}\n\njobs:\n'), release, 1],
        ['release-side fallback drift', ci, release.replace('--target frankenphp_prod', '--target frankenphp_dev'), 1],
    ]) {
        if (label !== 'known implementation') assert.ok(ciSource !== ci || releaseSource !== release, label);
        const { dir, git, files } = fixture(t);
        const baseTree = files({ '.github/workflows/ci.yml': ci });
        const base = git(['commit-tree', baseTree], 'base');
        const source = files({
            '.github/workflows/ci.yml': ciSource,
            '.github/workflows/release-checks.yml': releaseSource,
            'tools/ci/release-runtime.mjs': checker,
        });
        const head = git(['commit-tree', source, '-p', base], 'head');
        const merge = git(['commit-tree', source, '-p', base, '-p', head], 'merge');
        const installed = { ...push, head_sha: head };
        const success = { ...image, head_sha: head, completed_at: new Date(Date.now() - 1000).toISOString() };
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        const gh = join(bin, 'gh');
        writeFileSync(gh, `#!${process.execPath}\nconst path = process.argv[3];
const value = path.includes('/workflows/') ? ${JSON.stringify({ workflow_runs: [installed] })} :
    path.includes('/attempts/') ? ${JSON.stringify({ jobs: [success], total_count: 1 })} : ${JSON.stringify(installed)};
console.log(JSON.stringify(value));\n`);
        chmodSync(gh, 0o755);
        const result = spawnSync(process.execPath, ['tools/ci/release-runtime.mjs', 'production', repo, merge, head, branch], {
            cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        });
        assert.equal(result.status, expected, `${label}: ${result.stdout}${result.stderr}`);
        assert.match(result.stdout, expected ? /definitions need an equivalence check/ : /Production image passed in CI push/);
    }
});
