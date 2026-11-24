// The cases of tools/prepare-tests.mjs, on scratch checkouts: the recipe specs' copies, the CSS record and the locks,
// with several processes at once. Run: node --test tools/tests/*.test.mjs
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const modulePath = join(root, 'tools/prepare-tests.mjs');
const { cssSourcesDigest, recipeSpecs, syncRecipeSpecs, withLock } = await import(modulePath);

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
    assert.match(read.output, /^[1-9]\d* reads$/m);
});

test('each CSS entrypoint builds when its inputs change, once for processes that ask together', async (t) => {
    const dir = checkout();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    execFileSync('git', ['init', '-q', dir]);
    // a stand-in for PHP_BINARY: the record's read and write, and a slow tailwind:build that logs each build
    const php = join(dir, 'fake-php');
    writeFileSync(
        php,
        `#!/bin/sh
case "$1 $2" in
  "bin/console tailwind:build")
    name=\${3##*/}
    name=\${name%.css}
    sleep 0.2; mkdir -p var/tailwind; echo css > "var/tailwind/$name.built.css"; echo "$name" >> ../builds.log ;;
  "-r echo"*) [ -f "$4" ] && cat "$5" 2>/dev/null; true ;;
  "-r file_put_contents"*) echo "$5" > "$4" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`,
    );
    chmodSync(php, 0o755);
    writeFileSync(join(dir, '.gitignore'), '/fake-php\n/builds.log\n/tests/\n/demo/var/\n');
    const builds = () => readFileSync(join(dir, 'builds.log'), 'utf8').trim().split('\n');
    const env = { PHP_BINARY: php };
    const build = () => inProcess(`console.log('built=' + p.buildCssIfStale(${JSON.stringify(dir)}));`, env);
    const write = (path, contents) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), contents);
    };

    const together = await Promise.all([build(), build(), build()]);
    assert.deepEqual(together.map(({ code }) => code), [0, 0, 0], together.map(({ output }) => output).join('\n'));
    const both = ['toolkit-fixtures', 'demo-app'];
    assert.deepEqual(builds(), both, 'one build per entrypoint for three processes');
    assert.equal(together.filter(({ output }) => output.includes('built=true')).length, 1);

    assert.match((await build()).output, /built=false/);
    write('demo/templates/demo_app/dashboard.html.twig', '<div class="mt-1">');
    assert.match((await build()).output, /built=true/);
    assert.deepEqual(builds(), [...both, 'demo-app']);
    write('demo/templates/lab/index.html.twig', '<div class="mt-2">');
    assert.match((await build()).output, /built=true/);
    assert.deepEqual(builds(), [...both, 'demo-app', 'toolkit-fixtures']);
    rmSync(join(dir, 'demo/var/tailwind/demo-app.built.css'));
    assert.match((await build()).output, /built=true/);
    assert.deepEqual(builds(), [...both, 'demo-app', 'toolkit-fixtures', 'demo-app']);
    write('kit.css', '.new { color: red }');
    assert.match((await build()).output, /built=true/);
    assert.deepEqual(builds().slice(5), both);
    write('ignored.log', 'scanned? no: ignored');
    write('.gitignore', `${readFileSync(join(dir, '.gitignore'), 'utf8')}/ignored.log\n`);
    assert.match((await build()).output, /built=true/, '.gitignore itself is a source');
    write('ignored.log', 'changed, still ignored');
    assert.match((await build()).output, /built=false/);
});

test('each Tailwind build record tracks its entrypoint, scanned content and inputs that install or compile it', (t) => {
    const dir = checkout();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    execFileSync('git', ['init', '-q', dir]);
    const styles = join(root, 'demo/assets/styles');
    const toolkit = 'toolkit-fixtures';
    const app = 'demo-app';
    const both = [toolkit, app];
    writeFileSync(join(dir, '.gitignore'), '/demo/vendor/\n/demo/assets/vendor/\n/demo/templates/components/\n/node_modules/\n');
    const shared = readFileSync(join(styles, 'shared.css'), 'utf8');
    assert.match(shared, /@import "tailwindcss" source\(none\);/, 'only explicit sources contribute candidates');
    const sources = Object.fromEntries(both.map((entrypoint) => {
        const content = readFileSync(join(styles, `${entrypoint}.css`), 'utf8');
        assert.match(content, /@import "\.\/shared\.css";/);
        return [entrypoint, [...(shared + '\n' + content).matchAll(/^@source (not )?"([^"]+)";/gm)].map(([, excluded, path]) => ({
            excluded: !!excluded, pattern: relative(root, resolve(styles, path)),
        }))];
    }));
    const scannedByBoth = ['demo/templates/shared/_brand.html.twig', 'demo/templates/components/Button.html.twig',
        'demo/templates/layouts/base.html.twig', 'demo/src/UXor/Controller.php', 'demo/assets/controllers/csrf_protection_controller.js',
        'demo/src/Form/ProfileType.php',
        'demo/vendor/symfony/twig-bridge/Resources/views/Form/tailwind_2_layout.html.twig',
        'demo/vendor/symfony/twig-bridge/Resources/views/Form/form_div_layout.html.twig'];
    const scannedByToolkit = ['demo/templates/base.html.twig', 'demo/templates/preview.html.twig', 'demo/templates/_toolkit_stylesheets.html.twig', 'demo/templates/forms/index.html.twig',
        'demo/templates/lab/index.html.twig', 'demo/templates/oauth/login.html.twig',
        'demo/src/Controller/LabController.php', 'demo/src/Controller/PreviewController.php',
        'demo/assets/controllers/dropzone_echo_controller.js', 'alert/README.md', 'other/README.md', 'kit.js'];
    const scannedByApp = ['demo/templates/demo_app/dashboard.html.twig', 'demo/src/Controller/DemoAppController.php',
        'demo/src/Controller/RevenueAssistantController.php', 'demo/assets/controllers/revenue_assistant_controller.js'];
    const bothBuildInputs = ['alert/templates/button.html.twig', 'demo/config/packages/symfonycasts_tailwind.yaml', 'demo/composer.lock',
        'demo/assets/styles/shared.css', 'demo/assets/styles/xor.css', 'kit.css',
        'demo/assets/vendor/flowbite/dist/flowbite.min.css', 'demo/vendor/symfony/ux-live-component/assets/dist/live.min.css'];
    const omitted = ['README.md', 'demo/README.md', 'docs/GUIDE.md', 'INSTALL.md', 'website/templates/recipe.html.twig',
        'website/assets/site.css', 'website/src/Renderer.php', 'website/README.md', 'docs/README.md', 'docs/templates/snippet.html.twig', 'docs/subdir/review.md',
        'docs/PLAN-composer-package.md', '.github/workflows/release.yml', 'tests/e2e/shared.spec.ts',
        'packages/uxor/README.md', 'packages/uxor/OPERATIONS.md', 'packages/uxor/resources/guides.json',
        'composer.json', 'composer.lock', 'packages/uxor/dev/app/templates/widget.html.twig', 'tools/README.md',
        'node_modules/unrelated/templates/widget.html.twig', 'demo/assets/vendor/unrelated/data.json',
        'demo/vendor/symfony/twig-bridge/Resources/views/Form/unrelated.html.twig',
        'CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', '.github/pull_request_template.md'];
    const cases = [
        ...scannedByBoth.map((path) => [path, both, both]),
        ...scannedByToolkit.map((path) => [path, [toolkit], [toolkit]]),
        ...scannedByApp.map((path) => [path, [app], [app]]),
        ['new-recipe/manifest.json', [toolkit], both],
        ...bothBuildInputs.map((path) => [path, [], both]),
        [`demo/assets/styles/${toolkit}.css`, [], [toolkit]],
        [`demo/assets/styles/${app}.css`, [], [app]],
        ...omitted.map((path) => [path, [], []]),
    ];
    const digests = () => Object.fromEntries(both.map((entrypoint) => [entrypoint, cssSourcesDigest(entrypoint, dir)]));
    let before = digests();
    for (const [path, scanning, hashing] of cases) {
        for (const entrypoint of both) {
            const matching = sources[entrypoint].filter(({ pattern }) => matchesGlob(path, pattern) || matchesGlob(path, `${pattern}/**`));
            assert.equal(matching.some((s) => !s.excluded) && !matching.some((s) => s.excluded), scanning.includes(entrypoint), `CSS scan (${entrypoint}): ${path}`);
        }
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), '<div class="mt-80">');
        const after = digests();
        for (const entrypoint of both) {
            assert.equal(after[entrypoint] !== before[entrypoint], hashing.includes(entrypoint), `CSS build record (${entrypoint}): ${path}`);
        }
        before = after;
    }
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

test('stale lock recovery preserves a replacement lock held by a live contender', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'prepare-tests-recovery-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const lock = join(dir, 'tests/.prepare/css.lock');
    mkdirSync(lock, { recursive: true });
    const gone = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => gone.on('close', resolve));
    writeFileSync(join(lock, 'owner'), `${hostname()} ${gone.pid}\n`);

    const owner = `${hostname()} ${process.pid}\n`;
    const result = await inProcess(`
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        import { dirname, join, matchesGlob, relative, resolve } from 'node:path';

        const lock = ${JSON.stringify(lock)};
        const owner = ${JSON.stringify(owner)};
        const originalRename = fs.renameSync;
        const originalUnlink = fs.unlinkSync;
        const replacement = join(lock, 'owner-test-contender');
        let exchanged = false;

        function replaceObservedLock() {
            if (exchanged) return;
            exchanged = true;
            originalRename(lock, lock + '.original');
            fs.mkdirSync(lock);
            fs.writeFileSync(replacement, owner);
        }

        // Advance a competing process through acquisition between observing the dead owner
        // and removing its generation. Both the old directory path and the new marker can
        // serve as the boundary for this schedule.
        fs.renameSync = (from, to) => {
            if (from === lock) replaceObservedLock();
            return originalRename(from, to);
        };
        fs.unlinkSync = (path) => {
            if (path === join(lock, 'owner')) replaceObservedLock();
            return originalUnlink(path);
        };
        syncBuiltinESMExports();

        let entered = false;
        let error;
        try {
            p.withLock(${JSON.stringify(dir)}, 'css', () => { entered = true; }, { timeoutMs: 300 });
        } catch (caught) {
            error = caught;
        }
        assert.ok(exchanged, 'the replacement was installed at the reclamation boundary');
        assert.equal(entered, false, 'critical section entered while the replacement owner was still alive');
        assert.match(error?.message ?? '', /css\\.lock is held by .* for more than 0\\.3s/);
        assert.equal(fs.readFileSync(replacement, 'utf8'), owner);
    `);
    assert.equal(result.code, 0, result.output);
});
