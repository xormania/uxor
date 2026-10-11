// The cases of tools/ci/release-timings.mjs: the release checks' timings against the baseline, report only, and a
// recorded baseline. Run: node --test tools/tests/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gather } from '../monthly/timings.mjs';
import { baseline, markdown, metricsOf } from '../ci/release-timings.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/release-timings.mjs');
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
const scratch = () => mkdtempSync(join(tmpdir(), 'release-timings-'));

// A Playwright JSON report: one test whose runs are [status, annotations]
const report = (runs) => ({
    config: { version: '1.58.2', projects: [] },
    suites: [{ title: 'f', file: 'f', specs: [{ title: 't', file: 'f', line: 1, ok: true, tests: [{ projectName: 'smoke', status: 'expected', annotations: [], results: runs.map(([status, annotations]) => ({ status, annotations })) }] }] }],
});
const timing = (step, durationMs, inpMs, metrics) => ({ type: 'timing', description: JSON.stringify({ step, durationMs, inpMs, ...(metrics ? { metrics } : {}) }) });
// INP: 16, 24, 24, 32, 40 over the five runs (a spread of 8 ms), whatever the durations
const fiveRuns = (ms) => report(ms.map((value, i) => ['passed', [timing('table sort', value, [24, 16, 40, 24, 32][i % 5], { tbtMs: value / 10, layoutMs: 2 })]]));

test('each metric\'s median over the runs: duration, INP and the extra metrics; a failed run is left out', () => {
    const withFailure = fiveRuns([100, 90, 300, 110, 120]);
    withFailure.suites[0].specs[0].tests[0].results.push({ status: 'failed', annotations: [timing('table sort', 9999, 999, { tbtMs: 999, layoutMs: 99 })] });
    const { steps } = gather([withFailure]);
    assert.deepEqual(metricsOf(steps['table sort']), {
        durationMs: { median: 110, spread: 20, runs: 5 },
        inpMs: { median: 24, spread: 8, runs: 5 },
        layoutMs: { median: 2, spread: 0, runs: 5 },
        tbtMs: { median: 11, spread: 2, runs: 5 },
    });
});

test('the report sets each metric against the baseline, with the change, and never fails on a number', () => {
    const current = gather([fiveRuns([200, 210, 190, 205, 195])]);
    const base = baseline(gather([fiveRuns([100, 90, 300, 110, 120])]), { commit: 'abcdef1234567890', date: '2026-10-10' });
    const text = markdown(current, base);
    assert.match(text, /Baseline: commit `abcdef123456`, 2026-10-10\./);
    assert.match(text, /\| table sort \| duration \| 5 \| 200 ms \| 110 ms \| \+90 ms \(\+82%\) \| 20 ms \|/);
    assert.match(text, /\| table sort \| layout \| 5 \| 2 ms \| 2 ms \| 0 ms \(0%\) \| 0 ms \|/);

    const dir = scratch();
    writeFileSync(join(dir, 'results.json'), JSON.stringify(fiveRuns([900, 900, 900, 900, 900])));
    writeFileSync(join(dir, 'baseline.json'), JSON.stringify(base));
    const result = run(['--baseline', join(dir, 'baseline.json'), '--out', dir, join(dir, 'results.json')]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(dir, 'release-timings.md'), 'utf8'), /\| table sort \| duration \| 5 \| 900 ms \| 110 ms \| \+790 ms/);
});

test('without a baseline file, every metric is reported with none to compare; a step gone from the run is named', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'results.json'), JSON.stringify(fiveRuns([10, 10, 10, 10, 10])));
    const missing = run(['--baseline', join(dir, 'nope.json'), join(dir, 'results.json')]);
    assert.equal(missing.status, 0, missing.stderr);
    assert.match(missing.stdout, /No baseline to compare with \(.*nope\.json does not exist\)/);
    assert.match(missing.stdout, /\| table sort \| duration \| 5 \| 10 ms \| — \| — \| — \|/);

    const base = { commit: 'c', date: 'd', steps: { 'old step': { durationMs: { median: 1, spread: 0, runs: 5 } } } };
    assert.match(markdown(gather([fiveRuns([10, 10, 10, 10, 10])]), base), /In the baseline, not timed in this run: old step\./);
});

test('--record writes the run as a baseline: per step and metric, the median and the spread, with the commit and the date', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'results.json'), JSON.stringify(fiveRuns([100, 90, 300, 110, 120])));
    const result = run(['--record', join(dir, 'perf/baseline.json'), '--commit', 'abc', '--date', '2026-10-10', join(dir, 'results.json')]);
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(readFileSync(join(dir, 'perf/baseline.json'), 'utf8'));
    assert.equal(saved.commit, 'abc');
    assert.equal(saved.date, '2026-10-10');
    assert.deepEqual(saved.steps['table sort'].durationMs, { median: 110, spread: 20, runs: 5 });
    assert.deepEqual(saved.steps['table sort'].inpMs, { median: 24, spread: 8, runs: 5 }, 'INP keeps its spread, as the other metrics');
});

test('no timed step fails (no report, never an empty one); bad usage and an unreadable baseline are 64', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'results.json'), JSON.stringify(report([['passed', []]])));
    const empty = run([join(dir, 'results.json')]);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /no timing/);
    assert.equal(run([]).status, 64);
    assert.equal(run(['--baseline']).status, 64);
    writeFileSync(join(dir, 'bad.json'), '{');
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(fiveRuns([1, 1, 1, 1, 1])));
    assert.equal(run(['--baseline', join(dir, 'bad.json'), join(dir, 'ok.json')]).status, 64);
    // --min-runs is a positive whole number, or the partial-run guard would pass anything
    for (const value of ['nope', '0', '-1', '2.5', 'Infinity', '']) {
        const bad = run(['--record', join(dir, 'never.json'), '--min-runs', value, join(dir, 'ok.json')]);
        assert.equal(bad.status, 64, `--min-runs ${JSON.stringify(value)}: ${bad.stdout}${bad.stderr}`);
        assert.throws(() => readFileSync(join(dir, 'never.json')));
    }
});

test('a baseline recorded with another timing harness is not compared with: the report says to re-record it', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'results.json'), JSON.stringify(fiveRuns([200, 200, 200, 200, 200])));
    // what the checked-in baseline was before the harness version: the duration ended before the presented frame
    const old = baseline(gather([fiveRuns([100, 100, 100, 100, 100])]), { commit: 'abcdef1234567890', date: '2026-10-10' });
    delete old.harness;
    writeFileSync(join(dir, 'old.json'), JSON.stringify(old));
    const result = run(['--baseline', join(dir, 'old.json'), join(dir, 'results.json')]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No baseline to compare with \(.*old\.json was recorded with timing harness 1, this run uses 2: record it again\)/);
    assert.doesNotMatch(result.stdout, /\| 100 ms \|/);

    // one recorded now carries the version and is compared with
    const recorded = join(dir, 'new.json');
    assert.equal(run(['--record', recorded, '--commit', 'abc', join(dir, 'results.json')]).status, 0);
    assert.equal(JSON.parse(readFileSync(recorded, 'utf8')).harness, 2);
    assert.match(run(['--baseline', recorded, join(dir, 'results.json')]).stdout, /Baseline: commit `abc`/);
});

test('--record refuses a partial baseline: a step with fewer runs than asked, or one the comparable baseline has', () => {
    const dir = scratch();
    const three = report([100, 100, 100].map((value) => ['passed', [timing('table sort', value, 20)]]));
    writeFileSync(join(dir, 'three.json'), JSON.stringify(three));
    const few = run(['--record', join(dir, 'few.json'), '--commit', 'abc', join(dir, 'three.json')]);
    assert.equal(few.status, 2, few.stdout + few.stderr);
    assert.match(few.stderr, /table sort: 3 runs of durationMs, 5 needed/);
    assert.throws(() => readFileSync(join(dir, 'few.json')));

    // five runs of one step, against a baseline of the same harness that also has another step
    const base = baseline(gather([fiveRuns([100, 100, 100, 100, 100])]), { commit: 'abc', date: '2026-10-10' });
    base.steps['dashboard back'] = base.steps['table sort'];
    writeFileSync(join(dir, 'base.json'), JSON.stringify(base));
    writeFileSync(join(dir, 'five.json'), JSON.stringify(fiveRuns([100, 100, 100, 100, 100])));
    const missing = run(['--baseline', join(dir, 'base.json'), '--record', join(dir, 'partial.json'), '--commit', 'abc', join(dir, 'five.json')]);
    assert.equal(missing.status, 2, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /dashboard back: in the baseline, not timed/);
    assert.throws(() => readFileSync(join(dir, 'partial.json')));

    // a baseline of another harness is not compared with, but its steps still count: none may be left out
    const old = { ...base };
    delete old.harness;
    writeFileSync(join(dir, 'old.json'), JSON.stringify(old));
    const oldMissing = run(['--baseline', join(dir, 'old.json'), '--record', join(dir, 'old-partial.json'), '--commit', 'abc', join(dir, 'five.json')]);
    assert.equal(oldMissing.status, 2, oldMissing.stdout + oldMissing.stderr);
    assert.match(oldMissing.stderr, /dashboard back: in the baseline, not timed/);
    assert.throws(() => readFileSync(join(dir, 'old-partial.json')));

    // complete: recorded
    assert.equal(run(['--record', join(dir, 'ok.json'), '--commit', 'abc', join(dir, 'five.json')]).status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, 'ok.json'), 'utf8')).steps['table sort'].durationMs.runs, 5);
});
