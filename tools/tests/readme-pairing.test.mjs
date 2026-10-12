// The cases of tools/readme-pairing.mjs: the waiver trailers and the pairing as pure logic, then the script itself in
// scratch repositories with a dev branch and its origin/dev, so the range is the one CI's Changes job computes.
// Run: node --test tools/tests/*.test.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairing, parseWaivers, recipeCode, waiverLines } from '../readme-pairing.mjs';

const script = fileURLToPath(new URL('../readme-pairing.mjs', import.meta.url));
const recipes = new Set(['alert', 'modal']);
const commit = (message, sha = 'a'.repeat(40)) => ({ sha, message });

test('a waiver is a Docs-waiver line of the last paragraph', () => {
    assert.deepEqual(waiverLines('fix(alert): x\n\nWhy.\n\nDocs-waiver: alert only a class order\nOther: y\n'), ['alert only a class order']);
    assert.deepEqual(waiverLines('fix(alert): x\n\nDocs-waiver: alert in the body\n\nRefs: #1\n'), []);
    assert.deepEqual(waiverLines('fix(alert): x\n\ndocs-waiver:   alert  spaced  \n'), ['alert  spaced']);
});

test('a waiver needs a recipe that exists and a reason', () => {
    const { waivers, problems } = parseWaivers([
        commit('a\n\nDocs-waiver: alert a reason'),
        commit('b\n\nDocs-waiver: alert'),
        commit('c\n\nDocs-waiver: alert   '),
        commit('d\n\nDocs-waiver:'),
        commit('e\n\nDocs-waiver: alret typo'),
    ], recipes);
    assert.deepEqual(waivers, [{ sha: 'a'.repeat(40), recipe: 'alert', reason: 'a reason' }]);
    assert.deepEqual(problems, [
        'Docs-waiver in aaaaaaa: alert has no reason; write "Docs-waiver: alert <why its README needs no change>".',
        'Docs-waiver in aaaaaaa: alert has no reason; write "Docs-waiver: alert <why its README needs no change>".',
        'Docs-waiver in aaaaaaa: no recipe and no reason; write "Docs-waiver: <recipe> <reason>".',
        'Docs-waiver in aaaaaaa: "alret" is not a recipe (a top-level directory with a manifest.json).',
    ]);
});

test('a recipe\'s code is every file under it but README.md and tests/', () => {
    assert.equal(recipeCode('alert/templates/components/Alert.html.twig', recipes), 'alert');
    assert.equal(recipeCode('alert/manifest.json', recipes), 'alert');
    assert.equal(recipeCode('alert/assets/README.md', recipes), 'alert');
    assert.equal(recipeCode('alert/README.md', recipes), null);
    assert.equal(recipeCode('alert/tests/alert.spec.ts', recipes), null);
    assert.equal(recipeCode('docs/ROADMAP.md', recipes), null);
    assert.equal(recipeCode('kit.css', recipes), null);
});

test('code without its README fails; with its README, or its own waiver, passes', () => {
    const code = ['alert/templates/A.html.twig', 'modal/templates/M.html.twig'];
    const failed = pairing(code, recipes, []);
    assert.deepEqual(failed.problems, [
        'alert: alert/templates/A.html.twig changed, alert/README.md did not.',
        'modal: modal/templates/M.html.twig changed, modal/README.md did not.',
    ]);
    const passed = pairing([...code, 'alert/README.md'], recipes, [commit('x\n\nDocs-waiver: modal markup only, same API')]);
    assert.deepEqual(passed.problems, []);
    assert.deepEqual(passed.paired, ['alert']);
    assert.deepEqual(passed.waived, [{ sha: 'a'.repeat(40), recipe: 'modal', reason: 'markup only, same API' }]);
    assert.deepEqual(pairing(['alert/tests/x.spec.ts', 'alert/README.md'], recipes, []).changed.size, 0);
});

test('a waiver for another recipe does not cover this one, and is reported unused', () => {
    const result = pairing(['alert/templates/A.html.twig'], recipes, [commit('x\n\nDocs-waiver: modal a reason')]);
    assert.deepEqual(result.problems, ['alert: alert/templates/A.html.twig changed, alert/README.md did not.']);
    assert.deepEqual(result.unused.map((waiver) => waiver.recipe), ['modal']);
});

test('a waiver without a reason fails even where the README changed', () => {
    const result = pairing(['alert/templates/A.html.twig', 'alert/README.md'], recipes, [commit('x\n\nDocs-waiver: alert')]);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /alert has no reason/);
});

// --- the script, in scratch repositories

function repository() {
    const dir = mkdtempSync(join(tmpdir(), 'readme-pairing-'));
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
    const write = (path, body) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), body);
    };
    git('init', '-q', '-b', 'dev');
    for (const recipe of recipes) {
        write(`${recipe}/manifest.json`, '{}\n');
        write(`${recipe}/README.md`, `# ${recipe}\n`);
        write(`${recipe}/templates/${recipe}.html.twig`, 'one\n');
    }
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/dev', 'dev');
    git('checkout', '-qb', 'feature');
    const change = (message, files) => {
        for (const [path, body] of Object.entries(files)) {
            write(path, body);
        }
        git('add', '-A');
        git('commit', '-qm', message);
    };
    return { dir, git, change };
}

function run(dir, args = [], env = {}) {
    const summary = join(dir, '.git', 'step-summary.md');
    const result = spawnSync(process.execPath, [script, ...args], {
        cwd: dir,
        encoding: 'utf8',
        // the base comes from the checked-out branch, as CI's rule: EVENT and REF are left out
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'EVENT' && name !== 'REF')), GITHUB_STEP_SUMMARY: summary, ...env },
    });
    let markdown = '';
    try {
        markdown = readFileSync(summary, 'utf8');
    } catch {}
    return { status: result.status, out: result.stdout + result.stderr, markdown };
}

test('script: a recipe change without its README fails, naming the files and the trailer to add', (t) => {
    const { dir, change } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    change('fix(alert): x', { 'alert/templates/alert.html.twig': 'two\n' });
    const { status, out } = run(dir);
    assert.equal(status, 1);
    assert.match(out, /alert: alert\/templates\/alert\.html\.twig changed, alert\/README\.md did not\./);
    assert.match(out, /Docs-waiver: <recipe> <reason>/);
});

test('script: a manifest change counts as code; README and tests changes alone need nothing', (t) => {
    const { dir, change } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    change('docs(alert): x', { 'alert/README.md': '# alert\n\nMore.\n', 'alert/tests/a.spec.ts': 'x\n' });
    assert.equal(run(dir).status, 0);
    change('chore(modal): x', { 'modal/manifest.json': '{"a":1}\n' });
    assert.match(run(dir).out, /modal: modal\/manifest\.json changed/);
});

test('script: the same change with a waiver passes and lists it, in the log and the job summary', (t) => {
    const { dir, change } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    change('fix(alert): x\n\nDocs-waiver: alert class order only, nothing users see', { 'alert/templates/alert.html.twig': 'two\n' });
    const { status, out, markdown } = run(dir);
    assert.equal(status, 0, out);
    assert.match(out, /1 waiver\(s\) accepted/);
    assert.match(out, /Waived: alert \([0-9a-f]{7}\): class order only, nothing users see/);
    assert.match(markdown, /\| `alert` \| [0-9a-f]{7} \| class order only, nothing users see \|/);
});

test('script: a waiver in a later commit of the range counts', (t) => {
    const { dir, change, git } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    change('fix(alert): x', { 'alert/templates/alert.html.twig': 'two\n' });
    git('commit', '-q', '--allow-empty', '-m', 'chore: waive\n\nDocs-waiver: alert internal rename');
    assert.equal(run(dir).status, 0);
});

test('script: a waiver for another recipe still fails', (t) => {
    const { dir, change } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    change('fix(alert): x\n\nDocs-waiver: modal not this one', { 'alert/templates/alert.html.twig': 'two\n' });
    const { status, out } = run(dir);
    assert.equal(status, 1);
    assert.match(out, /alert: alert\/templates\/alert\.html\.twig changed, alert\/README\.md did not\./);
    assert.match(out, /Not needed: the waiver for modal/);
});

test('script: a waiver with an empty reason fails', (t) => {
    const { dir, change } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    change('fix(alert): x\n\nDocs-waiver: alert', { 'alert/templates/alert.html.twig': 'two\n' });
    const { status, out } = run(dir);
    assert.equal(status, 1);
    assert.match(out, /Docs-waiver in [0-9a-f]{7}: alert has no reason/);
});

test('script: a merge that only brings dev in adds nothing, though dev changed a recipe without its README', (t) => {
    const { dir, change, git } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    git('checkout', '-q', 'dev');
    change('fix(modal): on dev', { 'modal/templates/modal.html.twig': 'two\n' });
    git('update-ref', 'refs/remotes/origin/dev', 'dev');
    git('checkout', '-q', 'feature');
    git('merge', '-q', '--no-ff', '-m', 'Merge dev', 'dev');
    const { status, out } = run(dir);
    assert.equal(status, 0, out);
    assert.match(out, /\(1 commit\(s\)\): 0 recipe\(s\) with code changes/);
    // with the branch's own change, only that one is paired
    change('fix(alert): x', { 'alert/templates/alert.html.twig': 'two\n', 'alert/README.md': '# alert\n\nNew.\n' });
    assert.match(run(dir).out, /1 recipe\(s\) with code changes, 1 with their README/);
});

test('script: on dev, or with --base \'\', nothing is compared; --base picks the range', (t) => {
    const { dir, change, git } = repository();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    change('fix(alert): x', { 'alert/templates/alert.html.twig': 'two\n' });
    assert.match(run(dir, ['--base', '']).out, /no base/);
    assert.equal(run(dir, ['--base', 'HEAD']).status, 0);
    assert.equal(run(dir, ['--base', 'HEAD^']).status, 1);
    git('checkout', '-q', 'dev');
    git('merge', '-q', 'feature');
    assert.match(run(dir).out, /no base/);
});
