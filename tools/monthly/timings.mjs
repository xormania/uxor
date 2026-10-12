#!/usr/bin/env node
/*
 * The monthly job's timings (docs/TESTING.md, *Monthly job*), report-only (owner decision 6d): reads the Playwright
 * JSON reports of the interaction-count specs run with PW_TIMINGS set and repeated, where each counted step left a
 * `timing` annotation ({ step, durationMs, inpMs, metrics? }, tests/e2e/counts.ts), and gives per step the median, the
 * spread (25th to 75th percentile), min and max over every passed run, the median INP and its spread, and for a
 * step that recorded them (the release checks' timings), the same for each of its `metrics`
 * (tools/ci/release-timings.mjs). A failed run's timings are left out: its step may not have completed. No threshold:
 * they come later, from the measured spread.
 *
 * Usage: node tools/monthly/timings.mjs --out <dir> <results.json>...
 * Writes <dir>/timings.json and <dir>/timings.md (also appended to $GITHUB_STEP_SUMMARY). Exit status 0; 1 when no
 * step was timed (the report cannot be made, never an empty one); 64 on bad usage or an unreadable report.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Every test of a Playwright JSON report, nested suites included. */
function* testsOf(suites = []) {
    for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
            yield* spec.tests ?? [];
        }
        yield* testsOf(suite.suites);
    }
}

/** The timings each passed run recorded: the run's own annotations, or the test's when the runs carry none. */
function* timingsOf(test) {
    const results = test.results ?? [];
    const perResult = results.some((result) => Array.isArray(result.annotations));
    const sources = perResult
        ? results.filter((result) => 'passed' === result.status).map((result) => result.annotations ?? [])
        : results.length && results.every((result) => 'passed' === result.status) ? [test.annotations ?? []] : [];
    for (const annotations of sources) {
        for (const annotation of annotations) {
            if ('timing' === annotation.type && annotation.description) {
                yield JSON.parse(annotation.description);
            }
        }
    }
}

/** The value at fraction `p` of the sorted values, interpolated between the two nearest. */
function quantile(sorted, p) {
    const at = (sorted.length - 1) * p;
    const low = Math.floor(at);
    const value = sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (at - low);

    return Math.round(value * 10) / 10;
}

export function gather(reports) {
    const byStep = new Map();
    for (const report of reports) {
        for (const test of testsOf(report.suites)) {
            for (const { step, durationMs, inpMs, metrics } of timingsOf(test)) {
                const entry = byStep.get(step) ?? byStep.set(step, { durations: [], inps: [], metrics: {} }).get(step);
                entry.durations.push(durationMs);
                if (null !== inpMs && undefined !== inpMs) {
                    entry.inps.push(inpMs);
                }
                for (const [name, value] of Object.entries(metrics ?? {})) {
                    if ('number' === typeof value) {
                        (entry.metrics[name] ??= []).push(value);
                    }
                }
            }
        }
    }
    const steps = {};
    for (const [step, { durations, inps, metrics }] of [...byStep].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const sorted = [...durations].sort((a, b) => a - b);
        const inpSorted = [...inps].sort((a, b) => a - b);
        const p25Ms = quantile(sorted, 0.25);
        const p75Ms = quantile(sorted, 0.75);
        steps[step] = {
            runs: sorted.length,
            medianMs: quantile(sorted, 0.5),
            p25Ms,
            p75Ms,
            spreadMs: Math.round((p75Ms - p25Ms) * 10) / 10,
            minMs: sorted[0],
            maxMs: sorted[sorted.length - 1],
            inpMedianMs: inpSorted.length ? quantile(inpSorted, 0.5) : null,
            // the INP samples' spread (25th to 75th percentile), as the duration's
            inpSpreadMs: inpSorted.length ? Math.round((quantile(inpSorted, 0.75) - quantile(inpSorted, 0.25)) * 10) / 10 : null,
            inpRuns: inpSorted.length,
        };
        // the release checks' extra metrics (tests/e2e/counts.ts, `time`): total blocking time, the renderer's style,
        // layout and script time; only when a run recorded them
        if (Object.keys(metrics).length) {
            steps[step].metrics = Object.fromEntries(
                Object.entries(metrics).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, values]) => {
                    const sortedValues = [...values].sort((a, b) => a - b);
                    const p25 = quantile(sortedValues, 0.25);
                    const p75 = quantile(sortedValues, 0.75);
                    return [name, { runs: sortedValues.length, median: quantile(sortedValues, 0.5), p25, p75, spread: Math.round((p75 - p25) * 10) / 10 }];
                }),
            );
        }
    }

    return { steps };
}

export function markdown({ steps }) {
    const out = [
        '## Timings (report only)',
        '',
        'Each step of the interaction-count specs, repeated in Chromium: from the step\'s action until the update it waits for has landed, Playwright\'s round trips included, and the longest interaction it caused (INP, Event Timing). No threshold yet.',
        '',
        '| Step | Runs | Median | Spread (p25–p75) | Min–max | INP median |',
        '|---|---:|---:|---:|---:|---:|',
    ];
    for (const [step, t] of Object.entries(steps)) {
        out.push(`| ${step} | ${t.runs} | ${t.medianMs} ms | ${t.p25Ms}–${t.p75Ms} ms (${t.spreadMs}) | ${t.minMs}–${t.maxMs} ms | ${null === t.inpMedianMs ? '—' : `${t.inpMedianMs} ms`} |`);
    }

    return `${out.join('\n')}\n`;
}

function main(argv) {
    const outAt = argv.indexOf('--out');
    const out = outAt >= 0 ? argv[outAt + 1] : undefined;
    const files = argv.filter((_, i) => i !== outAt && i !== outAt + 1);
    if (!out || !files.length) {
        console.error('Usage: node tools/monthly/timings.mjs --out <dir> <results.json>...');
        return 64;
    }
    let timings;
    try {
        timings = gather(files.map((file) => JSON.parse(readFileSync(file, 'utf8'))));
    } catch (error) {
        console.error(`timings: unreadable report (${error.message})`);
        return 64;
    }
    if (!Object.keys(timings.steps).length) {
        console.error(`timings: no timing in ${files.join(', ')}: were the specs run with PW_TIMINGS set, and did any pass?`);
        return 1;
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`);
    const text = markdown(timings);
    writeFileSync(join(out, 'timings.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    console.log(text);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
