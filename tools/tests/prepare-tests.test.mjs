// The cases of tools/prepare-tests.mjs, on scratch checkouts: the recipe specs' copies, the CSS record and the locks,
// with several processes at once. Run: node --test tools/tests/*.test.mjs
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const modulePath = join(root, 'tools/prepare-tests.mjs');
const { recipeSpecs, syncRecipeSpecs, withLock } = await import(modulePath);

const UPSTREAM = "import { expect, test } from '../../../../assets/test/browser/fixtures';\n";

/** A checkout with recipes (a manifest.json and tests/*.spec.ts) and a directory that is not one. */
function checkout(recipes = { alert: { 'alert.spec.ts': 'one' }, modal: { 'modal.spec.ts': 'two', 'helpers.ts': 'not a spec' } }) {
    const dir = mkdtempSync(join(tmpdir(), 'prepare-tests-'));
    for (const [recipe, files] of Object.entries(recipes)) {
        mkdirSync(join(dir, recipe, 'tests'), { recursive: true });
        writeFileSync(join(dir, recipe, 'manifest.json'), '{}');
        for (const [file, body] of Object.entries(files)) {
            writeFileSync(join(dir, recipe, 'tests', file), `${UPSTREAM}// ${body}\n`);
        }
    }
    mkdirSync(join(dir, 'demo/tests'), { recursive: true });
    writeFileSync(join(dir, 'demo/tests/app.spec.ts'), 'no manifest: not a recipe');
    return dir;
}

const generated = (dir) => join(dir, 'tests/e2e/examples/recipes');

/** Runs `code` (an ES module body with prepare-tests.mjs's exports in scope) in its own process. */
function inProcess(code, env = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', `import * as p from ${JSON.stringify(modulePath)};\n${code}`], {
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => (output += chunk));
        child.stderr.on('data', (chunk) => (output += chunk));
        child.on('close', (code) => resolve({ code, output }));
    });
}

test('each recipe spec gets one copy, its fixtures import pointed at ours', () => {
    const dir = checkout();
    assert.deepEqual(syncRecipeSpecs(dir).sort(), ['alert.alert.spec.ts', 'modal.modal.spec.ts']);
    assert.deepEqual(readdirSync(generated(dir)).sort(), ['alert.alert.spec.ts', 'modal.modal.spec.ts']);
    assert.equal(
        readFileSync(join(generated(dir), 'modal.modal.spec.ts'), 'utf8'),
        "// Generated from modal/tests/modal.spec.ts by tools/prepare-tests.mjs: do not edit.\nimport { expect, test } from '../fixtures';\n// two\n",
    );
    assert.deepEqual(readdirSync(join(dir, 'tests/.prepare')), [], 'no temporary directory or lock is left');
});

test('nothing is written when nothing changed; a changed spec is replaced, a removed one deleted', () => {
    const dir = checkout();
    syncRecipeSpecs(dir);
    const before = statSync(join(generated(dir), 'alert.alert.spec.ts'));
    assert.deepEqual(syncRecipeSpecs(dir), []);
    const after = statSync(join(generated(dir), 'alert.alert.spec.ts'));
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);

    writeFileSync(join(dir, 'alert/tests/alert.spec.ts'), `${UPSTREAM}// changed\n`);
    execFileSync('rm', [join(dir, 'modal/tests/modal.spec.ts')]);
    writeFileSync(join(generated(dir), 'gone.old.spec.ts'), 'a recipe that no longer exists');
    assert.deepEqual(syncRecipeSpecs(dir).sort(), ['alert.alert.spec.ts', 'gone.old.spec.ts', 'modal.modal.spec.ts']);
    assert.deepEqual(readdirSync(generated(dir)), ['alert.alert.spec.ts']);
    assert.match(readFileSync(join(generated(dir), 'alert.alert.spec.ts'), 'utf8'), /\/\/ changed\n$/);
});

test('a process reading the copies while others rewrite them sees every file, whole', async () => {
    const dir = checkout();
    const source = join(dir, 'alert/tests/alert.spec.ts');
    const versions = ['A', 'B'].map((body) => `${UPSTREAM}// ${body.repeat(200_000)}\n`);
    const expected = versions.map((body) => {
        writeFileSync(source, body);
        return recipeSpecs(dir)['alert.alert.spec.ts'];
    });
    // outside every recipe: what the processes below read
    versions.forEach((body, index) => writeFileSync(join(dir, `version-${index}`), body));
    expected.forEach((body, index) => writeFileSync(join(dir, `expected-${index}`), body));
    syncRecipeSpecs(dir);
    // writers flip the source and sync, each in its own process; the reader checks every read until they are done
    const writer = (index) =>
        inProcess(`
            import { readFileSync, renameSync, writeFileSync } from 'node:fs';
            const versions = [0, 1].map((i) => readFileSync(${JSON.stringify(dir)} + '/version-' + i, 'utf8'));
            for (let i = 0; i < 60; i++) {
                // the source whole too: another writer's sync reads it
                writeFileSync(${JSON.stringify(source)} + '.' + process.pid, versions[(i + ${index}) % 2]);
                renameSync(${JSON.stringify(source)} + '.' + process.pid, ${JSON.stringify(source)});
                p.syncRecipeSpecs(${JSON.stringify(dir)});
            }`);
    const reader = inProcess(`
        import { existsSync, readdirSync, readFileSync } from 'node:fs';
        const expected = [0, 1].map((i) => readFileSync(${JSON.stringify(dir)} + '/expected-' + i, 'utf8'));
        const dir = ${JSON.stringify(generated(dir))};
        const deadline = Date.now() + 60_000;
        let reads = 0;
        while (!existsSync(${JSON.stringify(join(dir, 'done'))}) && Date.now() < deadline) {
            const names = readdirSync(dir).sort().join(' ');
            if (names !== 'alert.alert.spec.ts modal.modal.spec.ts') { console.log('listed: ' + names); process.exit(1); }
            const content = readFileSync(dir + '/alert.alert.spec.ts', 'utf8');
            if (!expected.includes(content)) { console.log('partial read: ' + content.length + ' characters'); process.exit(1); }
            reads++;
        }
        console.log(reads + ' reads');`);
    const writers = await Promise.all([writer(0), writer(1), writer(0)]);
    writeFileSync(join(dir, 'done'), '');
    const read = await reader;
    for (const { code, output } of writers) {
        assert.equal(code, 0, output);
    }
    assert.equal(read.code, 0, read.output);
    assert.match(read.output, /^[1-9]\d* reads/);
});

test('the CSS builds when its sources changed, once for processes that ask together', async () => {
    const dir = checkout();
    execFileSync('git', ['init', '-q', dir]);
    // a stand-in for PHP_BINARY: the record's read and write, and a slow tailwind:build that logs each build
    const php = join(dir, 'fake-php');
    writeFileSync(
        php,
        `#!/bin/sh
case "$1 $2" in
  "bin/console tailwind:build") sleep 0.5; mkdir -p var/tailwind; echo css > var/tailwind/app.built.css; echo build >> ../builds.log ;;
  "-r echo"*) [ -f var/tailwind/app.built.css ] && cat var/tailwind/sources.sha256 2>/dev/null; true ;;
  "-r file_put_contents"*) mkdir -p var/tailwind; echo "$4" > var/tailwind/sources.sha256 ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`,
    );
    chmodSync(php, 0o755);
    writeFileSync(join(dir, '.gitignore'), '/fake-php\n/builds.log\n/tests/\n/demo/var/\n');
    const builds = () => (existsSync(join(dir, 'builds.log')) ? readFileSync(join(dir, 'builds.log'), 'utf8').split('\n').filter(Boolean).length : 0);
    const env = { PHP_BINARY: php };
    const build = () => inProcess(`console.log('built=' + p.buildCssIfStale(${JSON.stringify(dir)}));`, env);

    const together = await Promise.all([build(), build(), build()]);
    assert.deepEqual(together.map(({ code }) => code), [0, 0, 0], together.map(({ output }) => output).join('\n'));
    assert.equal(builds(), 1, 'one build for three processes');
    assert.equal(together.filter(({ output }) => output.includes('built=true')).length, 1);

    assert.match((await build()).output, /built=false/);
    writeFileSync(join(dir, 'kit.css'), '.new { color: red }');
    assert.match((await build()).output, /built=true/);
    assert.equal(builds(), 2);
    writeFileSync(join(dir, 'ignored.log'), 'scanned? no: ignored');
    writeFileSync(join(dir, '.gitignore'), `${readFileSync(join(dir, '.gitignore'), 'utf8')}/ignored.log\n`);
    assert.match((await build()).output, /built=true/, '.gitignore itself is a source');
    writeFileSync(join(dir, 'ignored.log'), 'changed, still ignored');
    assert.match((await build()).output, /built=false/);
});

test('a lock held by a running process is waited for; one left by a process that is gone is taken over', async () => {
    const dir = checkout();
    mkdirSync(join(dir, 'tests/.prepare/css.lock'), { recursive: true });
    const self = `${hostname()} ${process.pid}`;
    writeFileSync(join(dir, 'tests/.prepare/css.lock/owner'), `${self}\n`);
    assert.throws(() => withLock(dir, 'css', () => 'ran', { timeoutMs: 300 }), /css\.lock is held by .* for more than 0\.3s/);

    const gone = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => gone.on('close', resolve));
    writeFileSync(join(dir, 'tests/.prepare/css.lock/owner'), `${hostname()} ${gone.pid}\n`);
    assert.equal(withLock(dir, 'css', () => 'ran', { timeoutMs: 300 }), 'ran');
    assert.deepEqual(readdirSync(join(dir, 'tests/.prepare')), []);
});
