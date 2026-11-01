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

test('release commit exemptions require verified merged dependency-update evidence and retain redacted failures', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'uxor-metadata-dependencies-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'tools'));
    copyFileSync(checker, join(dir, 'tools/check-github-mentions.mjs'));
    mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, '.github/mention-allowlist'), '');
    mkdirSync(join(dir, 'bin'));
    const executable = (name, source) => {
        const file = join(dir, 'bin', name);
        writeFileSync(file, `#!/bin/sh\n${source}\n`);
        chmodSync(file, 0o755);
    };
    executable('git', `
[ "$GIT_FAILURE" != "$1" ] || exit 2
case "$1" in
    rev-list) printf 'abc123\\n' ;;
    log) printf '%s\\n' "$COMMIT_MESSAGE" ;;
    *) exit 64 ;;
esac`);
    executable('gh', `
printf '%s\\n' "$3" >> "$API_CALLS"
case "$3" in
    */commits/abc123/pulls?*)
        [ "$FAIL_API" != associations ] || exit 1
        payload="$API_PULLS" ;;
    */pulls/159/commits?*)
        [ "$FAIL_API" != members ] || exit 1
        payload="$API_COMMITS" ;;
    *) exit 64 ;;
esac
printf '%s' "$payload" | jq -r "$5"`);
    const bot = { login: 'dependabot[bot]', id: 49699333, type: 'Bot' };
    const commitStep = stepIn(metadata, 'mentions', 'commits');
    const titleStep = stepIn(metadata, 'mentions', 'title');
    assert.match(metadata, /GH_TOKEN: \$\{\{ github.token \}\}/);
    assert.match(metadata, /REPO: \$\{\{ github.repository \}\}/);
    assert.match(metadata, /pull-requests: read/);
    const cases = [
        ['merge commit of a merged bot PR', (pr) => { pr.merge_commit_sha = 'abc123'; }, 0],
        ['bot member predating the final head', () => {}, 0],
        ['human PR with a dependency-update subject', (pr) => { pr.user = { ...bot, id: 12, login: 'owner', type: 'User' }; }, 1],
        ['unmerged bot PR', (pr) => { pr.merged_at = null; }, 1],
        ['foreign repository', (pr) => { pr.base.repo.full_name = 'other/project'; }, 1],
        ['forged bot login with another numeric identity', (pr) => { pr.user.id = 12; }, 1],
        ['bot identity with a different account type', (pr) => { pr.user.type = 'User'; }, 1],
        ['human commit added to the bot PR', (pr, member) => { member.author = { id: 12, login: 'owner', type: 'User' }; }, 1],
        ['forged member login', (pr, member) => { member.author.id = 12; }, 1],
        ['commit not in the bot PR', (pr, member) => { member.sha = 'unrelated'; }, 1],
        ['no associated PR', (pr, member, env) => { env.API_PULLS = '[]'; }, 1],
        ['association API unavailable', (pr, member, env) => { env.FAIL_API = 'associations'; }, 1],
        ['membership API unavailable', (pr, member, env) => { env.FAIL_API = 'members'; }, 1],
        ['invalid API response', (pr, member, env) => { env.API_PULLS = '{'; }, 1],
        ['clean human message needs no API', (pr, member, env) => { env.COMMIT_MESSAGE = 'fix: clean'; env.FAIL_API = 'associations'; }, 0],
        ['Git range failure cannot pass', (pr, member, env) => { env.GIT_FAILURE = 'rev-list'; }, 1],
        ['Git message failure cannot pass', (pr, member, env) => { env.GIT_FAILURE = 'log'; }, 1],
    ];
    for (const [name, change, expected] of cases) {
        await t.test(name, () => {
            const pr = { number: 159, user: { ...bot }, merged_at: '2026-10-19T22:42:53Z',
                base: { repo: { full_name: 'example/project' } }, merge_commit_sha: 'merge-sha', head: { sha: 'later-head' } };
            const member = { sha: 'abc123', author: { ...bot } };
            const extra = {};
            change(pr, member, extra);
            const calls = join(dir, 'calls');
            writeFileSync(calls, '');
            const env = {
                ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: dir,
                REPO: 'example/project', BASE: 'base', HEAD: 'head', API_CALLS: calls,
                COMMIT_MESSAGE: `chore: bump ${AT}scope/package`, API_PULLS: JSON.stringify([pr]),
                API_COMMITS: JSON.stringify([member]), ...extra,
            };
            const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', commitStep.run], { cwd: dir, env, encoding: 'utf8' });
            assert.equal(run.status, expected, run.stdout + run.stderr);
            assert.deepEqual(findDisallowedMentions(run.stdout + run.stderr), []);
            if (name === 'clean human message needs no API') assert.equal(readFileSync(calls, 'utf8'), '');
            if (expected === 0 && !extra.COMMIT_MESSAGE) {
                assert.match(run.stdout, /the existing bot exemption applies/);
                // A release PR's own text still runs through the unchanged strict check.
                const title = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', titleStep.run], {
                    cwd: dir, env: { ...env, TITLE: `notify ${AT}Unexpected`, BODY: 'release' }, encoding: 'utf8',
                });
                assert.equal(title.status, 1, title.stdout + title.stderr);
                assert.deepEqual(findDisallowedMentions(title.stdout + title.stderr), []);
            }
        });
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
