import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { findDisallowedMentions } from '../check-github-mentions.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const checker = join(root, 'tools/check-github-mentions.mjs');
const AT = String.fromCharCode(0x40);

test('optional strict CLI diagnostics preserve rejection, locations and JSON without rejected account references', () => {
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

test('collecting jobs retain their original work budget before the collector and upload', () => {
    for (const [file, job, workMinutes] of [
        ['ci.yml', 'changes', 5],
        ['audit.yml', 'npm-audit', 5],
        ['audit.yml', 'composer-audit', 5],
        ['audit.yml', 'importmap-audit', 5],
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
