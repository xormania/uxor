// The cases of the monthly job's report tools (tools/monthly/*.mjs). The monthly workflow runs them before its reports;
// locally: node --test tools/monthly/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { summarize, markdown as infectionMarkdown } from './infection.mjs';
import { codeLines, controllerName, declaredMethods, ranCharacters, report } from './js-coverage.mjs';
import { parseClover } from './php-coverage.mjs';
import { collect, markdown as trendsMarkdown } from './trends.mjs';
import { gather as gatherTimings, markdown as timingsMarkdown } from './timings.mjs';
import { merge as mergeScreenshots, screenshotResults } from './screenshots.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const run = (script, args) => spawnSync(process.execPath, [join(here, script), ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
const scratch = () => mkdtempSync(join(tmpdir(), 'monthly-'));

test('controllerName strips AssetMapper\'s digest, a digest starting with "-" included', () => {
    assert.equal(controllerName('https://localhost/assets/controllers/tooltip_controller-a_bKK47.js'), 'tooltip_controller');
    assert.equal(controllerName('https://localhost/assets/controllers/calendar_controller--WTY0qc.js'), 'calendar_controller');
    assert.equal(controllerName('https://localhost/assets/vendor/@hotwired/stimulus/stimulus.index-abcdefg.js'), null);
});

test('ranCharacters: an inner range with count 0 overrides the function that ran around it', () => {
    const ran = ranCharacters(10, [
        { functionName: '', ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] },
        { functionName: 'm', ranges: [{ startOffset: 2, endOffset: 8, count: 3 }, { startOffset: 4, endOffset: 6, count: 0 }] },
    ]);
    assert.deepEqual([...ran], [1, 1, 1, 1, 0, 0, 1, 1, 1, 1]);
});

test('codeLines leaves out blank lines, line comments and doc comments, not code with a trailing comment', () => {
    const source = ['/**', ' * Doc.', ' */', '', 'a(); // note', '    // only a comment', '    /* one line */ b();', "c('image/*');", 'd();'].join('\n');
    assert.deepEqual([...codeLines(source).keys()], [4, 6, 7, 8]);
    assert.equal(source.slice(codeLines(source).get(6), codeLines(source).get(6) + 4), 'b();');
});

test('declaredMethods reads the class members at the controllers\' indentation, not control flow', () => {
    const source = 'export default class extends Controller {\n    connect() {\n        if (x) {\n        }\n    }\n    get #canvas() {\n    }\n    async #load(a, b) {\n    }\n    static isFoo() {\n    }\n}\n';
    assert.deepEqual(declaredMethods(source), ['connect', 'get #canvas', '#load', 'isFoo']);
});

test('report merges the tests per controller and lists the methods no test ran; a controller no test loaded lists them all', () => {
    const root = scratch();
    const source = 'export default class {\n    a() {\n        x();\n    }\n    b() {\n        y();\n    }\n}\n';
    for (const recipe of ['one', 'two']) {
        mkdirSync(join(root, recipe, 'assets/controllers'), { recursive: true });
        writeFileSync(join(root, recipe, 'manifest.json'), '{}');
        writeFileSync(join(root, recipe, `assets/controllers/${recipe}_controller.js`), source);
    }
    mkdirSync(join(root, 'demo/assets/controllers'), { recursive: true });
    writeFileSync(join(root, 'demo/assets/controllers/own_controller.js'), source); // no manifest: not the kit's
    const a = source.indexOf('a()');
    const b = source.indexOf('b()');
    const script = (aCount, bCount) => ({
        url: 'https://localhost/assets/controllers/one_controller-abcdefg.js',
        functions: [
            { functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
            { functionName: 'a', ranges: [{ startOffset: a, endOffset: b - 5, count: aCount }] },
            { functionName: 'b', ranges: [{ startOffset: b, endOffset: source.length - 2, count: bCount }] },
            { functionName: 'this.element.addEventListener.once', ranges: [{ startOffset: b + 4, endOffset: b + 8, count: 0 }] },
        ],
    });
    const sha256 = createHash('sha256').update(source).digest('hex');
    const recordings = [
        { test: 't1', scripts: [{ ...script(1, 0), sha256 }] },
        { test: 't2', scripts: [{ ...script(0, 0), sha256 }, { url: 'https://localhost/assets/controllers/own_controller-abcdefg.js', sha256, functions: [] }] },
    ];
    const result = report(root, recordings);
    assert.deepEqual(Object.keys(result.controllers), ['one/assets/controllers/one_controller.js', 'two/assets/controllers/two_controller.js']);
    const one = result.controllers['one/assets/controllers/one_controller.js'];
    assert.equal(one.loaded, true);
    assert.deepEqual(one.methods, { run: 1, total: 2 });
    assert.deepEqual(one.neverRun, ['b']);
    assert.ok(one.lines.covered > 0 && one.lines.covered < one.lines.total);
    const two = result.controllers['two/assets/controllers/two_controller.js'];
    assert.equal(two.loaded, false);
    assert.deepEqual(two.neverRun, ['a', 'b']);
    assert.equal(result.totals.neverRun, 3);

    // a served copy that is not the recipe's file is not mapped onto its lines
    const stale = report(root, [{ test: 't', scripts: [{ ...script(1, 1), sha256: 'other' }] }]);
    assert.equal(stale.controllers['one/assets/controllers/one_controller.js'].loaded, false);
    assert.match(stale.notes[0], /served another copy/);
});

test('js-coverage fails, not reports 0%, when nothing was recorded', () => {
    const empty = scratch();
    const result = run('js-coverage.mjs', ['--out', join(empty, 'out'), empty]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no JS coverage to report: no recorded test/);
});

const clover = (statements, covered) => `<?xml version="1.0"?>
<coverage><project><package name="App">
<file name="/repo/data-table/src/UXor/DataTable/Filter.php">
<class name="App\\UXor\\DataTable\\Filter" namespace="App"><metrics methods="2" coveredmethods="1" statements="${statements}" coveredstatements="${covered}"/></class>
<line num="10" type="method" name="choices" visibility="public" count="3"/>
<line num="11" type="stmt" count="3"/>
<line num="15" type="method" name="label" visibility="public" count="0"/>
<line num="16" type="stmt" count="0"/>
<metrics loc="20" ncloc="18" classes="1" methods="2" coveredmethods="1" statements="${statements}" coveredstatements="${covered}"/>
</file></package></project></coverage>`;

test('parseClover reports each recipe file relative to the repository, with the methods no test runs', () => {
    const result = parseClover(clover(4, 3), '/repo');
    assert.deepEqual(result.files['data-table/src/UXor/DataTable/Filter.php'], {
        classes: ['App\\UXor\\DataTable\\Filter'],
        lines: { covered: 3, total: 4, pct: 75 },
        methods: { run: 1, total: 2 },
        neverRun: ['label'],
    });
    assert.deepEqual(result.totals.lines, { covered: 3, total: 4, pct: 75 });
});

test('php-coverage fails clearly without a report (no driver) and on a report that measured nothing', () => {
    const dir = scratch();
    const missing = run('php-coverage.mjs', ['--out', dir, join(dir, 'clover.xml')]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /no coverage driver \(pcov\) loaded/);
    writeFileSync(join(dir, 'empty.xml'), clover(0, 0));
    const empty = run('php-coverage.mjs', ['--out', dir, join(dir, 'empty.xml')]);
    assert.equal(empty.status, 3);
    assert.match(empty.stderr, /measured no line/);
});

const infectionLog = {
    stats: { totalMutantsCount: 3, killedCount: 1, notCoveredCount: 1, escapedCount: 1, errorCount: 0, syntaxErrorCount: 0, skippedCount: 0, ignoredCount: 0, timeOutCount: 0, msi: 33.3, mutationCodeCoverage: 66.6, coveredCodeMsi: 50 },
    escaped: [{ mutator: { mutatorName: 'CastString', originalFilePath: '/repo/data-table/src/A.php', originalStartLine: 12 }, diff: '-(string) $id\n+$id' }],
    uncovered: [{ mutator: { mutatorName: 'Coalesce', originalFilePath: '/repo/editor/src/B.php', originalStartLine: 3 }, diff: '-a ?? b\n+b ?? a' }],
};

test('Infection\'s log: the counts and every survivor, escaped and not covered, with its place', () => {
    const result = summarize(infectionLog, '/repo');
    assert.equal(result.stats.msi, 33.3);
    assert.deepEqual(result.survivors.map((m) => `${m.file}:${m.line} ${m.mutator} ${m.status}`), ['data-table/src/A.php:12 CastString escaped', 'editor/src/B.php:3 Coalesce not covered']);
    assert.match(infectionMarkdown(result, 1), /the first 1 of 2; all in survivors\.md/);
});

test('infection fails clearly without a log, with an invalid one and with no mutant', () => {
    const dir = scratch();
    assert.equal(run('infection.mjs', ['--out', dir, join(dir, 'infection.json')]).status, 2);
    writeFileSync(join(dir, 'bad.json'), '{');
    assert.equal(run('infection.mjs', ['--out', dir, join(dir, 'bad.json')]).status, 3);
    writeFileSync(join(dir, 'none.json'), JSON.stringify({ stats: { ...infectionLog.stats, totalMutantsCount: 0 } }));
    const none = run('infection.mjs', ['--out', dir, join(dir, 'none.json')]);
    assert.equal(none.status, 3);
    assert.match(none.stderr, /holds no mutant/);
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(infectionLog));
    assert.equal(run('infection.mjs', ['--out', dir, join(dir, 'ok.json')]).status, 0);
});

const php = { totals: { lines: { covered: 3, total: 4, pct: 75 }, methods: { run: 1, total: 2 } }, files: { 'a.php': { lines: { pct: 75 }, neverRun: ['label'] } } };
const js = (pct, neverRun) => ({ totals: { lines: { covered: 1, total: 2, pct }, methods: { run: 1, total: 2 } }, controllers: { 'x/assets/controllers/x_controller.js': { lines: { pct }, neverRun } } });

test('trends: the first run says there is no previous run, and a missing report is "not reported", not 0', () => {
    const current = collect({ php, infection: null, js: js(50, ['b']) }, { ref: 'dev', commit: 'abcdef1234', date: '2026-11-03T04:37:00Z' });
    const text = trendsMarkdown(current, null, 'no earlier successful run of this workflow');
    assert.match(text, /\*\*No previous run\*\* to compare with: no earlier successful run of this workflow/);
    assert.match(text, /\| Infection MSI \| not reported \| — \|/);
    assert.match(text, /\| PHP lines \| 75% \| — \|/);
});

test('trends: the change since the previous run, and the methods that newly never run', () => {
    const previous = collect({ php, infection: { stats: { msi: 70, coveredMsi: 70, escaped: 5, notCovered: 0, total: 20 }, byFile: { 'a.php': 5 } }, js: js(60, []) }, { ref: 'dev', commit: '1111111', date: '2026-10-03T04:37:00Z' });
    const current = collect({ php, infection: { stats: { msi: 75.5, coveredMsi: 75.5, escaped: 4, notCovered: 0, total: 20 }, byFile: { 'a.php': 4 } }, js: js(50, ['b']) }, { ref: 'dev', commit: '2222222', date: '2026-11-03T04:37:00Z' });
    const text = trendsMarkdown(current, previous);
    assert.match(text, /\| Infection MSI \| 75\.5% \| 70% \| \+5\.5 \|/);
    assert.match(text, /\| JS controller lines \| 50% \| 60% \| -10 \|/);
    assert.match(text, /- `x\/assets\/controllers\/x_controller\.js` `b`/);
    assert.match(text, /- `a\.php` 5 → 4/);
});

test('trends.mjs writes monthly.json, the artifact the next run compares with', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'php.json'), JSON.stringify(php));
    const result = run('trends.mjs', ['--out', dir, '--php', join(dir, 'php.json'), '--ref', 'dev', '--commit', 'abc', '--previous-note', 'none yet']);
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(readFileSync(join(dir, 'monthly.json'), 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.php.lines.pct, 75);
    assert.equal(saved.js, null);
});

// A Playwright JSON report holding the given tests: [project, file, line, title, results, annotations?]
const pwReport = (tests) => ({
    config: { version: '1.58.2', projects: [] },
    suites: [{
        title: 'f', file: 'f', specs: tests.map(([project, file, line, title, results, annotations = []]) => ({
            title, file, line, ok: true, tests: [{ projectName: project, status: 'expected', annotations, results }],
        })),
    }],
});
const timing = (step, durationMs, inpMs) => ({ type: 'timing', description: JSON.stringify({ step, durationMs, inpMs }) });

test('timings: per step, the median, the spread (p25–p75), min and max over every passed run, and the median INP', () => {
    const runs = [12, 10, 30, 11, 13].map((ms, i) => ['smoke', 'tests/e2e/counts.spec.ts', 35, 'dropdown', [{ status: 'passed', annotations: [timing('dropdown open', ms, i < 4 ? 40 + i : null), timing('dropdown close', 5, null)] }]]);
    // a failed run's timings are left out: the step may not have completed
    runs.push(['smoke', 'tests/e2e/counts.spec.ts', 35, 'dropdown', [{ status: 'failed', annotations: [timing('dropdown open', 999, 999)] }]]);
    const { steps } = gatherTimings([pwReport(runs)]);
    assert.deepEqual(steps['dropdown open'], { runs: 5, medianMs: 12, p25Ms: 11, p75Ms: 13, spreadMs: 2, minMs: 10, maxMs: 30, inpMedianMs: 41.5, inpSpreadMs: 1.5, inpRuns: 4 });
    assert.equal(steps['dropdown close'].inpMedianMs, null, 'no interaction recorded: null, not 0');
    const text = timingsMarkdown({ steps });
    assert.match(text, /\| dropdown open \| 5 \| 12 ms \| 11–13 ms \(2\) \| 10–30 ms \| 41\.5 ms \|/);
    assert.match(text, /\| dropdown close \| 5 \| 5 ms \| 5–5 ms \(0\) \| 5–5 ms \| — \|/);
});

test('timings: a test-level annotation is read when the results carry none (older reports)', () => {
    const { steps } = gatherTimings([pwReport([['smoke', 'c.spec.ts', 1, 't', [{ status: 'passed' }], [timing('editor typing', 20, 8)]]])]);
    assert.equal(steps['editor typing'].medianMs, 20);
});

test('timings.mjs fails, not reports nothing, when no step was timed', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'results.json'), JSON.stringify(pwReport([['smoke', 'c.spec.ts', 1, 't', [{ status: 'passed', annotations: [] }]]])));
    const result = run('timings.mjs', ['--out', dir, join(dir, 'results.json')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no timing/);
    const ok = scratch();
    writeFileSync(join(ok, 'results.json'), JSON.stringify(pwReport([['smoke', 'c.spec.ts', 1, 't', [{ status: 'passed', annotations: [timing('modal open', 7, null)] }]]])));
    const written = run('timings.mjs', ['--out', ok, join(ok, 'results.json')]);
    assert.equal(written.status, 0, written.stderr);
    assert.equal(JSON.parse(readFileSync(join(ok, 'timings.json'), 'utf8')).steps['modal open'].runs, 1);
});

test('screenshots: each test matches, differs (with the ratio Playwright gives) or errs, keyed apart from the engine and the line', () => {
    const differs = { status: 'failed', errors: [{ message: 'Error: expect(page).toHaveScreenshot(expected) failed\n\n  1203 pixels (ratio 0.01 of all image pixels) are different.' }] };
    const size = { status: 'failed', errors: [{ message: 'Error: expect(page).toHaveScreenshot(expected) failed\n\n  Expected an image 800px by 600px, received 800px by 610px.' }] };
    const other = { status: 'timedOut', errors: [{ message: 'Test timeout of 30000ms exceeded.' }] };
    const result = screenshotResults(pwReport([
        ['examples-firefox', 'alert/tests/alert.spec.ts', 8, 'default', [{ status: 'passed', errors: [] }]],
        ['examples-firefox', 'badge/tests/badge.spec.ts', 5, 'pill', [differs]],
        ['examples-firefox', 'card/tests/card.spec.ts', 3, 'image', [size]],
        ['smoke-firefox', 'tests/e2e/forms.spec.ts', 40, 'parity', [{ status: 'failed', errors: [] }, other]],
    ]), 'firefox', '2/3');
    // a line added above a test does not make it another test next month: the key is the project, file and titles
    assert.deepEqual(result, {
        browser: 'firefox',
        shard: '2/3',
        tests: {
            'examples alert/tests/alert.spec.ts › default': { status: 'matches', ratio: null },
            'examples badge/tests/badge.spec.ts › pill': { status: 'differs', ratio: 0.01 },
            'examples card/tests/card.spec.ts › image': { status: 'differs', ratio: null },
            'smoke tests/e2e/forms.spec.ts › parity': { status: 'error', ratio: null },
        },
    });
});

test('screenshots: the shards merge per engine, only when every shard of every engine is there', () => {
    const shard = (browser, n, tests) => ({ browser, shard: `${n}/2`, tests });
    const a = shard('webkit', 1, { 'examples a › x': { status: 'matches', ratio: null } });
    const b = shard('webkit', 2, { 'examples b › y': { status: 'differs', ratio: 0.2 } });
    const c = shard('firefox', 1, { 'examples a › x': { status: 'differs', ratio: 0.05 } });
    const d = shard('firefox', 2, {});
    assert.deepEqual(mergeScreenshots([a, b, c, d], ['firefox', 'webkit']), {
        firefox: { 'examples a › x': { status: 'differs', ratio: 0.05 } },
        webkit: { 'examples a › x': { status: 'matches', ratio: null }, 'examples b › y': { status: 'differs', ratio: 0.2 } },
    });
    // a shard that made no report: no partial totals, the merge refuses and names what is missing
    assert.throws(() => mergeScreenshots([a, b, c], ['firefox', 'webkit']), /firefox: shard 2\/2 missing/);
    assert.throws(() => mergeScreenshots([a, b], ['firefox', 'webkit']), /firefox: no shard/);
});

test('screenshots.mjs --merge fails without writing a report when a shard is missing', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ browser: 'webkit', shard: '1/2', tests: {} }));
    const result = run('screenshots.mjs', ['--merge', '--browsers', 'webkit', '--out', dir, join(dir, 'a.json')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /webkit: shard 2\/2 missing/);
    assert.throws(() => readFileSync(join(dir, 'screenshots.json')));
});

test('trends: timings and screenshots next to last month\'s, report only', () => {
    const steps = (open, inp) => ({ 'modal open': { runs: 5, medianMs: open, p25Ms: open, p75Ms: open, spreadMs: 0, minMs: open, maxMs: open, inpMedianMs: inp, inpRuns: 5 } });
    const shots = (pill, card) => ({
        firefox: { 'examples badge:5 › pill': pill, 'examples card:3 › image': card, 'examples alert:8 › default': { status: 'matches', ratio: null } },
    });
    const previous = collect({ timings: { steps: steps(10, 40) }, screenshots: shots({ status: 'matches', ratio: null }, { status: 'differs', ratio: 0.02 }) }, { ref: 'dev', commit: '1111111' });
    const current = collect({ timings: { steps: steps(14, 38) }, screenshots: shots({ status: 'differs', ratio: 0.01 }, { status: 'differs', ratio: 0.05 }) }, { ref: 'dev', commit: '2222222' });
    const text = trendsMarkdown(current, previous);
    assert.match(text, /\| Firefox screenshots differing from the Chromium baselines \| 2\/3 \| 1\/3 \| \+1 \|/);
    assert.match(text, /\| WebKit screenshots differing from the Chromium baselines \| not reported \| not reported \| +\|/);
    assert.match(text, /\| modal open \| 14 ms \| 10 ms \| \+4 \| 38 ms \| 40 ms \|/);
    assert.match(text, /\*\*Screenshots that differ now and matched last time:\*\* \n- firefox `examples badge:5 › pill` \(ratio 0\.01\)/);
    assert.match(text, /\*\*Screenshots whose difference changed:\*\* \n- firefox `examples card:3 › image` 0\.02 → 0\.05/);
    // last month's monthly.json, written before these sections existed, still compares: not reported, not a crash
    const old = collect({ php }, { ref: 'dev', commit: '0000000' });
    delete old.timings;
    delete old.screenshots;
    assert.match(trendsMarkdown(current, old), /\| modal open \| 14 ms \| — \| +\|/);
});
