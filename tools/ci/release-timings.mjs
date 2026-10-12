#!/usr/bin/env node
/*
 * The release checks' timings (docs/PLAN-test-tiers.md, tier 3; docs/TESTING.md, *Release checks*), report only: reads
 * the Playwright JSON report of a release run, where each timed step left a `timing` annotation (tests/e2e/counts.ts,
 * `time`), gathers per step the median of its runs (tools/monthly/timings.mjs, `gather`) and prints each metric
 * against the baseline (tests/perf/baseline.json): the median now, the baseline's, the change and the baseline's
 * spread. It never fails on a timing: tolerances come later (the plan's step 8).
 *
 * With --record <file>, it also writes the run as a new baseline: per step and metric, the median and the spread of
 * the runs, with the commit, the date and the timing harness (HARNESS); a baseline of another harness is not compared
 * with, the report says to record it again. The baseline changes only through a pull request that shows the old and
 * new numbers (this report, run with --baseline on the old file).
 *
 * Usage: node tools/ci/release-timings.mjs [--baseline tests/perf/baseline.json] [--record <file>] [--min-runs 5] [--commit <sha>]
 *            [--date <ISO date>] [--out <dir>] <results.json>...
 * Writes <dir>/release-timings.md when --out is given; appends the report to $GITHUB_STEP_SUMMARY and prints it.
 * Exit status 0 (whatever the numbers); 1 when no step was timed (no report, never an empty one); 2 when --record
 * refuses a partial run (a step with fewer than --min-runs runs, 5 by default, or a step of the baseline, of any harness,
 * left out), writing no baseline; 64 on bad usage or an unreadable report or baseline.
 * Test: node --test tools/tests/*.test.mjs
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gather } from '../monthly/timings.mjs';

/**
 * The version of the timing harness (tests/e2e/counts.ts, `measure`): a baseline recorded with another one measured
 * something else and is not compared with. 1: the duration ended when the action's update landed; 2: at the frame
 * presented after it. Raise it with any change to what a metric measures.
 */
export const HARNESS = 2;

/** The metrics of a step, by name, each { median, spread, runs }: the duration and INP, then the extra metrics. */
export function metricsOf(step) {
    const out = {
        durationMs: { median: step.medianMs, spread: step.spreadMs, runs: step.runs },
    };
    if (null !== step.inpMedianMs && undefined !== step.inpMedianMs) {
        out.inpMs = { median: step.inpMedianMs, spread: step.inpSpreadMs ?? null, runs: step.inpRuns };
    }
    for (const [name, value] of Object.entries(step.metrics ?? {})) {
        out[name] = { median: value.median, spread: value.spread, runs: value.runs };
    }

    return out;
}

/** A baseline file's content from gathered steps. */
export function baseline({ steps }, { commit, date }) {
    return {
        commit,
        date,
        harness: HARNESS,
        note: 'Medians of the release checks\' timed steps (tools/ci/release-timings.mjs --record). Report only until the tolerances are set (docs/PLAN-test-tiers.md, step 8).',
        steps: Object.fromEntries(Object.entries(steps).map(([name, step]) => [name, metricsOf(step)])),
    };
}

const fmt = (ms) => (null === ms || undefined === ms ? '—' : `${ms} ms`);

/** The change from `before` to `now`, in ms and percent; '—' when either is missing. */
function change(now, before) {
    if (null === now || undefined === now || null === before || undefined === before) {
        return '—';
    }
    const delta = Math.round((now - before) * 10) / 10;
    const sign = delta > 0 ? '+' : '';
    const percent = 0 === before ? '' : ` (${sign}${Math.round((delta / before) * 100)}%)`;

    return `${sign}${delta} ms${percent}`;
}

/** The report: each step's metrics, now against the baseline. */
export function markdown(current, base, { baselineNote = '' } = {}) {
    const out = [
        '## Release checks: timings (report only)',
        '',
        'Per step, the median of its runs in Chromium, against `tests/perf/baseline.json`. Duration: from the step\'s action until the frame presented after the update it waits for (Playwright\'s round trips included); INP: its longest interaction (Event Timing); TBT: long tasks\' time over 50 ms; style, layout, script: Chromium\'s renderer counters over the step. No tolerance yet: nothing here fails the run.',
        '',
    ];
    if (base) {
        out.push(`Baseline: commit \`${String(base.commit ?? '?').slice(0, 12)}\`, ${base.date ?? 'undated'}.`, '');
    } else {
        out.push(`No baseline to compare with${baselineNote ? ` (${baselineNote})` : ''}.`, '');
    }
    out.push('| Step | Metric | Runs | Median | Baseline | Change | Baseline spread (p25–p75) |', '|---|---|---:|---:|---:|---:|---:|');
    for (const [name, step] of Object.entries(current.steps)) {
        const before = base?.steps?.[name] ?? {};
        for (const [metric, now] of Object.entries(metricsOf(step))) {
            const then = before[metric];
            out.push(`| ${name} | ${metric.replace(/Ms$/, '')} | ${now.runs} | ${fmt(now.median)} | ${fmt(then?.median)} | ${change(now.median, then?.median)} | ${fmt(then?.spread)} |`);
        }
    }
    const gone = Object.keys(base?.steps ?? {}).filter((name) => !(name in current.steps));
    if (gone.length) {
        out.push('', `In the baseline, not timed in this run: ${gone.join(', ')}.`);
    }

    return `${out.join('\n')}\n`;
}

function parseArgs(argv) {
    const options = { files: [] };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (['--baseline', '--record', '--commit', '--date', '--out', '--min-runs'].includes(flag)) {
            if (undefined === argv[i + 1]) {
                return null;
            }
            options[flag.slice(2)] = argv[++i];
        } else if (flag.startsWith('--')) {
            return null;
        } else {
            options.files.push(flag);
        }
    }

    if (undefined !== options['min-runs'] && !/^[1-9]\d*$/.test(options['min-runs'])) {
        return null;
    }

    return options.files.length ? options : null;
}

function main(argv) {
    const options = parseArgs(argv);
    if (!options) {
        console.error('Usage: node tools/ci/release-timings.mjs [--baseline <file>] [--record <file>] [--min-runs <n>] [--commit <sha>] [--date <date>] [--out <dir>] <results.json>...');
        return 64;
    }
    let current;
    let base = null;
    // the baseline's step names, whatever harness recorded it: a recording never leaves one out
    let baseSteps = {};
    let baselineNote = '';
    try {
        current = gather(options.files.map((file) => JSON.parse(readFileSync(file, 'utf8'))));
        if (options.baseline && existsSync(options.baseline)) {
            base = JSON.parse(readFileSync(options.baseline, 'utf8'));
            baseSteps = base.steps ?? {};
            const recordedWith = base.harness ?? 1;
            if (HARNESS !== recordedWith) {
                baselineNote = `${options.baseline} was recorded with timing harness ${recordedWith}, this run uses ${HARNESS}: record it again`;
                base = null;
            }
        } else if (options.baseline) {
            baselineNote = `${options.baseline} does not exist`;
        }
    } catch (error) {
        console.error(`release-timings: unreadable report or baseline (${error.message})`);
        return 64;
    }
    if (!Object.keys(current.steps).length) {
        console.error(`release-timings: no timing in ${options.files.join(', ')}: did the timed specs (tests/e2e/release.timings.spec.ts) run and pass?`);
        return 1;
    }
    const text = markdown(current, base, { baselineNote });
    if (options.out) {
        mkdirSync(options.out, { recursive: true });
        writeFileSync(join(options.out, 'release-timings.md'), text);
    }
    if (options.record) {
        // a baseline replaces the whole file: never from a partial run (a step with fewer runs than asked, or one the
        // baseline has and this run did not time, even one of another harness)
        const minRuns = Number(options['min-runs'] ?? 5); // a positive whole number: parseArgs refuses anything else
        const gaps = [
            ...Object.entries(current.steps).filter(([, step]) => metricsOf(step).durationMs.runs < minRuns)
                .map(([name, step]) => `${name}: ${metricsOf(step).durationMs.runs} runs of durationMs, ${minRuns} needed`),
            ...Object.keys(baseSteps).filter((name) => !(name in current.steps)).map((name) => `${name}: in the baseline, not timed in this run`),
        ];
        if (gaps.length) {
            console.error(`release-timings: no baseline recorded, the run is partial:\n${gaps.map((gap) => `- ${gap}`).join('\n')}`);
            if (process.env.GITHUB_STEP_SUMMARY) {
                appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
            }
            console.log(text);
            return 2;
        }
        mkdirSync(dirname(options.record), { recursive: true });
        const recorded = baseline(current, { commit: options.commit ?? null, date: options.date ?? new Date().toISOString().slice(0, 10) });
        writeFileSync(options.record, `${JSON.stringify(recorded, null, 2)}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    console.log(text);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
