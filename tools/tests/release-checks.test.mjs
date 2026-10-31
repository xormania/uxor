import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../ci/release-checks.mjs', import.meta.url));
const evidenceScript = fileURLToPath(new URL('../ci/release-evidence.mjs', import.meta.url));
// Project names from the pinned main/dev configurations: a default-branch control script must support both targets.
const fixtures = Object.fromEntries(['current', 'legacy'].map((family) => [family, JSON.parse(readFileSync(new URL(`./fixtures/release-checks/${family}-projects.json`, import.meta.url), 'utf8'))]));
const projects = { current: ['release', 'release-dark', 'release-harsh'], legacy: ['smoke', 'smoke-dark@release', 'harsh@release'] };
const requiredSpecs = ['release.timings.spec.ts', 'release.long-session.spec.ts', 'release.fuzz.spec.ts'];
const report = (family) => ({ suites: requiredSpecs.map((file, index) => ({ file, specs: [{ file, tests: [{ projectName: projects[family][index], status: 'expected' }] }] })) });

function fixture(t, family = 'current', overrides = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'release-checks-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'node_modules/@playwright/test'), { recursive: true });
    mkdirSync(join(dir, 'tools/ci'), { recursive: true });
    copyFileSync(evidenceScript, join(dir, 'tools/ci/release-evidence.mjs'));
    const scenario = {
        discovery: { config: { projects: fixtures[family].projects.map((name) => ({ name })) }, suites: [] },
        discoveryStatus: 0, runStatus: 0, results: report(family), ...overrides,
    };
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
    writeFileSync(join(dir, 'node_modules/@playwright/test/cli.js'), `
const fs = require('node:fs');
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync('scenario.json', 'utf8'));
const listing = args.includes('--list');
fs.appendFileSync('calls.jsonl', JSON.stringify({ args, release: process.env.RELEASE_CHECKS, output: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, name: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME, selectionExists: fs.existsSync('playwright-results/release-selection.json') }) + '\\n');
if (listing) {
    console.log(scenario.rawDiscovery ?? JSON.stringify(scenario.discovery));
    if (scenario.discoveryStatus) console.error('original discovery error');
    process.exit(scenario.discoveryStatus);
}
if (scenario.results) fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(scenario.results));
if (scenario.runStatus) console.error('original test failure');
process.exit(scenario.runStatus);
`);
    return {
        dir,
        run: (mode = 'run', runner = script, lane = 'all') => spawnSync(process.execPath, [runner, mode], { cwd: dir, encoding: 'utf8', env: { ...process.env, RELEASE_LANE: lane, PLAYWRIGHT_JSON_OUTPUT_FILE: join(dir, 'wrong.json'), PLAYWRIGHT_JSON_OUTPUT_NAME: 'wrong.json' } }),
        calls: () => readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
        selection: () => JSON.parse(readFileSync(join(dir, 'playwright-results/release-selection.json'), 'utf8')),
    };
}

for (const family of ['current', 'legacy']) {
    test(`control runner selects the pinned ${family} checkout contract, then checks the same evidence`, (t) => {
        const fx = fixture(t, family);
        const run = fx.run();
        assert.equal(run.status, 0, run.stdout + run.stderr);
        const calls = fx.calls();
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[0].args, ['test', '/release\\.[^/]*\\.spec\\.ts$', '--list', '--reporter=json']);
        const filter = new RegExp(calls[0].args[1]);
        assert.ok(filter.test('/tmp/release-checkout/tests/e2e/release.timings.spec.ts'));
        assert.ok(!filter.test('/tmp/release-checkout/tests/e2e/chart.spec.ts'));
        assert.equal(calls[0].release, '1');
        assert.equal(calls[0].output, undefined);
        assert.equal(calls[0].name, undefined);
        assert.equal(calls[0].selectionExists, false);
        assert.deepEqual(calls[1].args, ['test', ...projects[family].map((project) => `--project=${project}`), '--workers=1', '--reporter=list,html,json', ...(family === 'legacy' ? ['--grep', '@release'] : [])]);
        assert.equal(calls[1].release, '1');
        assert.equal(calls[1].selectionExists, true);
        assert.equal(calls[1].output, join(fx.dir, 'playwright-results/results.json'));
        assert.deepEqual(fx.selection().projects, projects[family]);
        const checked = fx.run('evidence');
        assert.equal(checked.status, 0, checked.stdout + checked.stderr);
        assert.match(checked.stdout, /Release evidence complete/);
    });
}

test('unknown, partial, mixed, duplicate and malformed project discovery cannot launch tests', (t) => {
    const cases = [
        ['smoke', 'examples'], ['release', 'release-dark'],
        [...fixtures.current.projects, 'harsh@release'], [...fixtures.current.projects, 'release-next'],
        [...fixtures.current.projects, 'release'], ['smoke-dark@release', 'harsh@release'],
    ];
    for (const names of cases) {
        const fx = fixture(t, 'current', { discovery: { config: { projects: names.map((name) => ({ name })) }, suites: [] } });
        assert.equal(fx.run().status, 1);
        assert.equal(fx.calls().length, 1);
        assert.equal(existsSync(join(fx.dir, 'playwright-results/release-selection.json')), false);
    }
    for (const overrides of [{ rawDiscovery: 'not JSON' }, { discovery: {} }, { discovery: { config: { projects: fixtures.current.projects.map((name) => ({ name })) }, suites: [], errors: [{ message: 'collection failed' }] } }]) {
        const fx = fixture(t, 'current', overrides);
        assert.equal(fx.run().status, 1);
        assert.equal(fx.calls().length, 1);
    }
});

test('a discovery error preserves its exit and output and removes stale selection/results', (t) => {
    const fx = fixture(t, 'current', { discoveryStatus: 64 });
    mkdirSync(join(fx.dir, 'playwright-results'));
    writeFileSync(join(fx.dir, 'playwright-results/release-selection.json'), '{}');
    writeFileSync(join(fx.dir, 'playwright-results/results.json'), '{}');
    const run = fx.run();
    assert.equal(run.status, 64);
    assert.match(run.stderr, /original discovery error/);
    assert.equal(fx.calls().length, 1);
    assert.equal(existsSync(join(fx.dir, 'playwright-results/release-selection.json')), false);
    assert.equal(existsSync(join(fx.dir, 'playwright-results/results.json')), false);
    assert.equal(fx.run('evidence').status, 1);
});

test('a test failure preserves its exit with no alternative-family retry, even without a report', (t) => {
    const fx = fixture(t, 'current', { runStatus: 7, results: null });
    const run = fx.run();
    assert.equal(run.status, 7);
    assert.match(run.stderr, /original test failure/);
    assert.equal(fx.calls().length, 2);
    assert.deepEqual(fx.selection().projects, projects.current);
    const checked = fx.run('evidence');
    assert.equal(checked.status, 1);
    assert.match(checked.stdout, /No release evidence/);
});

test('missing projects/specs and skipped required specs remain fatal after a successful process', (t) => {
    const missingProject = report('current');
    missingProject.suites[2].specs[0].tests[0].projectName = 'release';
    const missingSpec = report('current');
    missingSpec.suites[2].file = missingSpec.suites[2].specs[0].file = 'other.spec.ts';
    const skippedSpec = report('current');
    skippedSpec.suites[2].specs[0].tests.push({ projectName: 'release-harsh', status: 'skipped' });
    for (const results of [missingProject, missingSpec, skippedSpec, null]) {
        const fx = fixture(t, 'current', { results });
        assert.equal(fx.run().status, 0);
        const checked = fx.run('evidence');
        assert.equal(checked.status, 1);
        assert.match(checked.stdout, /Incomplete release checks|No release evidence/);
    }
});

test('control evidence rejects incomplete target reports even when the target replaces or deletes its checker', (t) => {
    const control = mkdtempSync(join(tmpdir(), 'release-control-'));
    t.after(() => rmSync(control, { recursive: true, force: true }));
    mkdirSync(join(control, 'tools/ci'), { recursive: true });
    const controlRunner = join(control, 'tools/ci/release-checks.mjs');
    copyFileSync(script, controlRunner);
    copyFileSync(evidenceScript, join(control, 'tools/ci/release-evidence.mjs'));

    for (const family of ['current', 'legacy']) {
        const missingProject = report(family);
        missingProject.suites[2].specs[0].tests[0].projectName = projects[family][0];
        const missingSpec = report(family);
        missingSpec.suites[2].file = missingSpec.suites[2].specs[0].file = 'other.spec.ts';
        const skippedSpec = report(family);
        skippedSpec.suites[2].specs[0].tests[0].status = 'skipped';

        for (const [name, results, targetChecker, expected, message] of [
            ['missing project', missingProject, 'accept', 1, /Incomplete release checks: project/],
            ['missing spec', missingSpec, 'accept', 1, /Incomplete release checks: release\.fuzz\.spec\.ts/],
            ['skipped spec', skippedSpec, 'accept', 1, /Incomplete release checks/],
            ['missing report', null, 'accept', 1, /No release evidence/],
            ['incompatible target checker', report(family), 'reject', 0, /Release evidence complete/],
            ['deleted target checker', report(family), 'deleted', 0, /Release evidence complete/],
        ]) {
            const fx = fixture(t, family, { results });
            const target = join(fx.dir, 'tools/ci/release-evidence.mjs');
            if (targetChecker === 'deleted') {
                rmSync(target);
            } else {
                writeFileSync(target, `import { writeFileSync } from 'node:fs';\nwriteFileSync('target-checker-ran', 'target code executed');\nprocess.exit(${targetChecker === 'accept' ? 0 : 97});\n`);
            }
            const run = fx.run('run', controlRunner);
            assert.equal(run.status, 0, `${family}/${name}: ${run.stdout}${run.stderr}`);
            const checked = fx.run('evidence', controlRunner);
            assert.equal(checked.status, expected, `${family}/${name}: ${checked.stdout}${checked.stderr}`);
            assert.match(checked.stdout, message, `${family}/${name}`);
            assert.equal(existsSync(join(fx.dir, 'target-checker-ran')), false, `${family}/${name}: target checker must never execute`);
        }
    }
});

test('evidence refuses a narrowed, unsupported or malformed saved contract', (t) => {
    const fx = fixture(t);
    assert.equal(fx.run().status, 0);
    const complete = fx.selection();
    for (const saved of [
        { ...complete, projects: ['release'] }, { ...complete, specs: requiredSpecs.slice(0, 2) },
        { ...complete, family: 'future' }, { ...complete, schema: 2 },
        { ...complete, grep: '@release' }, { ...complete, extra: true }, null,
    ]) {
        writeFileSync(join(fx.dir, 'playwright-results/release-selection.json'), JSON.stringify(saved));
        assert.equal(fx.run('evidence').status, 1);
    }
    writeFileSync(join(fx.dir, 'playwright-results/release-selection.json'), 'not JSON');
    assert.equal(fx.run('evidence').status, 1);
});

test('unsupported runner arguments are usage errors without discovery', (t) => {
    const fx = fixture(t);
    assert.equal(fx.run('list').status, 64);
    assert.equal(existsSync(join(fx.dir, 'calls.jsonl')), false);
});

for (const family of ['current', 'legacy']) {
    test(`the three ${family} lanes partition the whole project contract and retain their own evidence`, (t) => {
        const selected = [];
        for (const [index, lane] of ['release', 'dark', 'harsh'].entries()) {
            const project = projects[family][index];
            const files = lane === 'release' ? requiredSpecs : ['behavior.spec.ts'];
            const results = { suites: files.map((file) => ({ file, specs: [{ file, tests: [{ projectName: project, status: 'expected' }] }] })) };
            const fx = fixture(t, family, { results });
            const run = fx.run('run', script, lane);
            assert.equal(run.status, 0, run.stdout + run.stderr);
            const args = fx.calls()[1].args;
            assert.deepEqual(args.filter((arg) => arg.startsWith('--project=')), [`--project=${project}`]);
            assert.ok(args.includes(`--workers=${lane === 'release' ? 1 : 2}`));
            selected.push(...fx.selection().projects);
            assert.equal(fx.run('evidence', script, lane).status, 0);
            assert.equal(fx.run('evidence').status, 1, 'a lane report cannot stand in for the complete suite');
            assert.equal(fx.run('evidence', script, lane === 'dark' ? 'harsh' : 'dark').status, 1, 'a different lane cannot accept this saved selection');
            results.suites = [];
            writeFileSync(join(fx.dir, 'playwright-results/results.json'), JSON.stringify(results));
            assert.equal(fx.run('evidence', script, lane).status, 1, 'an empty lane fails structural evidence');
        }
        assert.deepEqual(selected, projects[family], 'all required projects run once across the matrix');
    });
}

test('an unsupported lane cannot launch a suite or accept another saved contract', (t) => {
    const fx = fixture(t);
    assert.equal(fx.run('run', script, 'typo').status, 1);
    assert.equal(fx.calls().length, 1, 'only discovery ran');
    assert.equal(fx.run().status, 0);
    assert.equal(fx.run('evidence', script, 'typo').status, 1);
});
