// The cases of tools/ci/background.mjs: a command started in the background of a CI job, and waited for later, with its
// failure, a timeout or a missing start reported instead of read as done.
// Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/background.mjs');

function run(dir, ...args) {
    const output = join(dir, 'github-output');
    const result = spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: output },
    });
    let outputs = {};
    try {
        outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=')));
    } catch {}
    return { ...result, outputs };
}

const temp = () => mkdtempSync(join(tmpdir(), 'background-'));

test('a command that succeeds: wait exits 0 and reports how long it ran and how long the wait took', () => {
    const dir = temp();
    const started = run(dir, 'start', 'pull', '--', 'sh', '-c', 'echo pulled; sleep 1');
    assert.equal(started.status, 0, started.stderr);
    const waited = run(dir, 'wait', 'pull', '--timeout', '30');
    assert.equal(waited.status, 0, waited.stderr);
    assert.match(waited.stdout, /pulled/, 'the command output is shown');
    assert.ok(Number(waited.outputs['pull-seconds']) >= 1, JSON.stringify(waited.outputs));
    assert.ok(Number(waited.outputs['pull-wait-seconds']) >= 0, JSON.stringify(waited.outputs));
});

test('start returns before the command ends', () => {
    const dir = temp();
    const begin = Date.now();
    const started = run(dir, 'start', 'slow', '--', 'sleep', '1.5');
    assert.equal(started.status, 0, started.stderr);
    assert.ok(Date.now() - begin < 1000, 'start did not wait for the command (it sleeps 1.5 s)');
    run(dir, 'wait', 'slow', '--timeout', '30');
});

test('a command that fails: wait fails with its exit status, an error annotation and the end of its output', () => {
    const dir = temp();
    run(dir, 'start', 'pull', '--', 'sh', '-c', 'echo "manifest unknown" >&2; exit 3');
    const waited = run(dir, 'wait', 'pull', '--timeout', '30');
    assert.equal(waited.status, 3);
    assert.match(waited.stdout, /::error::.*pull.*exit status 3/);
    assert.match(waited.stdout, /manifest unknown/);
});

test('a command that does not finish in time: wait fails and says so', () => {
    const dir = temp();
    run(dir, 'start', 'stuck', '--', 'sleep', '30');
    const begin = Date.now();
    const waited = run(dir, 'wait', 'stuck', '--timeout', '1');
    assert.notEqual(waited.status, 0);
    assert.ok(Date.now() - begin < 10000, 'the wait is bounded');
    assert.match(waited.stdout, /::error::.*stuck.*did not finish in 1 s/);
});

test('a command that cannot be run at all: wait fails, never a pass', () => {
    const dir = temp();
    run(dir, 'start', 'missing', '--', 'no-such-command-uxor');
    const waited = run(dir, 'wait', 'missing', '--timeout', '30');
    assert.notEqual(waited.status, 0);
    assert.match(waited.stdout, /::error::/);
});

test('wait for a command never started: exit status 2, so the step can run it in the foreground', () => {
    const dir = temp();
    const waited = run(dir, 'wait', 'never', '--timeout', '1');
    assert.equal(waited.status, 2);
    assert.match(waited.stdout, /::warning::.*never.*not started/);
});

test('a usage error exits 64', () => {
    const dir = temp();
    assert.equal(run(dir, 'start', 'x').status, 64, 'no command');
    assert.equal(run(dir, 'start', '../x', '--', 'true').status, 64, 'a name that is not a plain word');
    assert.equal(run(dir, 'wait', 'x', '--timeout', 'soon').status, 64, 'a timeout that is not a number');
    assert.equal(run(dir, 'other').status, 64);
});
