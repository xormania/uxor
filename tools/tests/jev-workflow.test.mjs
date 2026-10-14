// Run the independent workflow's actual diagnosis shell with slow local diagnostics: the total budget must stop it
// without failing the advisory step, even when several successful shards collected recovered failures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/jev.yml'), 'utf8');
const step = workflow.match(/            - name: Jev diagnosis\n([\s\S]*?)(?=\n            # One assessment)/)?.[1];
assert.ok(step, 'the Jev diagnosis step exists');
const shell = step.match(/              run: \|\n([\s\S]*)/)?.[1].split('\n').map((line) => line.slice(18)).join('\n');
assert.ok(shell, 'the diagnosis step has its shell');

test('the total diagnosis budget stops later artifacts and leaves the advisory step successful', () => {
    const jobMinutes = Number(workflow.match(/        timeout-minutes: (\d+)/)?.[1]);
    const stepMinutes = Number(step.match(/              timeout-minutes: (\d+)/)?.[1]);
    const totalSeconds = Number(step.match(/                  JEV_TOTAL_SECONDS: (\d+)/)?.[1]);
    assert.ok(totalSeconds < stepMinutes * 60 && stepMinutes <= jobMinutes - 4, 'setup and upload have at least four minutes outside the diagnosis step');
    const dir = mkdtempSync(join(tmpdir(), 'uxor-jev-budget-'));
    try {
        const inputs = join(dir, 'inputs');
        for (const name of ['a', 'b', 'c']) {
            mkdirSync(join(inputs, name), { recursive: true });
            writeFileSync(join(inputs, name, 'failed-attempts.json'), '{"attempts":[]}');
            writeFileSync(join(inputs, name, 'meta.json'), '{"job":"Recovered shard","shard":"1"}');
        }
        mkdirSync(join(dir, 'trusted/tools/ci'), { recursive: true });
        writeFileSync(join(dir, 'trusted/tools/ci/jev-diagnosis.mjs'), `
            console.log('diagnostic started');
            await new Promise((resolve) => setTimeout(resolve, 3000));
        `);
        const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', shell], {
            cwd: dir,
            env: { ...process.env, INPUTS: inputs, OUT: join(dir, 'out'), JEV_TOTAL_SECONDS: '1' },
            encoding: 'utf8',
            timeout: 10000,
        });
        assert.equal(run.status, 0, run.stderr);
        assert.equal((run.stdout.match(/diagnostic started/g) ?? []).length, 1, run.stdout);
        assert.match(run.stdout, /total diagnosis budget is spent/);
        assert.match(step, /continue-on-error: true/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
