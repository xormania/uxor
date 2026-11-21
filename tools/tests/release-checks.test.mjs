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
const e2e = (file) => `tests/e2e/${file}`;
const requiredBehavior = {
    dark: ['lab.overlays', 'dropdown', 'lab.popover', 'popover', 'lab.tooltip', 'lab.live-modal', 'lab.live-drawer', 'lab.editor', 'editor', 'lab.markdown-editor', 'markdown-editor'],
    harsh: ['lab.data-table-frame', 'lab.data-table-live', 'lab.editor', 'lab.date-picker', 'date-picker', 'lab.autocomplete', 'chart', 'lab.chart'],
};
const lanes = ['release', 'dark', 'harsh'];

function report(family, lane = 'all') {
    return { suites: lanes.flatMap((part, index) => {
        if (lane !== 'all' && lane !== part) return [];
        const project = projects[family][index];
        const files = part === 'release' ? requiredSpecs : requiredBehavior[part].map((name) => `${name}.spec.ts`);
        return files.map(e2e).map((file) => ({
            file,
            specs: ['first', 'second'].map((title) => ({
                file, title, id: `${project}:${file}:${title}`,
                tests: [{ projectName: project, status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed' }] }],
            })),
        }));
    }) };
}

function fixture(t, family = 'current', overrides = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'release-checks-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const inherited = { ...process.env };
    for (const key of ['GITHUB_ACTIONS', 'GITHUB_OUTPUT', 'RELEASE_SELECTION_SHA256']) delete inherited[key];
    mkdirSync(join(dir, 'node_modules/@playwright/test'), { recursive: true });
    mkdirSync(join(dir, 'tools/ci'), { recursive: true });
    copyFileSync(evidenceScript, join(dir, 'tools/ci/release-evidence.mjs'));
    const scenario = {
        discovery: { config: { projects: fixtures[family].projects.map((name) => ({ name })) }, ...report(family) },
        discoveryStatus: 0, runStatus: 0, results: report(family), ...overrides,
    };
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
    writeFileSync(join(dir, 'node_modules/@playwright/test/cli.js'), `
const fs = require('node:fs');
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync('scenario.json', 'utf8'));
const listing = args.includes('--list');
fs.appendFileSync('calls.jsonl', JSON.stringify({ args, release: process.env.RELEASE_CHECKS, output: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, name: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME, githubOutput: process.env.GITHUB_OUTPUT, selectionExists: fs.existsSync('playwright-results/release-selection.json') }) + '\\n');
if (listing) {
    const selection = args.filter((arg) => arg.startsWith('--project=')).map((arg) => arg.split('=')[1]);
    if (selection.length && Array.isArray(scenario.discovery?.suites)) {
        scenario.discovery.suites = scenario.discovery.suites.filter((suite) => suite.specs?.some((spec) => spec.tests.some((test) => selection.includes(test.projectName))));
    }
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
        run: (mode = 'run', runner = script, lane = 'all', env = {}) => spawnSync(process.execPath, [runner, mode], { cwd: dir, encoding: 'utf8', env: { ...inherited, RELEASE_LANE: lane, PLAYWRIGHT_JSON_OUTPUT_FILE: join(dir, 'wrong.json'), PLAYWRIGHT_JSON_OUTPUT_NAME: 'wrong.json', ...env } }),
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
        assert.equal(calls.length, 3);
        assert.deepEqual(calls[0].args, ['test', '/release\\.[^/]*\\.spec\\.ts$', '--list', '--reporter=json']);
        const filter = new RegExp(calls[0].args[1]);
        assert.ok(filter.test('/tmp/release-checkout/tests/e2e/release.timings.spec.ts'));
        assert.ok(!filter.test('/tmp/release-checkout/tests/e2e/chart.spec.ts'));
        assert.equal(calls[0].release, '1');
        assert.equal(calls[0].output, undefined);
        assert.equal(calls[0].name, undefined);
        assert.equal(calls[0].selectionExists, false);
        assert.deepEqual(calls[1].args.filter((arg) => arg.startsWith('--project=')), projects[family].map((project) => `--project=${project}`));
        assert.ok(calls[1].args.includes('--list'), 'the same project selection is enumerated before execution');
        assert.equal(calls[1].release, '1');
        assert.equal(calls[1].selectionExists, false);
        assert.deepEqual(calls[2].args, ['test', ...projects[family].map((project) => `--project=${project}`), '--workers=1', '--reporter=list,html,json', ...(family === 'legacy' ? ['--grep', '@release'] : [])]);
        assert.equal(calls[2].release, '1');
        assert.equal(calls[2].selectionExists, true);
        assert.equal(calls[2].output, join(fx.dir, 'playwright-results/results.json'));
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
    assert.equal(fx.calls().length, 3);
    assert.deepEqual(fx.selection().projects, projects.current);
    const checked = fx.run('evidence');
    assert.equal(checked.status, 1);
    assert.match(checked.stdout, /No release evidence/);
});

test('missing projects/specs and skipped required specs remain fatal after a successful process', (t) => {
    const missingProject = report('current');
    missingProject.suites = missingProject.suites.filter((suite) => suite.specs[0].tests[0].projectName !== 'release-harsh');
    const missingSpec = report('current');
    missingSpec.suites = missingSpec.suites.filter((suite) => suite.file !== e2e(requiredSpecs[2]));
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

for (const [lane, file] of [['dark', 'lab.live-modal.spec.ts'], ['harsh', 'lab.chart.spec.ts']]) {
    test(`the ${lane} release lane rejects a missing required spec at discovery`, (t) => {
        const project = projects.current[lanes.indexOf(lane)];
        const discovered = report('current');
        discovered.suites = discovered.suites.filter((suite) => suite.file !== e2e(file));
        const fx = fixture(t, 'current', {
            discovery: { config: { projects: fixtures.current.projects.map((name) => ({ name })) }, ...discovered },
            results: report('current', lane),
        });
        const run = fx.run('run', script, lane);
        assert.equal(run.status, 1, run.stdout + run.stderr);
        assert.match(run.stdout + run.stderr, new RegExp(`${file.replaceAll('.', '\\.')}`), `the missing ${project} spec is named`);
        assert.ok(fx.calls().every(({ args }) => args.includes('--list')), 'browser tests do not start with narrowed discovery');
    });

    for (const change of ['omitted', 'skipped', 'unrecorded']) {
        test(`the ${lane} release lane rejects ${change} discovered tests`, (t) => {
            const results = report('current', lane);
            const target = results.suites.find((suite) => suite.file === e2e(file));
            if (change === 'omitted') target.specs.pop();
            if (change === 'skipped') Object.assign(target.specs[1].tests[0], { status: 'skipped', results: [{ status: 'skipped' }] });
            if (change === 'unrecorded') target.specs[1].tests[0].results = [];
            const fx = fixture(t, 'current', { results });
            const run = fx.run('run', script, lane);
            assert.equal(run.status, 0, `${change}: ${run.stdout}${run.stderr}`);
            const proof = fx.run('evidence', script, lane);
            assert.equal(proof.status, 1, `${change}: ${proof.stdout}${proof.stderr}`);
            assert.match(proof.stdout + proof.stderr, new RegExp(file.replaceAll('.', '\\.')), change);
        });
    }
}

test('a release case marked expected-to-fail cannot satisfy the behavior verdict', (t) => {
    const results = report('current', 'dark');
    const file = e2e('lab.overlays.spec.ts');
    const result = results.suites.find((suite) => suite.file === file).specs[0].tests[0];
    Object.assign(result, { expectedStatus: 'failed', status: 'expected', results: [{ status: 'failed' }] });
    const fx = fixture(t, 'current', { results });
    assert.equal(fx.run('run', script, 'dark').status, 0, 'Playwright considers the declared expected failure green');
    const evidence = fx.run('evidence', script, 'dark');
    assert.equal(evidence.status, 1, evidence.stdout + evidence.stderr);
    assert.match(evidence.stdout + evidence.stderr, /lab\.overlays\.spec\.ts/);
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
        missingProject.suites = missingProject.suites.filter((suite) => suite.specs[0].tests[0].projectName !== projects[family][2]);
        const missingSpec = report(family);
        missingSpec.suites = missingSpec.suites.filter((suite) => suite.file !== e2e(requiredSpecs[2]));
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

test('hosted evidence rejects a saved selection narrowed after the launcher recorded it', (t) => {
    const fx = fixture(t, 'current', { results: report('current', 'dark') });
    const output = join(fx.dir, 'github-output');
    const run = fx.run('run', script, 'dark', { GITHUB_OUTPUT: output });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const sha = readFileSync(output, 'utf8').match(/^selection-sha256=([0-9a-f]{64})$/m)?.[1];
    assert.ok(sha, 'the control launcher recorded the discovery digest');
    assert.ok(fx.calls().every((call) => !call.githubOutput), 'target Playwright receives no step output path');
    const env = { GITHUB_ACTIONS: 'true', RELEASE_SELECTION_SHA256: sha };
    assert.equal(fx.run('evidence', script, 'dark', env).status, 0);
    assert.equal(fx.run('evidence', script, 'dark', { GITHUB_ACTIONS: 'true' }).status, 1, 'hosted evidence requires a discovery digest');

    const current = fx.selection();
    current.tests = current.tests.slice(1); // every required spec remains represented
    const results = report('current', 'dark');
    results.suites[0].specs.shift();
    writeFileSync(join(fx.dir, 'playwright-results/release-selection.json'), JSON.stringify(current));
    writeFileSync(join(fx.dir, 'playwright-results/results.json'), JSON.stringify(results));
    const checked = fx.run('evidence', script, 'dark', env);
    assert.equal(checked.status, 1);
    assert.match(checked.stdout + checked.stderr, /selection.*(digest|differ|changed|match)/i);
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
            const results = report(family, lane);
            const fx = fixture(t, family, { results });
            const run = fx.run('run', script, lane);
            assert.equal(run.status, 0, run.stdout + run.stderr);
            const args = fx.calls().at(-1).args;
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
