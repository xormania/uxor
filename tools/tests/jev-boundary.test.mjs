// The privileged workflow's code/data boundary; no remote provider or credential is used.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../..', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/jev.yml', root), 'utf8');

test('producer workflows never call the privileged consumer or receive its credential', () => {
    const directory = new URL('.github/workflows/', root);
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.yml') && name !== 'jev.yml')) {
        const source = readFileSync(new URL(file, directory), 'utf8');
        assert.doesNotMatch(source, /\bTYPESAFE_API_KEY\b|uses:\s*\.\/.github\/workflows\/jev\.yml|^    jev:\s*$/m, file);
    }
});

function script(name) {
    const start = workflow.indexOf(`- name: ${name}\n`);
    assert.notEqual(start, -1);
    const rest = workflow.slice(start);
    const match = rest.match(/\n              run: \|\n((?:                  .*\n|\n)+)/);
    assert.ok(match, `the ${name} step has a literal script`);
    return match[1].split('\n').map((line) => line.replace(/^ {18}/, '')).join('\n');
}

test('the independent trusted workflow reads the source run and attempt outside its checkout', () => {
    assert.match(workflow, /on:\n    workflow_run:\n        workflows: \[CI, Monthly, Pages, Release, Release checks(?:, Audit, Metadata)?\]\n        types: \[completed\]/);
    assert.doesNotMatch(workflow, /workflow_call:|workflow_dispatch:|pull_request:|\binputs\./);
    assert.match(workflow, /actions: read/);
    assert.match(workflow, /if: github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
    assert.match(workflow, /pattern: jev-input-\*-\*-\$\{\{ github\.event\.workflow_run\.id \}\}-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}/);
    assert.match(workflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
    assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
    assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/jev-inputs/);
    assert.match(workflow, /ref: main\n                  path: trusted/);
    assert.match(workflow, /ref: dev\n                  path: trusted/);
    assert.doesNotMatch(workflow, /ref:.*\$\{\{|actions\/cache@|npm (?:ci|install)|docker /);
    assert.doesNotMatch(script('Jev diagnosis'), /\$\{\{[^}]*\}\}/);
});

test('source branch text selects only a literal protected checkout', () => {
    for (const [branch, expected] of [['main', 'main'], ['dev', 'dev'], ['feature', 'dev'], ['main; exit 42', 'dev']]) {
        const dir = mkdtempSync(join(tmpdir(), 'jev-ref-'));
        try {
            const output = join(dir, 'outputs');
            const run = spawnSync('bash', ['-e', '-c', script('The trusted branch')], {
                encoding: 'utf8', env: { ...process.env, HEAD_BRANCH: branch, GITHUB_OUTPUT: output },
            });
            assert.equal(run.status, 0, run.stderr);
            assert.equal(readFileSync(output, 'utf8'), `ref=${expected}\n`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('release and nested Pages artifacts are data, including hostile metadata and executable files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-artifacts-'));
    try {
        const inputs = join(dir, 'inputs');
        const bin = join(dir, 'bin');
        const calls = join(dir, 'calls.jsonl');
        const output = join(dir, 'assessments');
        mkdirSync(bin);
        const payload = `$(touch ${join(dir, 'executed')})`;
        for (const name of ['jev-input-release-install-99-2', 'jev-input-pages-build-99-2']) {
            const artifact = join(inputs, name);
            mkdirSync(artifact, { recursive: true });
            writeFileSync(join(artifact, 'failed-attempts.json'), JSON.stringify({ attempts: [] }));
            writeFileSync(join(artifact, 'meta.json'), JSON.stringify({ job: payload, shard: payload }));
            writeFileSync(join(artifact, 'server.log'), 'a captured error is data');
            writeFileSync(join(artifact, 'jev-diagnosis.mjs'), `throw new Error('artifact code ran');`);
        }
        writeFileSync(join(bin, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
        writeFileSync(join(bin, 'node'), `#!${process.execPath}\n` + String.raw`
const fs = require('fs');
if (process.argv[2] !== 'trusted/tools/ci/jev-diagnosis.mjs') process.exit(42);
fs.appendFileSync(process.env.CALLS, JSON.stringify({ args: process.argv.slice(2), shard: process.env.SHARD,
    sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT }) + '\n');
`, { mode: 0o755 });
        const run = spawnSync('bash', ['-e', '-c', script('Jev diagnosis')], {
            cwd: dir, encoding: 'utf8', timeout: 5000,
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INPUTS: inputs, OUT: output,
                CALLS: calls, JEV_TOTAL_SECONDS: '600', SOURCE_SHA: 'a'.repeat(40), SOURCE_RUN_ID: '99', SOURCE_RUN_ATTEMPT: '2' },
        });
        assert.equal(run.status, 0, run.stderr);
        const observed = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
        assert.equal(observed.length, 2, 'both producer keys in the source run are assessed');
        for (const { args, shard, sha, run, attempt } of observed) {
            assert.equal(args[0], 'trusted/tools/ci/jev-diagnosis.mjs');
            assert.equal(args[args.indexOf('--job') + 1], payload);
            assert.equal(shard, payload);
            assert.equal(sha, 'a'.repeat(40));
            assert.equal(run, '99');
            assert.equal(attempt, '2');
            assert.ok(args.includes('--server-log'));
        }
        assert.throws(() => readFileSync(join(dir, 'executed')), { code: 'ENOENT' });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
