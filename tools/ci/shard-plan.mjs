#!/usr/bin/env node
/*
 * CI's browser shards split by recorded test time instead of test count. Playwright's --shard=N/M gives each shard the
 * same number of tests, so the shard holding the slow ones (the axe scans, the value matrix) sets CI's critical path.
 * This plans each browser's split from tests/shard-timings.json: every test Playwright lists for the job's projects,
 * with its recorded time (an untimed one at its file's mean), assigned longest first to the least loaded shard (greedy
 * LPT, ties to the lowest shard, the same plan from the same inputs in every shard job), and gives the shard its own
 * list with Playwright's --test-list. Three commands:
 *
 *   plan     in each browser shard, before the tests: reads the job's test list (`npx playwright test --list
 *            --reporter=json` with the job's projects and filters) and the timings, writes shard-<n>.txt for every
 *            shard and plan.json (the mode, why, the predicted test time per shard, every shard's tests) to --out, and
 *            `args` (`--test-list <file>`, or `--shard=N/M`), `mode` and `list` to $GITHUB_OUTPUT, with a short section
 *            on the job's summary. It checks that the shards together hold every listed test exactly once, and exits
 *            1 when they do not, or when the list cannot be read: a shard never runs a guess. Missing or unreadable
 *            timings, or fewer than half the listed tests timed, fall back to `--shard=N/M` (mode count), the same
 *            fallback in every shard since every shard reads the same inputs.
 *   verify   after plan: reads what Playwright lists with `--test-list shard-<n>.txt` and checks it is exactly the
 *            shard's planned tests (none dropped, none of another shard's), exit 1 otherwise. Each shard checks its own
 *            list, so together they check every shard as Playwright reads it.
 *   timings  refreshes the timings: every shard's durations.json (tools/ci/playwright-summary.mjs), one directory per
 *            shard artifact (playwright-results-<browser>-<shard>), merged over --previous: a browser whose every shard
 *            reported replaces its times, a partial one only updates what it ran; a failed test keeps its old time.
 *            Each test's time is its last attempt (the passing one of a flaky test), to 100 ms. CI result writes it
 *            into the ci-metrics artifact on every run; tests/shard-timings.json is refreshed from there by hand.
 *
 * A test's unit is the test itself (every project is fullyParallel, so Playwright schedules each test on its own),
 * except a whole file goes to one shard, as `[project] › file`, when it cannot be split by test: a file that runs
 * serially (describe.serial, mode 'serial' or 'default'), a title the test list cannot name (one holding '›' or
 * surrounding spaces; the lines always hold '›', so a '>' is no delimiter), or a title that is a prefix of another's in the same file (the list matches title prefixes).
 *
 * Usage: node tools/ci/shard-plan.mjs plan --list <list.json> --shard <n> --shards <m> --out <dir> [--timings <file>]
 *        node tools/ci/shard-plan.mjs verify --plan <plan.json> --shard <n> --list <listed.json>
 *        node tools/ci/shard-plan.mjs timings --shards <dir> --out <file> [--previous <file>]
 * Exit status: 0 done (a fallback to --shard included), 1 a plan or list that would not run every test once, 64 bad usage.
 * Test: node --test tools/tests/*.test.mjs
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 1;
/** Below this share of the listed tests timed, the estimates outweigh the timings: split by count instead. */
export const MIN_COVERAGE = 0.5;
/** Below this, the plan still balances but the summary asks for a refresh. */
const REFRESH_BELOW = 0.9;
const DEFAULT_MS = 1000;
const SERIAL = /\bdescribe\.serial\b|\bmode:\s*['"](?:serial|default)['"]/;

// ---- the plan -------------------------------------------------------------------------------------------------------

/*
 * tools/prepare-tests.mjs copies each <recipe>/tests/<name>.spec.ts to tests/e2e/examples/recipes/<recipe>.<name>.spec.ts;
 * durations.json names the committed file (tools/ci/playwright-summary.mjs, committed()), so the timings do too.
 */
function committed(file) {
    const generated = /^tests\/e2e\/examples\/recipes\/([a-z0-9-]+)\.(.+\.spec\.ts)$/.exec(file ?? '');
    return generated ? `${generated[1]}/tests/${generated[2]}` : file;
}

export function testKey(project, file, title) {
    return `[${project}] › ${committed(file)} › ${title}`;
}

/**
 * Every test of a Playwright JSON report (`--list --reporter=json`): its project, the file Playwright loads (relative
 * to the config's rootDir, as --test-list reads it), its title path, its test-list line and its timings key.
 */
export function listedTests(report) {
    if (!report || !Array.isArray(report.suites)) {
        throw new Error('not a Playwright JSON report (no suites)');
    }
    const tests = [];
    const walk = (suite, titles) => {
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                const project = test.projectName ?? test.projectId ?? '';
                const titlePath = [...titles, spec.title];
                tests.push({
                    project,
                    file: spec.file,
                    titlePath,
                    line: `[${project}] › ${spec.file} › ${titlePath.join(' › ')}`,
                    key: testKey(project, spec.file, titlePath.join(' › ')),
                });
            }
        }
        for (const child of suite.suites ?? []) {
            // an anonymous describe is no part of a title (Playwright's titlePath() leaves it out)
            walk(child, child.title ? [...titles, child.title] : titles);
        }
    };
    // a top-level suite is the file itself: its title is not part of a test's name
    for (const file of report.suites) {
        walk(file, []);
    }
    return tests;
}

/** Whether Playwright's --test-list can name this test by its title path (it splits on '›' and trims each part). */
function nameable(titlePath) {
    return titlePath.every((title) => title !== '' && !title.includes('›') && title === title.trim());
}

/**
 * The shards for one job's test list. tests: listedTests(); timings: the parsed timings file (or null); serialFiles:
 * the files (as listed) that run serially. Returns mode 'timings' with every shard's lines, ids and predicted time, or
 * mode 'count' with the reason.
 */
export function planShards({ tests, timings, shards, serialFiles = new Set(), minCoverage = MIN_COVERAGE }) {
    const base = { tests: tests.length, shards };
    if (shards < 2) {
        return { ...base, mode: 'count', reason: 'one shard: nothing to balance', timed: 0, coverage: null };
    }
    if (!timings) {
        return { ...base, mode: 'count', reason: 'no timings', timed: 0, coverage: null };
    }
    if (timings.schema !== SCHEMA || !timings.tests || typeof timings.tests !== 'object') {
        return { ...base, mode: 'count', reason: `timings of an unknown schema (${timings.schema}, expected ${SCHEMA})`, timed: 0, coverage: null };
    }
    const recorded = (test) => {
        const ms = timings.tests[test.key];
        return Number.isFinite(ms) && ms >= 0 ? ms : null;
    };
    const timed = tests.filter((test) => recorded(test) !== null).length;
    const coverage = tests.length ? timed / tests.length : 0;
    const share = `${timed} of ${tests.length} listed tests timed (${Math.floor(coverage * 100)}%)`;
    if (coverage < minCoverage) {
        return { ...base, mode: 'count', reason: `${share}, below ${Math.round(minCoverage * 100)}%: the timings are stale`, timed, coverage };
    }

    // an untimed test: its file's mean in its project, else its project's, else the run's
    const means = new Map();
    const add = (key, ms) => {
        const m = means.get(key) ?? { sum: 0, n: 0 };
        m.sum += ms;
        m.n += 1;
        means.set(key, m);
    };
    for (const test of tests) {
        const ms = recorded(test);
        if (ms === null) continue;
        add(`${test.project}\u0000${test.file}`, ms);
        add(test.project, ms);
        add('', ms);
    }
    const mean = (key) => (means.has(key) ? Math.round(means.get(key).sum / means.get(key).n) : null);
    const estimates = {};
    for (const test of tests) {
        estimates[test.key] = recorded(test) ?? mean(`${test.project}\u0000${test.file}`) ?? mean(test.project) ?? mean('') ?? DEFAULT_MS;
    }

    // the units: a test, or a whole file (per project) that cannot be split by test
    const byFile = new Map();
    for (const test of tests) {
        const id = `${test.project}\u0000${test.file}`;
        if (!byFile.has(id)) byFile.set(id, []);
        byFile.get(id).push(test);
    }
    const units = [];
    for (const [, group] of byFile) {
        const { project, file } = group[0];
        if (serialFiles.has(file) || !splittable(group)) {
            units.push({ id: `[${project}] › ${file}`, lines: [`[${project}] › ${file}`], tests: group, ms: group.reduce((s, t) => s + estimates[t.key], 0) });
        } else {
            for (const test of group) {
                units.push({ id: test.line, lines: [test.line], tests: [test], ms: estimates[test.key] });
            }
        }
    }
    units.sort((a, b) => b.ms - a.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const out = Array.from({ length: shards }, (_, i) => ({ shard: i + 1, predictedMs: 0, lines: [], ids: [] }));
    for (const unit of units) {
        const target = out.reduce((min, s) => (s.predictedMs < min.predictedMs ? s : min));
        target.predictedMs += unit.ms;
        target.lines.push(...unit.lines);
        target.ids.push(...unit.tests.map((t) => t.key));
    }
    for (const shard of out) {
        shard.lines.sort();
        shard.ids.sort();
        shard.tests = shard.ids.length;
    }
    return { ...base, mode: 'timings', reason: share, timed, coverage, shards: out, estimates };
}

/** A file's tests can each be named on their own: nameable titles, unique, none a prefix of another's. */
function splittable(group) {
    if (!group.every((test) => nameable(test.titlePath))) {
        return false;
    }
    const paths = group.map((test) => test.titlePath.join('\u0000'));
    if (new Set(paths).size !== paths.length) {
        return false;
    }
    const sorted = [...paths].sort();
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startsWith(`${sorted[i - 1]}\u0000`)) {
            return false;
        }
    }
    return true;
}

/** Every listed test in exactly one shard: the dropped, duplicated and unlisted ones otherwise. */
export function checkPartition(all, shardIds) {
    const listed = new Set(all);
    const seen = new Map();
    for (const ids of shardIds) {
        for (const id of ids) {
            seen.set(id, (seen.get(id) ?? 0) + 1);
        }
    }
    const missing = all.filter((id) => !seen.has(id));
    const duplicated = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    const unknown = [...seen.keys()].filter((id) => !listed.has(id));
    return { ok: !missing.length && !duplicated.length && !unknown.length, missing, duplicated, unknown };
}

/**
 * Whether a --test-list's lines select this test, read as Playwright 1.58 reads them (loadTestList: split on '›',
 * trim, an optional [project], the file without its :line, then a title-path prefix). Its cases check the lines
 * plan writes; in CI, verify checks them against Playwright itself.
 */
export function testListMatches(lines, test) {
    return lines.some((line) => {
        const tokens = line.split(line.includes('›') ? '›' : '>').map((token) => token.trim());
        let project;
        if (tokens[0].startsWith('[')) {
            project = tokens.shift().slice(1, -1);
        }
        const file = tokens.shift().replace(/(:\d+)?(:\d+)?$/, '');
        if ((project !== undefined && project !== test.project) || file !== test.file) {
            return false;
        }
        return tokens.length <= test.titlePath.length && tokens.every((title, i) => title === test.titlePath[i]);
    });
}

// ---- the timings ----------------------------------------------------------------------------------------------------

/**
 * The timings from every shard's durations.json, over the previous ones. shards: [{ browser, shard, shards, status,
 * tests: [{ project, file, title, outcome, attemptMs }] }].
 */
export function mergeTimings(shards, previous = null) {
    const tests = { ...(previous?.schema === SCHEMA ? previous.tests : {}) };
    for (const browser of [...new Set(shards.map((s) => s.browser))].sort()) {
        const mine = shards.filter((s) => s.browser === browser);
        const total = Math.max(...mine.map((s) => s.shards ?? 0));
        const reported = new Set(mine.filter((s) => s.status === 'valid').map((s) => s.shard));
        const whole = total > 0 && Array.from({ length: total }, (_, i) => i + 1).every((n) => reported.has(n));
        const ran = mine.filter((s) => s.status === 'valid').flatMap((s) => s.tests ?? []);
        if (whole) {
            // every shard reported: a test it no longer lists is gone, but a failed test keeps its old time
            const projects = new Set(ran.map((t) => t.project));
            const failed = new Set(ran.filter((t) => t.outcome === 'failed').map((t) => testKey(t.project, t.file, t.title)));
            for (const key of Object.keys(tests)) {
                const project = /^\[([^\]]*)\]/.exec(key)?.[1];
                if (projects.has(project) && !failed.has(key)) {
                    delete tests[key];
                }
            }
        }
        for (const test of ran) {
            if (test.outcome === 'failed') continue;
            const last = [...(test.attemptMs ?? [])].reverse().find((ms) => Number.isFinite(ms) && ms >= 0);
            if (last === undefined) continue;
            tests[testKey(test.project, test.file, test.title)] = Math.round(last / 100) * 100;
        }
    }
    const sorted = Object.fromEntries(Object.keys(tests).sort().map((key) => [key, tests[key]]));
    return { schema: SCHEMA, tests: sorted };
}

function readShardResults(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const durations = json(join(dir, entry.name, 'durations.json'));
        if (!durations) continue;
        // the shard as durations.json names it ("chromium 2/4"), else as the artifact does (playwright-results-chromium-2)
        const id = /^(\S+) (\d+)\/(\d+)$/.exec(durations.shard ?? '') ?? /^playwright-results-(.+)-(\d+)$/.exec(entry.name);
        if (!id) continue;
        out.push({
            browser: id[1], shard: Number(id[2]), shards: id[3] ? Number(id[3]) : null, status: durations.status ?? null,
            label: `${id[1]} ${id[2]}/${id[3] ?? '?'}`, sha: durations.sha ?? null, runUrl: durations.runUrl ?? null,
            tests: durations.tests ?? [],
        });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---- the commands ---------------------------------------------------------------------------------------------------

function main(argv) {
    const [command, ...rest] = argv;
    const args = options(rest);
    const usage = () => {
        console.error([
            'Usage: shard-plan.mjs plan --list <list.json> --shard <n> --shards <m> --out <dir> [--timings <file>]',
            '       shard-plan.mjs verify --plan <plan.json> --shard <n> --list <listed.json>',
            '       shard-plan.mjs timings --shards <dir> --out <file> [--previous <file>]',
        ].join('\n'));
        return 64;
    };
    if (!args) return usage();
    if (command === 'plan') {
        const shard = Number(args.shard);
        const shards = Number(args.shards);
        if (!args.list || !args.out || !Number.isInteger(shard) || !Number.isInteger(shards) || shard < 1 || shard > shards) return usage();
        return plan({ ...args, shard, shards });
    }
    if (command === 'verify') {
        const shard = Number(args.shard);
        if (!args.plan || !args.list || !Number.isInteger(shard) || shard < 1) return usage();
        return verify({ ...args, shard });
    }
    if (command === 'timings') {
        if (!args.shards || !args.out) return usage();
        return timings(args);
    }
    return usage();
}

function plan({ list, timings: timingsFile, shard, shards, out }) {
    let tests;
    try {
        const report = JSON.parse(readFileSync(list, 'utf8'));
        tests = listedTests(report);
        // a file that failed to load lists none of its tests: a plan without them would drop them
        if (report.errors?.length) {
            throw new Error(`Playwright reported ${report.errors.length} error${report.errors.length > 1 ? 's' : ''} while listing: ${String(report.errors[0].message ?? report.errors[0]).split('\n')[0]}`);
        }
        if (!tests.length) {
            throw new Error('it lists no test');
        }
    } catch (error) {
        console.error(`shard plan: the test list ${list} cannot be read: ${error.message}`);
        return 1;
    }
    let timings = null;
    let unread = null;
    if (timingsFile) {
        timings = json(timingsFile);
        unread = timings ? null : `${timingsFile} is missing or unreadable`;
    }
    const serialFiles = new Set([...new Set(tests.map((t) => t.file))].filter((file) => {
        try {
            return SERIAL.test(readFileSync(file, 'utf8'));
        } catch {
            return false; // not readable here: Playwright loaded it, and the verify step reads the lists as Playwright does
        }
    }));
    const result = planShards({ tests, timings, shards, serialFiles });
    if (result.mode === 'count' && result.reason === 'no timings' && unread) {
        result.reason = `no timings (${unread})`;
    }
    mkdirSync(out, { recursive: true });
    const outDir = resolve(out);
    const own = join(outDir, `shard-${shard}.txt`);
    const record = {
        schema: SCHEMA,
        mode: result.mode,
        reason: result.reason,
        tests: result.tests,
        timed: result.timed,
        coverage: result.coverage === null ? null : Math.round(result.coverage * 1000) / 1000,
        timingsFile: timingsFile ?? null,
        timingsSources: timings?.sources ?? null,
        shard,
        shardCount: shards,
        shards: [],
    };
    if (result.mode === 'timings') {
        const check = checkPartition(tests.map((t) => t.key), result.shards.map((s) => s.ids));
        if (!check.ok) {
            const say = (what, ids) => (ids.length ? [`${ids.length} ${what}: ${ids.slice(0, 10).join('; ')}`] : []);
            console.log(`::error title=Shard plan::the plan does not hold every listed test once: ${[...say('dropped', check.missing), ...say('duplicated', check.duplicated), ...say('not listed', check.unknown)].join('. ')}`);
            return 1;
        }
        for (const s of result.shards) {
            writeFileSync(join(outDir, `shard-${s.shard}.txt`), [
                `# shard ${s.shard}/${shards}: ${s.tests} tests, ${seconds(s.predictedMs)} of recorded test time (tools/ci/shard-plan.mjs)`,
                ...s.lines, '',
            ].join('\n'));
            record.shards.push({ shard: s.shard, tests: s.tests, predictedMs: s.predictedMs, lines: s.lines.length, ids: s.ids });
        }
    }
    writeFileSync(join(outDir, 'plan.json'), JSON.stringify(record, null, 2) + '\n');
    const args = result.mode === 'timings' ? `--test-list ${own}` : `--shard=${shard}/${shards}`;
    output({ mode: result.mode, args, list: result.mode === 'timings' ? own : '' });
    const markdown = render(record, shard);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    }
    console.log(markdown);
    if (result.mode === 'timings' && result.coverage < REFRESH_BELOW) {
        console.log(`::notice title=Shard plan::${result.reason}: refresh tests/shard-timings.json (docs/TESTING.md, *Shard balance*)`);
    }
    return 0;
}

function render(record, shard) {
    const lines = [`## Shard ${shard}/${record.shardCount}: split ${record.mode === 'timings' ? 'by recorded test time' : 'by test count (--shard)'}`, ''];
    if (record.mode === 'timings') {
        lines.push(`${record.reason}, from ${record.timingsFile}. Each shard's recorded test time (summed over its tests; two workers share it):`, '',
            '| Shard | Tests | Recorded test time |', '|---|---:|---:|');
        for (const s of record.shards) {
            lines.push(`| ${s.shard === shard ? `**${s.shard}/${record.shardCount}**` : `${s.shard}/${record.shardCount}`} | ${s.tests} | ${seconds(s.predictedMs)} |`);
        }
    } else {
        lines.push(`${record.tests} listed tests; ${record.reason}.`);
    }
    lines.push('');
    return lines.join('\n') + '\n';
}

function verify({ plan: planFile, shard, list }) {
    const record = json(planFile);
    if (!record || record.mode !== 'timings' || !record.shards?.[shard - 1]) {
        console.log(`::error title=Shard plan::${planFile} holds no plan for shard ${shard}`);
        return 1;
    }
    let listed;
    try {
        listed = listedTests(JSON.parse(readFileSync(list, 'utf8'))).map((t) => t.key);
    } catch (error) {
        console.log(`::error title=Shard plan::the shard's test list ${list} cannot be read: ${error.message}`);
        return 1;
    }
    const label = `shard ${shard}/${record.shardCount}`;
    const planned = new Set(record.shards[shard - 1].ids);
    const elsewhere = new Set(record.shards.filter((s) => s.shard !== shard).flatMap((s) => s.ids));
    const got = new Set(listed);
    const dropped = [...planned].filter((id) => !got.has(id));
    const others = listed.filter((id) => elsewhere.has(id));
    const unplanned = listed.filter((id) => !planned.has(id) && !elsewhere.has(id));
    const problems = [];
    if (dropped.length) problems.push(`Playwright does not select ${dropped.length} planned test${dropped.length > 1 ? 's' : ''}: ${dropped.slice(0, 10).join('; ')}`);
    if (others.length) problems.push(`Playwright selects ${others.length} tests the plan gives other shards: ${others.slice(0, 10).join('; ')}`);
    if (unplanned.length) problems.push(`Playwright selects ${unplanned.length} tests the plan does not have: ${unplanned.slice(0, 10).join('; ')}`);
    if (listed.length !== got.size) problems.push(`Playwright lists ${listed.length - got.size} tests twice`);
    if (problems.length) {
        for (const problem of problems) {
            console.log(`::error title=Shard plan::${label}: ${problem}`);
        }
        return 1;
    }
    console.log(`${label}: Playwright selects exactly the planned ${planned.size} tests`);
    return 0;
}

function timings({ shards: dir, out, previous: previousFile }) {
    const shards = existsSync(dir) ? readShardResults(dir) : [];
    if (!shards.length) {
        console.log(`No durations.json under ${dir}: the timings are unchanged`);
        return 0;
    }
    const previous = previousFile ? json(previousFile) : null;
    const merged = mergeTimings(shards, previous);
    const sources = new Map();
    for (const s of shards.filter((s) => s.status === 'valid')) {
        const id = `${s.runUrl}\u0000${s.sha}`;
        if (!sources.has(id)) sources.set(id, { runUrl: s.runUrl, sha: s.sha, shards: [] });
        sources.get(id).shards.push(s.label);
    }
    const record = { schema: SCHEMA, about: 'tools/ci/shard-plan.mjs: each test\'s recorded time in ms, to split CI\'s browser shards (docs/TESTING.md, *Shard balance*)', sources: [...sources.values()], tests: merged.tests };
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
    console.log(`Timings: ${Object.keys(merged.tests).length} tests timed, from ${shards.length} shards (${out})`);
    return 0;
}

// ---- helpers --------------------------------------------------------------------------------------------------------

function options(list) {
    const out = {};
    for (let i = 0; i < list.length; i += 2) {
        const [key, value] = [list[i], list[i + 1]];
        if (!key?.startsWith('--') || value === undefined) {
            return null;
        }
        out[key.slice(2)] = value;
    }
    return out;
}

function output(values) {
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
    }
}

function json(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function seconds(ms) {
    return `${(ms / 1000).toFixed(1)} s`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
