import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { apply, discover, latestCommonPatch, refresher, updateDockerfile } from '../ci/image-refresh.mjs';

const digest = (value) => 'sha256:' + value.repeat(64);
const browser = (version) => 'mcr.microsoft.com/playwright:v' + version + '-noble';
const browserFile = 'packages/uxor/resources/browser/Dockerfile';
const providerManifest = 'packages/uxor/resources/browser/package.json';
const consumerManifest = 'packages/uxor/dev/package.json';

function scratch(t) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uxor-image-refresh-')));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    const put = (path, value, mode = 0o644) => {
        const file = join(dir, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value) + '\n', { mode });
    };
    put('package-lock.json', { packages: { 'node_modules/@playwright/test': { version: '1.58.2' } } });
    put('tools/playwright-image.json', JSON.stringify({ image: browser('1.58.2') + '@' + digest('a') }, null, 4) + '\n');
    put(browserFile, 'FROM ' + browser('1.65.1') + '@' + digest('a') + '\nRUN echo fixture\n');
    for (const [path, kind, name] of [
        [providerManifest, 'dependencies', 'playwright-core'],
        [consumerManifest, 'devDependencies', '@playwright/test'],
    ]) {
        put(path, { [kind]: { [name]: '1.65.1' } });
        put(path.replace('package.json', 'package-lock.json'), { packages: { ['node_modules/' + name]: { version: '1.65.1' } } });
    }
    git('add', '-A');
    git('-c', 'user.name=xor', '-c', 'user.email=127287135+xormania@users.noreply.github.com', 'commit', '--quiet', '-m', 'fixture');
    return { dir, git, put };
}

const knownPlatforms = new Set(['linux/amd64', 'linux/arm64']);
const simulatedInspection = (reference) => ({
    digest: reference.endsWith('@' + digest('a')) ? digest('a') : digest('b'),
    platforms: knownPlatforms,
});

function lockedPatch(client, version) {
    return {
        manifest: client.manifest.replace('1.65.1', version),
        lock: client.lock.replace('1.65.1', version),
    };
}

test('deduplicates upstream lookups and leaves named contexts and stage aliases intact', () => {
    const seen = [];
    const refresh = refresher((reference) => {
        seen.push(reference);
        return simulatedInspection(reference);
    });
    const dockerfile = [
        'ARG PHP=php:8.5-cli-bookworm@' + digest('a'),
        'FROM ${PHP} AS base',
        'FROM uxor-runtime',
        'FROM --platform=linux/amd64 php:8.5-cli-bookworm@' + digest('a') + ' AS php',
        'RUN echo php:8.5-cli-bookworm@' + digest('a'),
    ].join('\n');
    const rewritten = updateDockerfile(dockerfile, refresh);
    assert.deepEqual(rewritten.split('\n').map((line) => line.includes(digest('b'))), [true, false, false, true, false]);
    assert.equal(seen.length, 2);
});

test('refuses lost prior platforms, invalid digests and option-like image names', () => {
    const refresh = refresher((reference) => reference.includes('@')
        ? { digest: digest('a'), platforms: knownPlatforms }
        : { digest: digest('b'), platforms: new Set(['linux/amd64']) });
    assert.throws(() => refresh('php:8.5-cli-bookworm', digest('a')), /loses an existing or required platform/);
    assert.throws(() => refresh('--metadata', digest('a')), /Unsupported/);
    assert.throws(() => refresh('php:8.5-cli-bookworm', 'invalid'), /Unsupported/);
});

test('selects a common stable patch within the accepted browser line', () => {
    const releases = (...items) => new Set(items);
    assert.equal(latestCommonPatch('1.65.1', [
        releases('1.64.8', '1.65.1', '1.65.2', '1.65.4', '1.65.12', '1.66.0', '1.65.100-alpha'),
        releases('1.65.1', '1.65.2', '1.65.4', '1.66.0', '1.65.100-alpha'),
    ]), '1.65.4');
    assert.equal(latestCommonPatch('1.65.1', [releases('1.65.0', '2.0.0'), releases('1.66.0')]), '1.65.1');
});

test('a candidate moves both clients and the provider in one plan and keeps the screenshot version', (t) => {
    const { dir, git } = scratch(t);
    const plan = discover(dir, {
        inspect: simulatedInspection, versions: () => new Set(['1.65.1', '1.65.2', '1.66.0']), lockClient: lockedPatch,
    });
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(plan.files.length, 6);
    const changes = new Map(plan.files.map(({ path, after }) => [path, after]));
    assert.match(changes.get(browserFile), /:v1\.65\.2-noble@sha256:b{64}/);
    assert.match(changes.get('tools/playwright-image.json'), /:v1\.58\.2-noble@sha256:b{64}/);
    for (const path of [providerManifest, consumerManifest]) {
        assert.match(changes.get(path), /1\.65\.2/);
        assert.match(changes.get(path.replace('package.json', 'package-lock.json')), /1\.65\.2/);
    }
    assert.equal(apply(dir, plan).length, 6);
    assert.match(git('diff', browserFile), /v1\.65\.2-noble/);
    assert.doesNotMatch(git('status', '--porcelain'), /^ M package-lock\.json/m);
});

test('waits for the provider image when npm publishes first', (t) => {
    const { dir } = scratch(t);
    const plan = discover(dir, {
        inspect(reference) {
            if (reference === browser('1.65.2')) {
                const missing = new Error('Provider image is late');
                missing.stderr = 'manifest unknown';
                throw missing;
            }
            return simulatedInspection(reference);
        },
        versions: () => new Set(['1.65.1', '1.65.2']),
        lockClient() { throw new Error('No lock change before the provider exists'); },
    });
    assert.equal(plan.files.length, 2);
    assert.match(plan.files.find(({ path }) => path === browserFile).after, /:v1\.65\.1-noble@sha256:b{64}/);
});

test('the first release can inspect its screenshot pin while the packaged provider has not rolled into dev', (t) => {
    const { dir, git } = scratch(t);
    git('rm', '-r', '--quiet', 'packages/uxor/resources/browser');
    git('-c', 'user.name=xor', '-c', 'user.email=127287135+xormania@users.noreply.github.com',
        'commit', '--quiet', '-m', 'pre-provider development');
    const plan = discover(dir, {
        inspect: simulatedInspection,
        versions() { throw new Error('No provider patch discovery before this group lands on dev'); },
    });
    assert.deepEqual(plan.files.map(({ path }) => path), ['tools/playwright-image.json']);
    assert.deepEqual(apply(dir, plan), ['tools/playwright-image.json']);
});

test('rejects stale, out-of-scope and non-pin edits before writing any file', (t) => {
    const { dir, git, put } = scratch(t);
    const plan = discover(dir, { inspect: simulatedInspection, versions: () => new Set(['1.65.1']), lockClient: lockedPatch });
    const altered = structuredClone(plan);
    altered.files.find(({ path }) => path === browserFile).after += 'RUN echo unexpected\n';
    assert.throws(() => apply(dir, altered), /only the Dockerfile pins/);
    assert.throws(() => apply(dir, { ...plan, files: [...plan.files, { path: '../outside', after: 'x' }] }), /Invalid or stale/);
    assert.equal(git('status', '--porcelain'), '');
    put(browserFile, 'FROM ' + browser('1.65.1') + '@' + digest('a') + '\n# changed\n');
    assert.throws(() => apply(dir, plan), /Invalid or stale/);
    assert.match(readFileSync(join(dir, 'tools/playwright-image.json'), 'utf8'), new RegExp(digest('a')));
});

const script = fileURLToPath(new URL('../ci/image-refresh.mjs', import.meta.url));

function fakeGitHub(fixture, { old = '', foreign = false } = {}) {
    const { dir, git, put } = fixture;
    const base = git('rev-parse', 'HEAD');
    const tree = 'c'.repeat(40);
    const commit = 'd'.repeat(40);
    put('bin/gh', '#!' + process.execPath + '\n' + `
const fs = require('node:fs');
const argv = process.argv.slice(2);
const input = argv.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8')) : null;
fs.appendFileSync(process.env.MOCK_GH_CALLS, JSON.stringify({ argv, input }) + '\\n');
const old = process.env.MOCK_GH_OLD;
const member = 'uxor-image-refresh[bot]';
const base = process.env.MOCK_GH_BASE;
const path = argv.find((item) => item.startsWith('repos/'));
let output;
if (path.endsWith('/git/ref/heads/dev')) output = { object: { sha: base } };
else if (path.endsWith('/git/matching-refs/heads/maintenance/image-pins')) {
    output = old ? [{ ref: 'refs/heads/maintenance/image-pins', object: { sha: old } }] : [];
} else if (path.includes('/commits/') && !path.includes('/git/')) {
    output = { author: { login: process.env.MOCK_GH_FOREIGN ? 'unrelated' : member } };
} else if (path.endsWith('/pulls') && !input) {
    output = old ? [{ state: 'open', user: { login: member }, base: { ref: 'dev' }, head: { sha: old }, html_url: 'https://github.com/example/repo/pull/10' }] : [];
} else if (path.endsWith('/git/trees')) output = { sha: '${tree}' };
else if (path.includes('/git/commits/')) output = { tree: { sha: 'e'.repeat(40) } };
else if (path.endsWith('/git/commits')) output = { sha: '${commit}' };
else if (path.includes('/git/refs')) output = { object: { sha: '${commit}' } };
else if (path.endsWith('/pulls') && input) output = { html_url: 'https://github.com/example/repo/pull/10' };
else throw new Error('Unexpected mock call: ' + argv.join(' '));
console.log(JSON.stringify(output));
`, 0o755);
    put('plan.json', discover(dir, { inspect: simulatedInspection, versions: () => new Set(['1.65.1']) }));
    const callLog = join(dir, 'calls.jsonl');
    const result = spawnSync(process.execPath, [script, 'propose', '--root', dir, '--plan', join(dir, 'plan.json')], {
        encoding: 'utf8', env: {
            ...process.env, PATH: join(dir, 'bin') + delimiter + process.env.PATH,
            GITHUB_REPOSITORY: 'example/repo', IMAGE_REFRESH_APP_SLUG: 'uxor-image-refresh',
            MOCK_GH_CALLS: callLog, MOCK_GH_BASE: base, MOCK_GH_OLD: old, MOCK_GH_FOREIGN: foreign ? '1' : '',
        },
    });
    const writes = readFileSync(callLog, 'utf8').trim().split('\n').map(JSON.parse).filter(({ input }) => input);
    return { result, writes, base, tree, commit };
}

test('first automated proposal creates only the automation branch and one complete reviewable PR', (t) => {
    const { result, writes, base, tree, commit } = fakeGitHub(scratch(t));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(writes.map(({ argv }) => argv[3]), [
        'repos/example/repo/git/trees', 'repos/example/repo/git/commits', 'repos/example/repo/git/refs', 'repos/example/repo/pulls',
    ]);
    assert.deepEqual(writes[1].input.parents, [base]);
    assert.equal(writes[1].input.tree, tree);
    assert.deepEqual(writes[2].input, { ref: 'refs/heads/maintenance/image-pins', sha: commit });
    assert.equal(writes[3].input.base, 'dev');
    assert.equal(writes[3].input.head, 'maintenance/image-pins');
});

test('updates the existing PR as a fast-forward and refuses a branch owned by somebody else', (t) => {
    const old = 'f'.repeat(40);
    const { result, writes, base, commit } = fakeGitHub(scratch(t), { old });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[1].input.parents, [old, base]);
    assert.deepEqual(writes[2].input, { sha: commit, force: false });
    assert.equal(writes[2].argv[3], 'repos/example/repo/git/refs/heads/maintenance/image-pins');
    const unrelated = fakeGitHub(scratch(t), { old, foreign: true });
    assert.equal(unrelated.result.status, 1);
    assert.match(unrelated.result.stderr, /non-automation head/);
    assert.deepEqual(unrelated.writes, []);
});
