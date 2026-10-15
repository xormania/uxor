// Execute the workflow's own browser-selection shell: push builds keep the independent Symfony consumer checks,
// and only an explicitly enabled manual run activates the fixture's browser path.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/package-pilot.yml'), 'utf8');
const step = workflow.match(/            - name: Select browser checks\n([\s\S]*?)(?=\n            - )/)?.[1];
assert.ok(step, 'the browser selection step exists');
const shell = step.match(/              run: \|\n([\s\S]*)/)?.[1].split('\n').map((line) => line.slice(18)).join('\n');
assert.ok(shell, 'the browser selection step has its shell');

for (const [event, browsers, enabled] of [
    ['push', '', false],
    ['push', 'true', false],
    ['workflow_dispatch', 'true', true],
    ['workflow_dispatch', 'false', false],
]) {
    test(`${event} with browsers=${browsers || 'unset'} ${enabled ? 'enables' : 'does not enable'} the browser fixture`, () => {
        const dir = mkdtempSync(join(tmpdir(), 'uxor-package-pilot-workflow-'));
        try {
            const envFile = join(dir, 'env');
            const summaryFile = join(dir, 'summary');
            writeFileSync(envFile, '');
            const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', shell], {
                cwd: root,
                env: { ...process.env, EVENT: event, BROWSERS: browsers, GITHUB_ENV: envFile, GITHUB_STEP_SUMMARY: summaryFile },
                encoding: 'utf8',
                timeout: 10000,
            });
            assert.equal(run.status, 0, run.stderr);
            assert.equal(readFileSync(envFile, 'utf8'), enabled ? 'PILOT_BROWSER_CONTAINER=package-pilot-browser\n' : '');
            const summary = readFileSync(summaryFile, 'utf8');
            assert.match(summary, /Archive upgrade and rollback: PHP\/Symfony/);
            assert.equal(summary.includes('Browser contracts are unrun'), !enabled);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
}

test('the workflow leaves the browser container unset until selection and keeps archive checks unconditional', () => {
    assert.match(workflow, /browsers:\n\s+description: [^\n]+\n\s+type: boolean\n\s+default: true/);
    assert.doesNotMatch(workflow, /^\s+PILOT_BROWSER_CONTAINER:/m, 'no job or step env activates the browser fixture on push');
    assert.match(workflow, /- name: Pull the project-pinned PHP image\n\s+run: docker pull "\$PILOT_IMAGE"/);
    assert.match(workflow, /- name: Start the project-pinned browser server\n\s+if: env\.PILOT_BROWSER_CONTAINER != ''/);
    assert.match(workflow, /- name: Upgrade, rollback and source fingerprints\n\s+run: bash tools\/tests\/package-pilot\.sh/);
    assert.match(workflow, /- name: Stop the browser started by this job\n\s+if: always\(\) && env\.PILOT_BROWSER_CONTAINER != ''/);
});
