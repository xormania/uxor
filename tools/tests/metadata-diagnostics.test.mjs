import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { findDisallowedMentions } from '../check-github-mentions.mjs';
import { stepIn } from '../ci/step-attempts.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const checker = join(root, 'tools/check-github-mentions.mjs');
const metadata = readFileSync(join(root, '.github/workflows/metadata.yml'), 'utf8');
const AT = String.fromCharCode(0x40);

test('redacted CLI diagnostics preserve rejection, locations and JSON without rejected account references', () => {
    const input = `first line\nnotify ${AT}Release and ${AT}Example/release-team\n`;
    for (const extra of [[], ['--json']]) {
        const run = spawnSync(process.execPath, [checker, '--redact', '--surface', `surface ${AT}unexpected`, ...extra], {
            input,
            encoding: 'utf8',
        });
        assert.equal(run.status, 1, run.stderr);
        const output = run.stdout + run.stderr;
        assert.deepEqual(findDisallowedMentions(output), []);
        assert.match(output, /\[redacted mention\]/);
        if (extra.length) {
            const findings = run.stdout.trim().split('\n').map((line) => JSON.parse(line));
            assert.deepEqual(findings.map(({ line, column }) => ({ line, column })), [
                { line: 2, column: 8 }, { line: 2, column: 21 },
            ]);
            assert.ok(findings.every(({ token }) => token === '[redacted mention]'));
        } else {
            assert.match(output, /<stdin>:2:8: disallowed GitHub mention/);
            assert.match(output, /<stdin>:2:21: disallowed GitHub mention/);
        }
    }
    const allowed = spawnSync(process.execPath, [checker, '--redact', '--allow', 'release'], {
        input: `approved ${AT}Release`, encoding: 'utf8',
    });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(allowed.stdout + allowed.stderr, '');
});

test('actual metadata steps capture redacted logs and failed attempts without changing their failure verdict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uxor-metadata-redaction-'));
    try {
        mkdirSync(join(dir, 'tools'), { recursive: true });
        copyFileSync(checker, join(dir, 'tools/check-github-mentions.mjs'));
        mkdirSync(join(dir, '.github'), { recursive: true });
        writeFileSync(join(dir, '.github/mention-allowlist'), '');
        mkdirSync(join(dir, 'bin'));
        const git = join(dir, 'bin/git');
        writeFileSync(git, '#!/bin/sh\ncase "$1" in\n  rev-list) printf "abc123\\n" ;;\n  log) printf "%s\\n" "$COMMIT_MESSAGE" ;;\n  *) exit 64 ;;\nesac\n');
        chmodSync(git, 0o755);
        const workflow = join(dir, 'metadata.yml');
        writeFileSync(workflow, metadata);
        for (const id of ['title', 'commits']) {
            const step = stepIn(metadata, 'mentions', id);
            assert.ok(step?.run, `the actual ${id} step has a run script`);
            const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {
                cwd: dir,
                env: {
                    ...process.env,
                    PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
                    RUNNER_TEMP: dir,
                    TITLE: `notify ${AT}Release`,
                    BODY: `ask ${AT}Example/release-team`,
                    COMMIT_MESSAGE: `fix: reject ${AT}Unexpected`,
                    BASE: 'base', HEAD: 'head',
                },
                encoding: 'utf8',
            });
            assert.equal(run.status, 1, run.stderr);
            const log = readFileSync(join(dir, `jev-${id}.log`), 'utf8');
            assert.match(log, /disallowed GitHub mention \[redacted mention\]/);
            assert.deepEqual(findDisallowedMentions(log + run.stdout + run.stderr), []);
            const output = join(dir, `${id}-attempts.json`);
            const collect = spawnSync(process.execPath, [
                join(root, 'tools/ci/step-attempts.mjs'), '--steps', JSON.stringify({ [id]: { conclusion: 'failure' } }),
                '--logs', dir, '--workflow', workflow, '--job', 'mentions', output,
            ], { encoding: 'utf8' });
            assert.equal(collect.status, 0, collect.stderr);
            const attempt = JSON.parse(readFileSync(output, 'utf8')).attempts[0];
            assert.match(attempt.error, /disallowed GitHub mention \[redacted mention\]/);
            assert.match(attempt.error, /on (pull-request-title|commit abc123)/);
            assert.deepEqual(findDisallowedMentions(attempt.error), []);
            assert.equal(attempt.status, 'failed');
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('new collecting jobs retain their original work budget before the collector and upload', () => {
    for (const [file, job, workMinutes] of [
        ['ci.yml', 'changes', 5],
        ['audit.yml', 'npm-audit', 5],
        ['audit.yml', 'composer-audit', 5],
        ['metadata.yml', 'mentions', 5],
        ['monthly.yml', 'php', 45],
    ]) {
        const workflow = readFileSync(join(root, '.github/workflows', file), 'utf8');
        const block = workflow.match(new RegExp(`^    ${job}:\\n([\\s\\S]*?)(?=^    [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1];
        assert.ok(block, `${file} has job ${job}`);
        const jobMinutes = Number(block.match(/^        timeout-minutes: (\d+)/m)?.[1]);
        const collector = block.match(/            - name: Jev diagnosis \(advisory\)\n([\s\S]*)/)?.[1];
        const collectorMinutes = Number(collector?.match(/              timeout-minutes: (\d+)/)?.[1]);
        assert.equal(collectorMinutes, 3, `${file}: ${job} retains a bounded collector`);
        assert.ok(jobMinutes >= workMinutes + collectorMinutes, `${file}: ${job} leaves time for collection and upload`);
    }
});
