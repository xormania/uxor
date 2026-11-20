// The runner's public CLI, with a local demo and a stand-in for Playwright. No dependency downloads.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = join(root, 'tools/plant-fault.py');
const catalog = join(root, 'tools/planted-faults.json');
const ids = [
    'calendar-select-nothing', 'calendar-change-twice', 'calendar-silent-removal', 'dropzone-remove-name',
    'popover-escape-focus', 'data-table-status-short', 'data-table-live-selection', 'data-table-live-status-short',
    'data-table-page-link-next', 'dropdown-disconnect-leak', 'dropdown-close-leak', 'modal-not-modal',
    'drawer-not-modal', 'theme-after-first-paint', 'lab-link-full-load',
];

test('all named faults still match their sources exactly once, including the two layout edits', () => {
    const faults = JSON.parse(readFileSync(catalog));
    assert.deepEqual(Object.keys(faults).sort(), [...ids].sort());
    assert.equal(faults['theme-after-first-paint'].edits.length, 2);
    for (const [name, fault] of Object.entries(faults)) {
        for (const { path, search, replace } of fault.edits) {
            const source = readFileSync(join(root, path), 'utf8');
            assert.equal(source.split(search).length - 1, 1, name);
            assert.notEqual(search, replace, name);
        }
    }
});

test('served confirmation gates Playwright, propagates failures, and preserves an occupied checkout', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'uxor-fault-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const repo = join(dir, 'occupied');
    const scratch = join(dir, 'scratch');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(scratch);
    const clone = spawnSync('git', ['clone', '--quiet', '--shared', '--', root, repo], { encoding: 'utf8' });
    assert.equal(clone.status, 0, clone.stderr);
    const occupied = join(repo, 'demo/templates/base.html.twig');
    writeFileSync(occupied, 'in-progress work that must survive\n');
    const executable = (name, source) => {
        const path = join(bin, name);
        writeFileSync(path, source);
        chmodSync(path, 0o755);
    };
    executable('composer', `#!/bin/sh
set -eu
cat >public/index.php <<'PHP'
<?php
if (str_starts_with($_SERVER['REQUEST_URI'], '/lab/data-table-frame')) {
    echo '<a href="?sort=name&amp;page=3" aria-label="Page 3">3</a>',
         '<a aria-label="Page 2" class="pagination" href="?sort=name&amp;page=', getenv('SERVED_PAGE'), '">2</a>';
    return;
}
$layout = file_get_contents(__DIR__.'/../templates/base.html.twig');
echo getenv('SERVE_STALE') ? 'old page' : str_replace("{{ path('app_lab') }}", '/lab', $layout);
PHP
printf '%s\\n' '<?php' > bin/console
`);
    executable('npm', `#!/bin/sh
set -eu
mkdir -p node_modules/.bin
cat >node_modules/.bin/playwright <<'PLAYWRIGHT'
#!/bin/sh
printf '%s\\n' "$@" > "$PLANT_TEST_ARGS"
if [ -n "$WAIT_FOR_SIGNAL" ]; then exec sleep 60; fi
exit 19
PLAYWRIGHT
chmod +x node_modules/.bin/playwright
`);
    const log = join(dir, 'args');
    const options = {
        cwd: repo, encoding: 'utf8', timeout: 25000,
        env: { ...process.env, PATH: bin + ':' + process.env.PATH, TMPDIR: scratch,
            PLANT_TEST_ARGS: log, DEMO_URL: 'https://occupied.invalid' },
    };
    const args = [runner, 'lab-link-full-load', '--', 'tests/e2e/smoke.spec.ts', '--retries=0'];
    for (const stale of [true, false]) {
        const result = spawnSync('python3', args, {
            ...options, env: { ...options.env, SERVE_STALE: stale ? '1' : '' },
        });
        const output = result.stdout + result.stderr;
        if (stale) {
            assert.match(output, /not served/i);
            assert.notEqual(result.status, 0);
            assert.equal(existsSync(log), false);
        } else {
            assert.match(output, /confirmed/i);
            assert.equal(result.status, 19, output);
            assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['test', 'tests/e2e/smoke.spec.ts', '--retries=0']);
        }
        assert.equal(readFileSync(occupied, 'utf8'), 'in-progress work that must survive\n');
        assert.deepEqual(readdirSync(scratch), []);
    }

    // Page 3 may already exist on the clean page. Only the destination of the Page 2 link proves this mutation.
    for (const page of ['2', '3']) {
        const result = spawnSync('python3', [runner, 'data-table-page-link-next', '--confirm-only'], {
            ...options, env: { ...options.env, SERVED_PAGE: page },
        });
        assert.equal(result.status, page === '3' ? 0 : 1, result.stdout + result.stderr);
    }

    rmSync(log);
    const child = spawn('python3', args, { ...options, env: { ...options.env, WAIT_FOR_SIGNAL: '1' } });
    const ended = once(child, 'exit');
    try {
        for (let i = 0; !existsSync(log) && child.exitCode === null && i < 200; i++) await delay(50);
        assert.ok(existsSync(log), 'Playwright started');
        child.kill('SIGTERM');
        assert.deepEqual(await ended, [130, null]);
        assert.equal(readFileSync(occupied, 'utf8'), 'in-progress work that must survive\n');
        assert.deepEqual(readdirSync(scratch), []);
    } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
    }
});
