// The cases of tools/ci/shard-plan.mjs: CI's browser shards split by recorded test time instead of test count. The
// plan is a pure function of Playwright's test list and tests/shard-timings.json, so every shard job computes the same
// one; these cases check that it balances, that it always covers every listed test exactly once, that it falls back to
// Playwright's own --shard when the timings cannot be trusted, and the commands as CI runs them (plan, verify, timings).
// Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPartition, listedTests, mergeTimings, planShards, testListMatches } from '../ci/shard-plan.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/shard-plan.mjs');

/** A Playwright JSON report as `--list --reporter=json` writes it: files, nested describes, one test per project. */
function report(files) {
    return {
        config: { rootDir: '/runner/work/uxor/uxor', version: '1.58.2' },
        suites: Object.entries(files).map(([file, entries]) => ({ title: file, file, line: 0, column: 0, ...suite(file, entries) })),
        errors: [],
    };
}

/** entries: { title: projects[] } for a test, { title: { ...entries } } for a describe */
function suite(file, entries) {
    const specs = [];
    const suites = [];
    let line = 1;
    for (const [title, value] of Object.entries(entries)) {
        if (Array.isArray(value)) {
            specs.push({ title, file, line: line++, column: 5, id: `${file}-${title}`, tests: value.map((projectName) => ({ projectName, projectId: projectName, results: [] })) });
        } else {
            suites.push({ title, file, line: line++, column: 1, ...suite(file, value) });
        }
    }
    return { specs, suites };
}

const key = (project, file, ...titles) => `[${project}] › ${file} › ${titles.join(' › ')}`;

/** n tests in one file of the smoke project, with the given times */
function timedTests(times, file = 'tests/e2e/a.spec.ts') {
    const tests = listedTests(report({ [file]: Object.fromEntries(times.map((_, i) => [`t${i}`, ['smoke']])) }));
    const timings = { schema: 1, tests: Object.fromEntries(times.map((ms, i) => [key('smoke', file, `t${i}`), ms])) };
    return { tests, timings };
}

test('listedTests reads every test of a --list report, keyed as durations.json names it', () => {
    const tests = listedTests(report({
        'tests/e2e/menu.spec.ts': { opens: ['smoke', 'smoke-firefox'], keyboard: { 'arrow keys move': ['smoke'], nested: { deep: ['smoke'] } } },
        'tests/e2e/examples/recipes/tabs.tabs.spec.ts': { 'switches tab': ['examples'] },
    }));
    assert.deepEqual(tests.map((t) => t.key).sort(), [
        key('examples', 'tabs/tests/tabs.spec.ts', 'switches tab'),
        key('smoke-firefox', 'tests/e2e/menu.spec.ts', 'opens'),
        key('smoke', 'tests/e2e/menu.spec.ts', 'keyboard', 'arrow keys move'),
        key('smoke', 'tests/e2e/menu.spec.ts', 'keyboard', 'nested', 'deep'),
        key('smoke', 'tests/e2e/menu.spec.ts', 'opens'),
    ]);
    // the generated recipe copy is the file Playwright loads: the test list names it, the timings the committed spec
    const tabs = tests.find((t) => t.project === 'examples');
    assert.equal(tabs.file, 'tests/e2e/examples/recipes/tabs.tabs.spec.ts');
    assert.equal(tabs.line, '[examples] › tests/e2e/examples/recipes/tabs.tabs.spec.ts › switches tab');
});

test('the longest tests go first, each to the least loaded shard: the shards balance by time, not count', () => {
    const { tests, timings } = timedTests([8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 500, 500]);
    const plan = planShards({ tests, timings, shards: 2 });
    assert.equal(plan.mode, 'timings');
    assert.deepEqual(plan.shards.map((s) => s.predictedMs), [18500, 18500]);
    // a count split of the same list in its order (5 and 5) would put 30 s in the first shard and 7 s in the second
    assert.ok(Math.max(...plan.shards.map((s) => s.predictedMs)) < 30000);
});

test('the plan is deterministic: the same list in another order gives the same shards', () => {
    const { tests, timings } = timedTests([3000, 3000, 2000, 2000, 1000, 1000, 1000, 700, 300]);
    const a = planShards({ tests, timings, shards: 3 });
    const b = planShards({ tests: [...tests].reverse(), timings, shards: 3 });
    assert.deepEqual(a.shards.map((s) => s.ids), b.shards.map((s) => s.ids));
});

test('every listed test lands in exactly one shard, an untimed one at its file\'s mean time', () => {
    const tests = listedTests(report({
        'tests/e2e/a.spec.ts': { one: ['smoke'], two: ['smoke'], 'new test': ['smoke'] },
        'tests/e2e/b.spec.ts': { three: ['smoke', 'smoke-webkit'], 'also new': ['smoke'] },
    }));
    const timings = { schema: 1, tests: {
        [key('smoke', 'tests/e2e/a.spec.ts', 'one')]: 1000,
        [key('smoke', 'tests/e2e/a.spec.ts', 'two')]: 3000,
        [key('smoke', 'tests/e2e/b.spec.ts', 'three')]: 5000,
        [key('smoke-webkit', 'tests/e2e/b.spec.ts', 'three')]: 7000,
        [key('smoke', 'tests/e2e/gone.spec.ts', 'deleted')]: 9000,
    } };
    const plan = planShards({ tests, timings, shards: 2 });
    assert.equal(plan.mode, 'timings');
    assert.equal(plan.timed, 4);
    assert.equal(plan.tests, 6);
    assert.deepEqual(checkPartition(tests.map((t) => t.key), plan.shards.map((s) => s.ids)), { ok: true, missing: [], duplicated: [], unknown: [] });
    const estimate = plan.estimates[key('smoke', 'tests/e2e/a.spec.ts', 'new test')];
    assert.equal(estimate, 2000);
    // b.spec.ts in smoke: three's 5 s is the file's mean in that project
    assert.equal(plan.estimates[key('smoke', 'tests/e2e/b.spec.ts', 'also new')], 5000);
});

test('the completeness check names a dropped, a duplicated and an unlisted test', () => {
    const all = ['[smoke] › a › one', '[smoke] › a › two', '[smoke] › a › three'];
    assert.deepEqual(checkPartition(all, [['[smoke] › a › one'], ['[smoke] › a › three']]), {
        ok: false, missing: ['[smoke] › a › two'], duplicated: [], unknown: [],
    });
    assert.deepEqual(checkPartition(all, [['[smoke] › a › one', '[smoke] › a › two'], ['[smoke] › a › two', '[smoke] › a › three', '[smoke] › a › four']]), {
        ok: false, missing: [], duplicated: ['[smoke] › a › two'], unknown: ['[smoke] › a › four'],
    });
});

test('without timings, or with too few of the listed tests timed, it falls back to Playwright\'s --shard', () => {
    const { tests, timings } = timedTests([1000, 1000, 1000, 1000]);
    assert.equal(planShards({ tests, timings: null, shards: 2 }).mode, 'count');
    assert.match(planShards({ tests, timings: null, shards: 2 }).reason, /no timings/);
    assert.match(planShards({ tests, timings: { schema: 2, tests: {} }, shards: 2 }).reason, /schema/);
    const stale = { schema: 1, tests: { [tests[0].key]: 1000 } };
    const plan = planShards({ tests, timings: stale, shards: 2 });
    assert.equal(plan.mode, 'count');
    assert.match(plan.reason, /1 of 4 listed tests timed \(25%\)/);
    assert.equal(planShards({ tests, timings, shards: 1 }).mode, 'count');
});

test('a file that cannot be split by test goes whole to one shard: serial, a title the list cannot name, a title that prefixes another', () => {
    const tests = listedTests(report({
        'tests/e2e/serial.spec.ts': { first: ['smoke'], second: ['smoke'], third: ['smoke'] },
        'tests/e2e/arrow.spec.ts': { 'a › b': ['smoke'], plain: ['smoke'] },
        'tests/e2e/space.spec.ts': { ' padded': ['smoke'], fine: ['smoke'] },
        'tests/e2e/free.spec.ts': { a: ['smoke'], b: ['smoke'], c: ['smoke'], d: ['smoke'] },
    }));
    // a describe titled like a test, beside it
    const prefix = listedTests(report({ 'tests/e2e/same.spec.ts': { open: ['smoke'], other: ['smoke'] } }));
    const nested = listedTests(report({ 'tests/e2e/same.spec.ts': { open: { inner: ['smoke'] } } }));
    const timings = { schema: 1, tests: Object.fromEntries([...tests, ...prefix, ...nested].map((t) => [t.key, 1000])) };
    const plan = planShards({ tests: [...tests, ...prefix, ...nested], timings, shards: 3, serialFiles: new Set(['tests/e2e/serial.spec.ts']) });
    const lines = plan.shards.flatMap((s) => s.lines);
    for (const file of ['serial', 'arrow', 'space', 'same']) {
        assert.ok(lines.includes(`[smoke] › tests/e2e/${file}.spec.ts`), `${file}.spec.ts listed whole`);
        assert.equal(lines.filter((l) => l.includes(`/${file}.spec.ts`)).length, 1, `${file}.spec.ts in one shard`);
    }
    assert.ok(lines.includes('[smoke] › tests/e2e/free.spec.ts › a'), 'a free file is split by test');
    assert.ok(checkPartition([...tests, ...prefix, ...nested].map((t) => t.key), plan.shards.map((s) => s.ids)).ok);
});

test('each shard\'s lines select exactly its tests, read as Playwright reads a --test-list', () => {
    const tests = listedTests(report({
        'tests/e2e/a.spec.ts': { one: ['smoke', 'smoke-webkit'], group: { two: ['smoke'], three: ['smoke'] } },
        'tests/e2e/arrow.spec.ts': { 'x › y': ['smoke'] },
    }));
    const timings = { schema: 1, tests: Object.fromEntries(tests.map((t, i) => [t.key, 1000 * (i + 1)])) };
    const plan = planShards({ tests, timings, shards: 2 });
    for (const shard of plan.shards) {
        const selected = tests.filter((t) => testListMatches(shard.lines, t)).map((t) => t.key).sort();
        assert.deepEqual(selected, [...shard.ids].sort());
    }
});

test('mergeTimings: a browser seen whole replaces its times, a partial one keeps the rest, a failed test keeps its old time', () => {
    const previous = { schema: 1, tests: {
        '[smoke] › a › kept on failure': 1000,
        '[smoke] › a › deleted test': 1000,
        '[smoke] › a › updated': 1000,
        '[smoke-firefox] › a › unseen shard': 4000,
        '[smoke-webkit] › a › other browser': 5000,
    } };
    const shards = [
        { browser: 'chromium', shard: 1, shards: 2, status: 'valid', tests: [
            { project: 'smoke', file: 'a', title: 'kept on failure', outcome: 'failed', attemptMs: [30000, 30000] },
            { project: 'smoke', file: 'a', title: 'updated', outcome: 'flaky', attemptMs: [9000, 2345] },
        ] },
        { browser: 'chromium', shard: 2, shards: 2, status: 'valid', tests: [
            { project: 'examples', file: 'b', title: 'new', outcome: 'passed', attemptMs: [1260] },
            { project: 'examples', file: 'b', title: 'skipped', outcome: 'skipped', attemptMs: [0] },
        ] },
        // firefox: shard 2 of 2 missing
        { browser: 'firefox', shard: 1, shards: 2, status: 'valid', tests: [
            { project: 'smoke-firefox', file: 'a', title: 'seen', outcome: 'passed', attemptMs: [3000] },
        ] },
    ];
    const merged = mergeTimings(shards, previous);
    assert.deepEqual(merged.tests, {
        '[examples] › b › new': 1300,
        '[examples] › b › skipped': 0,
        '[smoke-firefox] › a › seen': 3000,
        '[smoke-firefox] › a › unseen shard': 4000,
        '[smoke-webkit] › a › other browser': 5000,
        '[smoke] › a › kept on failure': 1000,
        '[smoke] › a › updated': 2300,
    });
    assert.deepEqual(Object.keys(merged.tests), Object.keys(merged.tests).sort());
});

// ---- the commands, as CI runs them ----------------------------------------------------------------------------------

function cli(args, { cwd, env = {} } = {}) {
    const dir = cwd ?? mkdtempSync(join(tmpdir(), 'shard-plan-'));
    const output = join(dir, 'github-output');
    const summary = join(dir, 'step-summary.md');
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const run = spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
    });
    return { code: run.status, stdout: run.stdout, stderr: run.stderr, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8'), dir };
}

function workspace() {
    const dir = mkdtempSync(join(tmpdir(), 'shard-plan-'));
    const files = {
        'tests/e2e/a.spec.ts': { slow: ['smoke'], quick: ['smoke'], medium: ['smoke'] },
        'tests/e2e/b.spec.ts': { one: ['smoke'], two: ['smoke'], three: ['smoke'] },
    };
    writeFileSync(join(dir, 'list.json'), JSON.stringify(report(files)));
    mkdirSync(join(dir, 'tests/e2e'), { recursive: true });
    writeFileSync(join(dir, 'tests/e2e/a.spec.ts'), "test('slow', () => {});\n");
    writeFileSync(join(dir, 'tests/e2e/b.spec.ts'), "test.describe.configure({ mode: 'serial' });\n");
    writeFileSync(join(dir, 'timings.json'), JSON.stringify({ schema: 1, tests: {
        [key('smoke', 'tests/e2e/a.spec.ts', 'slow')]: 9000,
        [key('smoke', 'tests/e2e/a.spec.ts', 'quick')]: 1000,
        [key('smoke', 'tests/e2e/a.spec.ts', 'medium')]: 3000,
        [key('smoke', 'tests/e2e/b.spec.ts', 'one')]: 2000,
        [key('smoke', 'tests/e2e/b.spec.ts', 'two')]: 2000,
        [key('smoke', 'tests/e2e/b.spec.ts', 'three')]: 2000,
    } }));
    return { dir, files };
}

test('plan writes each shard\'s test list and plan.json, and gives Playwright its arguments', () => {
    const { dir } = workspace();
    const run = cli(['plan', '--list', 'list.json', '--timings', 'timings.json', '--shard', '2', '--shards', '2', '--out', 'plan'], { cwd: dir });
    assert.equal(run.code, 0, run.stderr);
    const plan = JSON.parse(readFileSync(join(dir, 'plan/plan.json'), 'utf8'));
    assert.equal(plan.mode, 'timings');
    assert.deepEqual(plan.shards.map((s) => s.predictedMs), [10000, 9000]);
    // b.spec.ts runs serial: whole, in one shard
    const second = readFileSync(join(dir, 'plan/shard-2.txt'), 'utf8');
    assert.match(second, /^\[smoke\] › tests\/e2e\/b\.spec\.ts$/m);
    assert.match(run.output, new RegExp(`^args=--test-list ${join(dir, 'plan/shard-2.txt').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.match(run.output, /^mode=timings$/m);
    assert.match(run.summary, /by recorded test time/);
    assert.match(run.summary, /6 of 6 listed tests timed/);
});

test('plan falls back to --shard=N/M when the timings file is missing, and says why', () => {
    const { dir } = workspace();
    const run = cli(['plan', '--list', 'list.json', '--timings', 'missing.json', '--shard', '1', '--shards', '2', '--out', 'plan'], { cwd: dir });
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.output, /^args=--shard=1\/2$/m);
    assert.match(run.output, /^mode=count$/m);
    assert.match(run.summary, /by test count.*no timings/s);
});

test('plan refuses a list it cannot read: a shard must never run a guess', () => {
    const { dir } = workspace();
    writeFileSync(join(dir, 'broken.json'), '{"suites": ');
    const run = cli(['plan', '--list', 'broken.json', '--timings', 'timings.json', '--shard', '1', '--shards', '2', '--out', 'plan'], { cwd: dir });
    assert.equal(run.code, 1);
    assert.match(run.stderr, /broken\.json/);
    assert.equal(run.output, '');
    // a spec that failed to load: Playwright lists the rest, with the error
    const partial = report({ 'tests/e2e/a.spec.ts': { slow: ['smoke'] } });
    partial.errors = [{ message: 'Error: Cannot find module ./gone\n    at tests/e2e/b.spec.ts:1' }];
    writeFileSync(join(dir, 'partial.json'), JSON.stringify(partial));
    const errors = cli(['plan', '--list', 'partial.json', '--timings', 'timings.json', '--shard', '1', '--shards', '2', '--out', 'plan'], { cwd: dir });
    assert.equal(errors.code, 1);
    assert.match(errors.stderr, /1 error while listing: Error: Cannot find module \.\/gone/);
    writeFileSync(join(dir, 'empty.json'), JSON.stringify(report({})));
    const empty = cli(['plan', '--list', 'empty.json', '--timings', 'timings.json', '--shard', '1', '--shards', '2', '--out', 'plan'], { cwd: dir });
    assert.equal(empty.code, 1);
    assert.match(empty.stderr, /lists no test/);
});

test('verify passes when Playwright lists exactly the shard\'s tests, and fails naming a dropped or an extra one', () => {
    const { dir, files } = workspace();
    cli(['plan', '--list', 'list.json', '--timings', 'timings.json', '--shard', '1', '--shards', '2', '--out', 'plan'], { cwd: dir });
    const plan = JSON.parse(readFileSync(join(dir, 'plan/plan.json'), 'utf8'));
    const mine = new Set(plan.shards[0].ids);
    const only = (keep) => Object.fromEntries(Object.entries(files).map(([file, entries]) => [file, Object.fromEntries(Object.entries(entries).filter(([title]) => keep(key('smoke', file, title))))]));
    writeFileSync(join(dir, 'listed.json'), JSON.stringify(report(only((k) => mine.has(k)))));
    const ok = cli(['verify', '--plan', 'plan/plan.json', '--shard', '1', '--list', 'listed.json'], { cwd: dir });
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /shard 1\/2: Playwright selects exactly the planned 2 tests/);

    const dropped = [...mine][0];
    writeFileSync(join(dir, 'dropped.json'), JSON.stringify(report(only((k) => mine.has(k) && k !== dropped))));
    const missing = cli(['verify', '--plan', 'plan/plan.json', '--shard', '1', '--list', 'dropped.json'], { cwd: dir });
    assert.equal(missing.code, 1);
    assert.ok(missing.stdout.includes(`::error title=Shard plan::shard 1/2: Playwright does not select 1 planned test`), missing.stdout);
    assert.ok(missing.stdout.includes(dropped));

    writeFileSync(join(dir, 'extra.json'), JSON.stringify(report(files)));
    const extra = cli(['verify', '--plan', 'plan/plan.json', '--shard', '1', '--list', 'extra.json'], { cwd: dir });
    assert.equal(extra.code, 1);
    assert.match(extra.stdout, /selects 4 tests the plan gives other shards/);
});

test('timings reads every shard\'s durations.json into the timings file plan reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shard-plan-'));
    const durations = (browser, n, m, tests) => {
        mkdirSync(join(dir, 'shards', `playwright-results-${browser}-${n}`), { recursive: true });
        writeFileSync(join(dir, 'shards', `playwright-results-${browser}-${n}`, 'durations.json'), JSON.stringify({
            schema: 1, status: 'valid', shard: `${browser} ${n}/${m}`, sha: 'abc', runId: '7', runUrl: 'https://github.com/o/r/actions/runs/7', tests,
        }));
    };
    durations('chromium', 1, 2, [{ project: 'smoke', file: 'tests/e2e/a.spec.ts', title: 'slow', outcome: 'passed', attemptMs: [8960] }]);
    durations('chromium', 2, 2, [{ project: 'examples', file: 'tabs/tests/tabs.spec.ts', title: 'switches', outcome: 'passed', attemptMs: [1040] }]);
    const run = cli(['timings', '--shards', 'shards', '--out', 'tests/shard-timings.json'], { cwd: dir });
    assert.equal(run.code, 0, run.stderr);
    const timings = JSON.parse(readFileSync(join(dir, 'tests/shard-timings.json'), 'utf8'));
    assert.equal(timings.schema, 1);
    assert.deepEqual(timings.tests, { '[examples] › tabs/tests/tabs.spec.ts › switches': 1000, '[smoke] › tests/e2e/a.spec.ts › slow': 9000 });
    assert.deepEqual(timings.sources, [{ runUrl: 'https://github.com/o/r/actions/runs/7', sha: 'abc', shards: ['chromium 1/2', 'chromium 2/2'] }]);
    assert.match(run.stdout, /2 tests timed/);

    // and plan reads it back: the recipe spec's generated copy is found by its committed name
    writeFileSync(join(dir, 'list.json'), JSON.stringify(report({
        'tests/e2e/a.spec.ts': { slow: ['smoke'] },
        'tests/e2e/examples/recipes/tabs.tabs.spec.ts': { switches: ['examples'] },
    })));
    const plan = cli(['plan', '--list', 'list.json', '--timings', 'tests/shard-timings.json', '--shard', '1', '--shards', '2', '--out', 'plan'], { cwd: dir });
    assert.equal(plan.code, 0, plan.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plan/plan.json'), 'utf8')).shards.map((s) => s.predictedMs), [9000, 1000]);
});

for (const emptyDirectory of [false, true]) {
    test(`timings carries the previous snapshot into the next artifact when shards are ${emptyDirectory ? 'empty' : 'missing'}`, () => {
        const { dir } = workspace();
        const previous = JSON.parse(readFileSync(join(dir, 'timings.json'), 'utf8'));
        previous.sources = [{ runUrl: 'https://github.com/o/r/actions/runs/7', sha: 'abc', shards: ['chromium 1/2', 'chromium 2/2'] }];
        writeFileSync(join(dir, 'timings.json'), JSON.stringify(previous));
        if (emptyDirectory) mkdirSync(join(dir, 'shards'));

        const run = cli(['timings', '--shards', 'shards', '--previous', 'timings.json', '--out', 'ci-metrics/shard-timings.json'], { cwd: dir });
        assert.equal(run.code, 0, run.stderr);
        const carried = JSON.parse(readFileSync(join(dir, 'ci-metrics/shard-timings.json'), 'utf8'));
        assert.deepEqual(carried, previous, 'the latest green run must retain the rolling times and their provenance');

        // The next browser run can plan from that artifact, without falling back to the committed times.
        const plan = cli(['plan', '--list', 'list.json', '--timings', 'ci-metrics/shard-timings.json', '--shard', '1', '--shards', '2', '--out', 'plan'], { cwd: dir });
        assert.equal(plan.code, 0, plan.stderr);
        assert.match(plan.output, /^mode=timings$/m);
        assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plan/plan.json'), 'utf8')).timingsSources, previous.sources);
    });
}

test('bad usage exits 64', () => {
    assert.equal(cli(['plan', '--list']).code, 64);
    assert.equal(cli(['nonsense']).code, 64);
    assert.equal(cli(['plan', '--list', 'x', '--shard', '3', '--shards', '2', '--out', 'o']).code, 64);
});
