#!/usr/bin/env node
/*
 * The monthly job's cross-browser screenshots (docs/TESTING.md, *Monthly job*), report-only (owner decision 6c, A2):
 * reads the Playwright JSON report of a Firefox or WebKit run with PW_SCREENSHOTS=all, which compares every
 * @screenshot test with the Chromium baselines, and says of each test whether it matches, differs (with the ratio of
 * different pixels Playwright gives, when it gives one) or failed another way. The trends (trends.mjs) compare that
 * with last month's. Tests are keyed by project (without the engine's suffix), file and titles, not by line, so a
 * line added above a test keeps it the same test next month: `examples <file> › <title>`.
 *
 * Usage: node tools/monthly/screenshots.mjs --browser <firefox|webkit> --shard <n>/<total> --out <dir> <results.json>
 *        node tools/monthly/screenshots.mjs --merge --browsers firefox,webkit --out <dir> <screenshots-*.json>...
 * The first writes <dir>/screenshots-<browser>-<n>.json; the second merges the shards into <dir>/screenshots.json
 * ({ <browser>: { <test>: { status, ratio } } }) and <dir>/screenshots.md (also appended to $GITHUB_STEP_SUMMARY),
 * only when every shard of every engine named is there: a missing one makes no report, never partial totals.
 * Exit status 0; 1 when the report holds no test (nothing was compared) or a shard is missing; 64 on bad usage or an
 * unreadable input.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const COMPARISON = /toHaveScreenshot|toMatchSnapshot|Screenshot comparison failed/;
const RATIO = /ratio ([\d.]+) of all image pixels/;

/** Every test of the report with its key: the describe titles above the spec's, nested suites included. */
function* testsOf(suites = [], titles = []) {
    for (const suite of suites) {
        const path = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                const project = (test.projectName ?? '').replace(/-(firefox|webkit)$/, '');
                yield [`${project} ${spec.file} › ${[...path, spec.title].join(' › ')}`, test];
            }
        }
        yield* testsOf(suite.suites, path);
    }
}

export function screenshotResults(report, browser, shard = null) {
    const tests = {};
    for (const [key, test] of testsOf(report.suites)) {
        const last = test.results?.at(-1);
        if (!last) {
            continue;
        }
        const message = (last.errors ?? []).map((error) => error.message ?? '').join('\n');
        if ('passed' === last.status) {
            tests[key] = { status: 'matches', ratio: null };
        } else if (COMPARISON.test(message)) {
            const ratio = message.match(RATIO);
            tests[key] = { status: 'differs', ratio: ratio ? Number(ratio[1]) : null };
        } else {
            tests[key] = { status: 'error', ratio: null };
        }
    }

    return { browser, shard, tests };
}

/** The shards merged per engine; throws, naming it, when an engine has no shard or misses one of its total. */
export function merge(shards, browsers) {
    for (const browser of browsers) {
        const mine = shards.filter((s) => s.browser === browser);
        if (!mine.length) {
            throw new Error(`${browser}: no shard reported`);
        }
        const total = Number(String(mine[0].shard).split('/')[1]);
        for (let n = 1; n <= total; n++) {
            if (!mine.some((s) => s.shard === `${n}/${total}`)) {
                throw new Error(`${browser}: shard ${n}/${total} missing`);
            }
        }
    }
    const merged = {};
    for (const { browser, tests } of shards) {
        merged[browser] = { ...merged[browser], ...tests };
    }
    for (const browser of Object.keys(merged)) {
        merged[browser] = Object.fromEntries(Object.entries(merged[browser]).sort(([a], [b]) => (a < b ? -1 : 1)));
    }

    return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function markdown(merged) {
    const out = ['## Screenshots in Firefox and WebKit (report only)', '', 'Every @screenshot test, compared with the Chromium baselines. A difference is expected (another engine renders); what to watch is what changed since last month (*Trends*).', ''];
    out.push('| Engine | Match | Differ | Other failure |', '|---|---:|---:|---:|');
    for (const [browser, tests] of Object.entries(merged)) {
        const count = (status) => Object.values(tests).filter((t) => t.status === status).length;
        out.push(`| ${browser} | ${count('matches')} | ${count('differs')} | ${count('error')} |`);
    }
    for (const [browser, tests] of Object.entries(merged)) {
        const errors = Object.entries(tests).filter(([, t]) => 'error' === t.status);
        if (errors.length) {
            out.push('', `**${browser}, failed other than by a difference:**`, ...errors.map(([key]) => `- \`${key}\``));
        }
    }

    return `${out.join('\n')}\n`;
}

function main(argv) {
    const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
    const out = value('--out');
    const browser = value('--browser');
    const shard = value('--shard');
    const browsers = value('--browsers')?.split(',');
    const isMerge = argv.includes('--merge');
    const files = argv.filter((arg, i) => !arg.startsWith('--') && !['--out', '--browser', '--shard', '--browsers'].includes(argv[i - 1]));
    if (!out || !files.length || (isMerge ? !browsers : !browser || !/^\d+\/\d+$/.test(shard ?? ''))) {
        console.error('Usage: screenshots.mjs --browser <name> --shard <n>/<total> --out <dir> <results.json> | --merge --browsers <a,b> --out <dir> <screenshots-*.json>...');
        return 64;
    }
    let inputs;
    try {
        inputs = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
        console.error(`screenshots: unreadable input (${error.message})`);
        return 64;
    }
    mkdirSync(out, { recursive: true });
    if (!isMerge) {
        const result = screenshotResults(inputs[0], browser, shard);
        if (!Object.keys(result.tests).length) {
            console.error(`screenshots: no test in ${files[0]}: nothing was compared`);
            return 1;
        }
        writeFileSync(join(out, `screenshots-${browser}-${shard.split('/')[0]}.json`), `${JSON.stringify(result, null, 2)}\n`);
        return 0;
    }
    let merged;
    try {
        merged = merge(inputs, browsers);
    } catch (error) {
        console.error(`screenshots: no report: ${error.message}`);
        return 1;
    }
    writeFileSync(join(out, 'screenshots.json'), `${JSON.stringify(merged, null, 2)}\n`);
    const text = markdown(merged);
    writeFileSync(join(out, 'screenshots.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    console.log(text);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
