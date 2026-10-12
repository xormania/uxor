#!/usr/bin/env node
/*
 * The monthly job's trends (docs/TESTING.md, *Monthly job*): gathers this run's numbers from the reports into one
 * monthly.json, kept as the run's `monthly-trends` artifact, and compares them with the previous successful run's
 * monthly.json, which the workflow downloads when there is one. A report that is missing (its job failed) is shown as
 * such, never as 0; so is one last month's monthly.json did not have yet.
 *
 * Usage: node tools/monthly/trends.mjs --out <dir> [--php php-coverage.json] [--infection infection-summary.json]
 *            [--js js-coverage.json] [--timings timings.json] [--screenshots screenshots.json]
 *            [--previous monthly.json] [--previous-note <why there is none>]
 *            [--ref <ref>] [--commit <sha>] [--run <url>]
 * Writes <dir>/monthly.json and <dir>/trends.md (also appended to $GITHUB_STEP_SUMMARY). Exit status 0, or 64 on bad
 * usage or an unreadable input.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (file) => (file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

/** The numbers kept from each report. */
export function collect({ php, infection, js, timings, screenshots }, meta) {
    return {
        version: 1,
        ...meta,
        php: php && {
            lines: php.totals.lines,
            methods: php.totals.methods,
            files: Object.fromEntries(Object.entries(php.files).map(([file, value]) => [file, value.lines.pct])),
            neverRun: Object.fromEntries(Object.entries(php.files).filter(([, v]) => v.neverRun.length).map(([file, v]) => [file, v.neverRun])),
        },
        infection: infection && { ...infection.stats, byFile: infection.byFile },
        js: js && {
            lines: js.totals.lines,
            methods: js.totals.methods,
            controllers: Object.fromEntries(Object.entries(js.controllers).map(([file, value]) => [file, value.lines.pct])),
            neverRun: Object.fromEntries(Object.entries(js.controllers).filter(([, v]) => v.neverRun.length).map(([file, v]) => [file, v.neverRun])),
        },
        timings: timings ? timings.steps : null,
        screenshots: screenshots ?? null,
    };
}

const differing = (browser) => (m) => {
    const tests = m.screenshots?.[browser];
    return tests ? Object.values(tests).filter((t) => 'differs' === t.status).length : undefined;
};
const screenshotTotal = (browser) => (m) => `/${Object.keys(m.screenshots[browser]).length}`;

const metrics = [
    ['PHP lines', (m) => m.php?.lines.pct, '%'],
    ['PHP methods run', (m) => m.php?.methods.run, (m) => `/${m.php.methods.total}`],
    ['Infection MSI', (m) => m.infection?.msi, '%'],
    ['Infection covered code MSI', (m) => m.infection?.coveredMsi, '%'],
    ['Surviving mutants (escaped + not covered)', (m) => (m.infection ? m.infection.escaped + m.infection.notCovered : undefined), (m) => ` of ${m.infection.total}`],
    ['JS controller lines', (m) => m.js?.lines.pct, '%'],
    ['JS controller methods run', (m) => m.js?.methods.run, (m) => `/${m.js.methods.total}`],
    ['Firefox screenshots differing from the Chromium baselines', differing('firefox'), screenshotTotal('firefox')],
    ['WebKit screenshots differing from the Chromium baselines', differing('webkit'), screenshotTotal('webkit')],
];

/** Screenshot tests by change since last time, per engine. */
function screenshotChanges(now = {}, before = {}) {
    const newly = [];
    const fixed = [];
    const changed = [];
    for (const [browser, tests] of Object.entries(now)) {
        for (const [key, t] of Object.entries(tests)) {
            const was = before[browser]?.[key];
            if (!was) {
                continue;
            }
            const ratio = (r) => (null === r ? '?' : r);
            if ('differs' === t.status && 'matches' === was.status) {
                newly.push(`${browser} \`${key}\`${null === t.ratio ? '' : ` (ratio ${t.ratio})`}`);
            } else if ('matches' === t.status && 'differs' === was.status) {
                fixed.push(`${browser} \`${key}\``);
            } else if ('differs' === t.status && 'differs' === was.status && t.ratio !== was.ratio) {
                changed.push(`${browser} \`${key}\` ${ratio(was.ratio)} → ${ratio(t.ratio)}`);
            }
        }
    }

    return { newly, fixed, changed };
}

/** The timings table: each step's median and INP next to last time's. */
function timingsTable(now, before) {
    if (!now) {
        return ['', '**Timings:** not reported.'];
    }
    const ms = (value) => (null === value || undefined === value ? '—' : `${value} ms`);
    const out = ['', '**Timings** (median of the runs, report only):', '', '| Step | Median | Previous | Change | INP median | Previous INP |', '|---|---:|---:|---:|---:|---:|'];
    for (const [step, t] of Object.entries(now)) {
        const was = before?.[step];
        out.push(`| ${step} | ${ms(t.medianMs)} | ${ms(was?.medianMs)} | ${change(t.medianMs, was?.medianMs)} | ${ms(t.inpMedianMs)} | ${ms(was?.inpMedianMs)} |`);
    }

    return out;
}

const format = (value, suffix, m) => (undefined === value || null === value ? 'not reported' : `${value}${'function' === typeof suffix ? suffix(m) : suffix}`);
const change = (now, before) => {
    if (undefined === now || null === now || undefined === before || null === before) {
        return '';
    }
    const delta = Math.round((now - before) * 10) / 10;

    return 0 === delta ? '=' : delta > 0 ? `+${delta}` : `${delta}`;
};

/** Entries of a { key: number } map whose value changed. */
const moved = (now = {}, before = {}) =>
    Object.keys({ ...before, ...now })
        .sort()
        .filter((key) => now[key] !== before[key])
        .map((key) => `\`${key}\` ${before[key] ?? 'new'} → ${now[key] ?? 'gone'}`);

/** Methods never run now that ran (or did not exist) before. */
const newlyNeverRun = (now = {}, before = {}) =>
    Object.entries(now).flatMap(([file, names]) => names.filter((name) => !(before[file] ?? []).includes(name)).map((name) => `\`${file}\` \`${name}\``));

export function markdown(current, previous, note) {
    const short = (m) => `${m.date?.slice(0, 10) ?? '?'}, \`${m.commit?.slice(0, 7) ?? '?'}\``;
    const out = ['## Trends', ''];
    out.push(`This run: ${short(current)} on \`${current.ref}\`.`);
    out.push(previous ? `Previous successful monthly run: ${short(previous)}${previous.run ? ` ([run](${previous.run}))` : ''}.` : `**No previous run** to compare with${note ? `: ${note}` : ''}.`);
    out.push('', '| Metric | This run | Previous | Change |', '|---|---:|---:|---:|');
    for (const [label, pick, suffix] of metrics) {
        const now = pick(current);
        const before = previous ? pick(previous) : undefined;
        out.push(`| ${label} | ${format(now, suffix, current)} | ${previous ? format(before, suffix, previous) : '—'} | ${change(now, before)} |`);
    }
    if (previous) {
        const sections = [
            ['PHP files whose line coverage changed (%)', moved(current.php?.files, previous.php?.files)],
            ['Files whose surviving mutants changed (count)', moved(current.infection?.byFile, previous.infection?.byFile)],
            ['Controllers whose line coverage changed (%)', moved(current.js?.controllers, previous.js?.controllers)],
            ['Controller methods never run that ran, or were not there, last time', current.js && previous.js ? newlyNeverRun(current.js.neverRun, previous.js.neverRun) : []],
            ['PHP methods no test runs that were run, or not there, last time', current.php && previous.php ? newlyNeverRun(current.php.neverRun, previous.php.neverRun) : []],
        ];
        const shots = screenshotChanges(current.screenshots ?? {}, previous.screenshots ?? {});
        sections.push(
            ['Screenshots that differ now and matched last time', shots.newly],
            ['Screenshots that match now and differed last time', shots.fixed],
            ['Screenshots whose difference changed', shots.changed],
        );
        for (const [title, items] of sections) {
            out.push('', `**${title}:** ${items.length ? '' : 'none.'}`);
            out.push(...items.map((item) => `- ${item}`));
        }
    }
    out.push(...timingsTable(current.timings, previous?.timings));

    return `${out.join('\n')}\n`;
}

function main(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
        if (!argv[i].startsWith('--') || undefined === argv[i + 1]) {
            console.error(`trends: bad argument ${argv[i]}`);
            return 64;
        }
        args[argv[i].slice(2)] = argv[i + 1];
    }
    if (!args.out) {
        console.error('Usage: node tools/monthly/trends.mjs --out <dir> [--php …] [--infection …] [--js …] [--previous …]');
        return 64;
    }
    let current;
    let previous;
    try {
        current = collect(
            { php: read(args.php), infection: read(args.infection), js: read(args.js), timings: read(args.timings), screenshots: read(args.screenshots) },
            { ref: args.ref ?? null, commit: args.commit ?? null, run: args.run ?? null, date: new Date().toISOString() },
        );
        previous = read(args.previous);
    } catch (error) {
        console.error(`trends: unreadable input (${error.message})`);
        return 64;
    }
    if (previous && 1 !== previous.version) {
        args['previous-note'] = `the previous run's monthly.json has version ${previous.version}, not 1`;
        previous = null;
    }
    mkdirSync(args.out, { recursive: true });
    writeFileSync(join(args.out, 'monthly.json'), `${JSON.stringify(current, null, 2)}\n`);
    const text = markdown(current, previous, args['previous-note']);
    writeFileSync(join(args.out, 'trends.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    console.log(text);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
