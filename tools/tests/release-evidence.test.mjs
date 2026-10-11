import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evidence } from '../ci/release-evidence.mjs';

const script = fileURLToPath(new URL('../ci/release-evidence.mjs', import.meta.url));
// A Playwright JSON report: [project, file, status] per test ('expected', 'flaky', 'unexpected', 'skipped')
const report = (tests) => ({
    config: { projects: [] },
    suites: [...new Set(tests.map(([, file]) => file))].map((file) => ({
        title: file,
        file,
        specs: tests.filter(([, f]) => f === file).map(([project, , status], i) => ({ title: `t${i}`, file, tests: [{ projectName: project, status, results: [{ status: 'skipped' === status ? 'skipped' : 'passed' }] }] })),
        suites: [],
    })),
});
const required = { projects: ['smoke', 'harsh@release'], specs: ['release.timings.spec.ts'] };

test('every required project ran a test, every release spec ran and skipped none: no problem', () => {
    const r = report([['smoke', 'release.timings.spec.ts', 'expected'], ['harsh@release', 'chart.spec.ts', 'flaky'], ['harsh@release', 'chart.spec.ts', 'skipped']]);
    assert.deepEqual(evidence(r, required), []);
});

test('a project that ran nothing, a release spec missing or skipping a test: each one named', () => {
    const r = report([['smoke', 'release.timings.spec.ts', 'expected'], ['smoke', 'release.timings.spec.ts', 'skipped'], ['harsh@release', 'chart.spec.ts', 'skipped']]);
    assert.deepEqual(evidence(r, { ...required, specs: [...required.specs, 'release.fuzz.spec.ts'] }), [
        'project harsh@release ran no test',
        'release.timings.spec.ts skipped 1 test',
        'release.fuzz.spec.ts ran no test',
    ]);
});

test('the command line: exit 1 naming each gap, 0 when complete, 1 on a missing report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-evidence-'));
    const file = join(dir, 'results.json');
    const args = ['--project', 'smoke', '--project', 'harsh@release', '--spec', 'release.timings.spec.ts', file];
    writeFileSync(file, JSON.stringify(report([['smoke', 'release.timings.spec.ts', 'expected']])));
    const gap = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(gap.status, 1);
    assert.match(gap.stdout, /project harsh@release ran no test/);
    writeFileSync(file, JSON.stringify(report([['smoke', 'release.timings.spec.ts', 'expected'], ['harsh@release', 'x.spec.ts', 'expected']])));
    assert.equal(spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(process.execPath, [script, ...args.slice(0, -1), join(dir, 'none.json')], { encoding: 'utf8' }).status, 1);
});
