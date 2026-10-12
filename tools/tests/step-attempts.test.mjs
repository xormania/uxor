// The cases of tools/ci/step-attempts.mjs: a failed step's captured log turned into the failed-attempts.json Jev reads.
// Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/step-attempts.mjs');
const workspace = '/home/runner/work/flowbite-xor/flowbite-xor';

const WORKFLOW = `name: CI
jobs:
    contrast:
        name: Contrast
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@0000000000000000000000000000000000000000 # v0

            - name: Token contrast (both themes)
              id: tokens
              run: |
                  set -o pipefail
                  node tools/contrast/check.mjs 2>&1 | tee "$RUNNER_TEMP/jev-tokens.log"

            - name: 'llms.txt matches README.md'
              id: llms
              run: |
                  set -o pipefail
                  node tools/llms-txt.mjs --check 2>&1 | tee "$RUNNER_TEMP/jev-llms.log"

            - id: retry
              name: Download (3 attempts)
              run: |
                  set -o pipefail
                  {
                      for attempt in 1 2 3; do
                          bin/console importmap:install && exit 0
                      done
                      exit 1
                  } 2>&1 | tee "$RUNNER_TEMP/jev-retry.log"
    other:
        steps:
            - name: Not this job's
              id: tokens
              run: echo other
`;

function setup({ steps, logs, workflow = WORKFLOW }) {
    const dir = mkdtempSync(join(tmpdir(), 'step-attempts-'));
    writeFileSync(join(dir, 'ci.yml'), workflow);
    for (const [id, text] of Object.entries(logs)) writeFileSync(join(dir, `jev-${id}.log`), text);
    return { dir, steps: JSON.stringify(steps) };
}

function convert({ dir, steps }, extra = [], env = {}) {
    const out = join(dir, 'failed-attempts.json');
    const run = spawnSync(process.execPath, [script, '--steps', steps, '--logs', dir, '--workflow', join(dir, 'ci.yml'), '--job', 'contrast', ...extra, out], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, GITHUB_SHA: 'abc', GITHUB_WORKSPACE: workspace, ...env },
    });
    return { code: run.status, stderr: run.stderr, stdout: run.stdout, data: run.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) : null };
}

const failed = { outputs: {}, outcome: 'failure', conclusion: 'failure' };
const passed = { outputs: {}, outcome: 'success', conclusion: 'success' };

test("a failed step becomes one attempt: its name, its command and the log lines the policy's error_pattern selects", () => {
    const log = [
        '\u001b[32mChecking 42 pairs\u001b[0m',
        'light: text on surface 7.1:1 ok',
        `dark: muted on surface 3.9:1 below 4.5:1 (${workspace}/tools/contrast/pairs.json)`,
        '::error file=tools/contrast/pairs.json::2 pairs fail AA',
        'Error: 2 pairs below their minimum',
        '    at main (file:///x/check.mjs:10:5)',
        'done in 0.2 s',
    ].join('\n') + '\n';
    const { code, stderr, data } = convert(setup({ steps: { tokens: failed, llms: passed }, logs: { tokens: log, llms: 'Error-free\n' } }));
    assert.equal(code, 0, stderr);
    assert.equal(data.schema, 1);
    assert.equal(data.status, 'valid');
    assert.equal(data.shard, null);
    assert.deepEqual(data.counts, { passed: 1, failed: 1, flaky: 0, skipped: 0 });
    assert.equal(data.attempts.length, 1);
    const [attempt] = data.attempts;
    assert.equal(attempt.title, 'Token contrast (both themes)');
    assert.equal(attempt.testId, 'contrast::tokens');
    assert.equal(attempt.project, 'step');
    // the step's run: line in the workflow, where the annotation lands
    assert.match(attempt.file, /\/ci\.yml$/);
    assert.equal(attempt.line, 11);
    assert.deepEqual(attempt.errorLocation, { file: attempt.file, line: 11, column: null });
    assert.equal(attempt.status, 'failed');
    assert.equal(attempt.retry, 0);
    const lines = attempt.error.split('\n');
    assert.equal(lines[0], 'Step "Token contrast (both themes)" failed (job contrast).');
    assert.equal(lines[1], 'Command: node tools/contrast/check.mjs');
    // the selected lines with their line numbers in the log, colors and the runner's prefix removed
    assert.ok(lines.includes('4: ::error file=tools/contrast/pairs.json::2 pairs fail AA'), attempt.error);
    assert.ok(lines.includes('5: Error: 2 pairs below their minimum'), attempt.error);
    assert.ok(!lines.includes('2: light: text on surface 7.1:1 ok'), 'an unselected line is not in the selection');
    assert.doesNotMatch(attempt.error, /\u001b|\/home\/runner/);
    // the end of the log, which says how it ended, whether or not the pattern selects it
    assert.match(attempt.error, /\n7: done in 0\.2 s$/);
});

test('a step that passed, a failed step without a log and a log without a failed step give no attempt', () => {
    const { code, stderr, data, stdout } = convert(setup({ steps: { tokens: passed, llms: failed, other: failed }, logs: { tokens: 'error: but passed\n' } }));
    assert.equal(code, 0, stderr);
    assert.deepEqual(data.attempts, []);
    assert.match(stdout, /0 failed step\(s\) with a captured log/);
    // continue-on-error: the outcome failed, but the step did not fail the job
    const tolerated = convert(setup({ steps: { tokens: { outcome: 'failure', conclusion: 'success' } }, logs: { tokens: 'error\n' } }));
    assert.deepEqual(tolerated.data.attempts, []);
});

test('a multi-line command keeps its lines, without the capture (set -o pipefail, the group, 2>&1 | tee)', () => {
    const { code, stderr, data } = convert(setup({ steps: { retry: failed }, logs: { retry: 'importmap:install failed: the CDN did not answer\n' } }));
    assert.equal(code, 0, stderr);
    assert.equal(data.attempts[0].title, 'Download (3 attempts)');
    assert.equal(data.attempts[0].error.split('\nLog lines')[0].split('\n').slice(1).join('\n'), [
        'Command: for attempt in 1 2 3; do',
        '    bin/console importmap:install && exit 0',
        'done',
        'exit 1',
    ].join('\n'));
});

test('a folded run (>-) is read as the one command it is', async () => {
    const { stepIn } = await import(script);
    const workflow = 'jobs:\n    tools:\n        steps:\n            - name: Cases\n              id: cases\n              run: >-\n                  node --test\n                  --test-reporter=tap\n                  \'tools/tests/*.test.mjs\'\n';
    assert.deepEqual(stepIn(workflow, 'tools', 'cases'), { name: 'Cases', line: 6, run: "node --test --test-reporter=tap 'tools/tests/*.test.mjs'", command: "node --test --test-reporter=tap 'tools/tests/*.test.mjs'" });
});

test('a step the workflow does not name is still an attempt, named by its id', () => {
    const { code, stderr, data } = convert(setup({ steps: { gone: failed }, logs: { gone: 'fatal: no such ref\n' } }));
    assert.equal(code, 0, stderr);
    assert.equal(data.attempts[0].title, 'gone');
    assert.equal(data.attempts[0].line, null);
    assert.equal(data.attempts[0].errorLocation, null);
    assert.match(data.attempts[0].error, /^Step "gone" failed \(job contrast\)\.\nCommand: unknown\n/);
});

test('a long log is bounded: the first and last selected lines are kept, and the omission is said', () => {
    const log = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}: Exception number ${i + 1} ${'x'.repeat(40)}`).join('\n');
    const { code, stderr, data } = convert(setup({ steps: { tokens: failed }, logs: { tokens: log } }));
    assert.equal(code, 0, stderr);
    const error = data.attempts[0].error;
    const policy = JSON.parse(readFileSync(join(root, 'tools/ci/jev-ci.json'), 'utf8'));
    assert.ok(Buffer.byteLength(error) <= policy.limits.error_bytes, `${Buffer.byteLength(error)} bytes`);
    assert.match(error, /\n1: line 1: Exception number 1 /);
    assert.match(error, /\n5000: line 5000: Exception number 5000 /);
    assert.match(error, /\n\[\d+ selected lines omitted\]\n/);
});

test('missing arguments are a usage error', () => {
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(run.status, 64);
    assert.match(run.stderr, /Usage/);
});

// Every step of the repository's workflows that captures its log for Jev does it the one way the tool reads: an id,
// `set -o pipefail`, and a tee into $RUNNER_TEMP/jev-<id>.log; and the tool finds its name and its command
test("every captured step in .github/workflows is one the tool reads", async () => {
    const { stepIn } = await import(script);
    const dir = join(root, '.github/workflows');
    let captured = 0;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
        const text = readFileSync(join(dir, file), 'utf8');
        for (const [, id] of text.matchAll(/\| tee "\$RUNNER_TEMP\/jev-([a-z0-9-]+)\.log"/g)) {
            captured++;
            const job = jobOf(text, id);
            assert.ok(job, `${file}: jev-${id}.log is written by no step with id: ${id}`);
            const step = stepIn(text, job, id);
            assert.ok(step?.name, `${file}: step ${id} has no name`);
            assert.ok(step.command && !/tee|pipefail/.test(step.command), `${file}: step ${id}: ${step.command}`);
            assert.match(step.run, /^set -o pipefail\n/, `${file}: step ${id} must set -o pipefail first`);
        }
    }
    assert.ok(captured > 0, 'no captured step found');
});

function jobOf(text, id) {
    let job = null;
    for (const line of text.split('\n')) {
        const head = /^ {4}([a-z0-9_-]+):\s*$/.exec(line);
        if (head) job = head[1];
        if (new RegExp(`^\\s+(- )?id: ${id}\\s*$`).test(line)) return job;
    }
    return null;
}
