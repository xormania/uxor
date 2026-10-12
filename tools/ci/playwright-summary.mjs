#!/usr/bin/env node
/*
 * Reads one shard's Playwright JSON report (playwright-results/results.json) and says what it holds: the counts
 * (passed, failed, flaky = passed on retry, skipped), each failed and flaky test with the first lines of its error,
 * the tested commit, shard, projects and runtime versions. It never decides pass or fail: Playwright's exit status
 * does. It writes:
 *   - the summary, in Markdown, to $GITHUB_STEP_SUMMARY (the job's summary page) and to summary.md next to the report
 *     (printed last in the job log; printed here when $GITHUB_STEP_SUMMARY is not set);
 *   - an ::error annotation per failed test and a ::warning per flaky one, at the line that failed;
 *   - failed-attempts.json next to the report: every failed attempt, retry-recovered ones included (test id, file,
 *     title, project, shard, retry, status, error, duration), for a later step that reads each one;
 *   - durations.json next to the report, and a Durations section in the summary: the run's wall time, the summed time
 *     of every attempt, the workers, the 10 slowest tests and each file's total, so runs can be compared. Report-only:
 *     no threshold, and a report it cannot time is still read (the durations say why they are missing);
 *   - status, passed, failed, flaky and skipped to $GITHUB_OUTPUT.
 *
 * Usage: node tools/ci/playwright-summary.mjs [playwright-results/results.json]
 * Environment (all optional): SHARD ("2/3", when the report cannot say), BROWSER (the engine, named with the shard:
 * "firefox 2/3"), RESULTS_ARTIFACT and REPORT_ARTIFACT (the names of the artifacts the workflow uploads this
 * directory and the HTML report as, quoted where the summary points at them), SETUP_STEPS and RUNTIME (lines of
 * "<name>=<value>": the outcome of each step before the tests, the versions the job found), TESTS_OUTCOME (the
 * Playwright step's outcome), GITHUB_SHA, GITHUB_REF_NAME, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID,
 * GITHUB_RUN_ATTEMPT.
 * Exit status: 0 the report was read (whatever its tests did), 2 no report (tests not reached or report not
 * written), 3 the report does not parse or is not a Playwright report, 4 tests not reached (a setup step failed or
 * the Playwright step did not run), 1 this script failed.
 * Test: node --test tools/tests/*.test.mjs
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const EXIT = { valid: 0, missing: 2, invalid: 3, notReached: 4 };
const ERROR_LINES = 6;
const SLOWEST = 10;
const env = process.env;

const reportPath = resolve(process.argv[2] ?? 'playwright-results/results.json');
const outDir = dirname(reportPath);
const shownPath = relative(process.cwd(), reportPath) || reportPath;

const run = {
    sha: env.GITHUB_SHA ?? null,
    ref: env.GITHUB_REF_NAME ?? null,
    runUrl: env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
        ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : null,
};
const runtime = { Node: process.version, ...pairs(env.RUNTIME) };

const verdict = read();
if (verdict.status !== 'valid') {
    finish(verdict.status, verdict.reason, label(env.SHARD ?? null), null);
} else {
    finish('valid', null, verdict.shard, verdict);
}

/** The shard as the summaries name it: with the engine when BROWSER says it ("firefox 2/3"). */
function label(shard) {
    return shard && env.BROWSER ? `${env.BROWSER} ${shard}` : shard;
}

/** Where a file of this directory is kept: the artifact the workflow names, or the directory itself. */
function keptIn(file) {
    return env.RESULTS_ARTIFACT ? `\`${file}\` in the \`${env.RESULTS_ARTIFACT}\` artifact` : `\`${file}\` next to the report (\`${basename(outDir)}/\`)`;
}

/** What there is to read: the steps before the tests, then the report itself. */
function read() {
    const setup = Object.entries(pairs(env.SETUP_STEPS));
    const failedStep = setup.find(([, outcome]) => outcome === 'failure');
    if (failedStep) {
        return { status: 'not-reached', reason: `tests not reached: setup failed at ${failedStep[0]}` };
    }
    if (env.TESTS_OUTCOME === 'skipped') {
        return { status: 'not-reached', reason: 'tests not reached: the Playwright step did not run (an earlier step failed or was skipped)' };
    }
    if (!existsSync(reportPath)) {
        return { status: 'missing', reason: `no test evidence: tests not reached or report not written (${shownPath} is missing)` };
    }
    let report;
    try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
        return { status: 'invalid', reason: `report invalid: ${shownPath} does not parse (${error.message})` };
    }
    if (!report || typeof report !== 'object' || !Array.isArray(report.suites) || !report.config || typeof report.config !== 'object') {
        return { status: 'invalid', reason: `report invalid: ${shownPath} is not a Playwright JSON report (no config or suites)` };
    }
    return { status: 'valid', ...collect(report) };
}

/** Every test of the report with its outcome and failed attempts. */
function collect(report) {
    const root = report.config.rootDir ?? process.cwd();
    const shardInfo = report.config.shard;
    const shard = label(shardInfo ? `${shardInfo.current}/${shardInfo.total}` : (env.SHARD ?? null));
    const tests = [];
    const walk = (suite, titles) => {
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                tests.push(describe(spec, test, [...titles, spec.title], root, shard));
            }
        }
        for (const child of suite.suites ?? []) {
            walk(child, [...titles, child.title]);
        }
    };
    // A top-level suite is the file itself: its title is not part of a test's name
    for (const file of report.suites) {
        walk(file, []);
    }
    const count = (outcome) => tests.filter((test) => test.outcome === outcome).length;
    const projects = [...new Set(tests.map((test) => test.project))];
    return {
        shard,
        tests,
        counts: { passed: count('passed'), failed: count('failed'), flaky: count('flaky'), skipped: count('skipped') },
        projects: projects.length ? projects : (report.config.projects ?? []).map((project) => project.name),
        playwright: report.config.version ?? null,
        durationMs: report.stats?.duration ?? null,
        workers: { configured: report.config.workers ?? null, actual: report.config.metadata?.actualWorkers ?? null },
        globalErrors: (report.errors ?? []).map((error) => clean(error.message ?? error.value ?? String(error))),
    };
}

function describe(spec, test, titlePath, root, shard) {
    const at = committed(spec.file, spec.line);
    const results = test.results ?? [];
    const outcome = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' }[test.status]
        ?? (results.every((result) => result.status === 'skipped') ? 'skipped' : 'failed');
    const failed = results.filter((result) => result.status !== (test.expectedStatus ?? 'passed') && result.status !== 'skipped');
    const project = test.projectName || test.projectId || '';
    const title = titlePath.join(' › ');
    return {
        project,
        title,
        file: at.file,
        line: at.line,
        outcome,
        attempts: results.length,
        attemptMs: results.map((result) => result.duration),
        passedOnRetry: outcome === 'flaky' ? results.findLast((result) => result.status === 'passed')?.retry ?? null : null,
        failedAttempts: failed.map((result) => {
            const location = result.errorLocation ?? result.errors?.find((error) => error.location)?.location;
            return {
                testId: `${spec.id}@${project}`,
                specId: spec.id,
                project,
                file: at.file,
                line: at.line,
                title,
                titlePath,
                shard,
                retry: result.retry ?? 0,
                status: result.status,
                outcome,
                durationMs: result.duration ?? null,
                startTime: result.startTime ?? null,
                workerIndex: result.workerIndex ?? null,
                error: clean(result.error?.message ?? result.errors?.map((error) => error.message).join('\n\n') ?? ''),
                errorLocation: location ? inRepository(location, root) : null,
            };
        }),
    };
}

/** A location inside the repository, relative to it; one in a generated recipe spec points at the committed file. */
function inRepository(location, root) {
    const file = isAbsolute(location.file) ? relative(root, location.file) : location.file;
    if (file.startsWith('..') || isAbsolute(file)) {
        return null;
    }
    return { ...committed(file, location.line), column: location.column ?? null };
}

/*
 * tools/prepare-tests.mjs copies each <recipe>/tests/<name>.spec.ts to tests/e2e/examples/recipes/<recipe>.<name>.spec.ts,
 * with one header line added (gitignored): name the committed file and its line.
 */
function committed(file, line) {
    const generated = /^tests\/e2e\/examples\/recipes\/([a-z0-9-]+)\.(.+\.spec\.ts)$/.exec(file ?? '');
    return generated ? { file: `${generated[1]}/tests/${generated[2]}`, line: Math.max(1, (line ?? 1) - 1) } : { file, line: line ?? null };
}

function finish(status, reason, shard, data) {
    const timing = durations(data);
    let markdown = data ? summary(data) : `## Playwright${shard ? `, shard ${shard}` : ''}: ${headlineOf(status)}\n\n${reason}\n\n${context(shard, [])}`;
    if (data) {
        markdown += durationsSection(timing);
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'summary.md'), markdown);
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
    } else {
        console.log(markdown);
    }

    const tests = data?.tests.filter((test) => test.outcome === 'failed' || test.outcome === 'flaky') ?? [];
    writeFileSync(join(outDir, 'failed-attempts.json'), JSON.stringify({
        schema: 1,
        status,
        reason,
        ...run,
        shard,
        projects: data?.projects ?? [],
        runtime: { ...runtime, ...(data?.playwright ? { Playwright: data.playwright } : {}) },
        counts: data?.counts ?? null,
        tests: tests.map(({ failedAttempts, ...test }) => test),
        attempts: tests.flatMap((test) => test.failedAttempts),
        globalErrors: data?.globalErrors ?? [],
    }, null, 2) + '\n');
    writeFileSync(join(outDir, 'durations.json'), JSON.stringify({
        schema: 1,
        status,
        ...run,
        shard,
        projects: data?.projects ?? [],
        runtime: { ...runtime, ...(data?.playwright ? { Playwright: data.playwright } : {}) },
        ...timing,
    }, null, 2) + '\n');

    if (data) {
        for (const test of tests) {
            annotate(test);
        }
        for (const error of data.globalErrors) {
            console.log(`::error title=${property(`Playwright${shard ? ` shard ${shard}` : ''}: error outside tests`)}::${message(firstLines(error))}`);
        }
    } else {
        console.log(`::error title=${property(`Playwright${shard ? ` shard ${shard}` : ''}`)}::${message(reason)}`);
    }
    if (env.GITHUB_STEP_SUMMARY) {
        console.log(markdown.split('\n')[0].replace(/^## /, ''));
    }

    const outputs = data ? { status, ...data.counts } : { status };
    if (env.GITHUB_OUTPUT) {
        appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
    }
    process.exitCode = { valid: EXIT.valid, missing: EXIT.missing, invalid: EXIT.invalid, 'not-reached': EXIT.notReached }[status];
}

/*
 * What the run's time went to, report-only: never a verdict, no threshold. The wall time is Playwright's own (the run,
 * start to end); the summed time adds every attempt, retries included, so with several workers it exceeds the wall
 * time and the two are not compared. A test's time is the sum of its attempts. Times Playwright did not record count
 * as unknown, never as 0: a test or file holding one shows its time as a lower bound (≥), with the count in
 * durations.json; a report it cannot time leaves the durations null with the reason, the summary still written.
 */
function durations(data) {
    const empty = { wallMs: null, summedTestMs: null, attempts: 0, untimedAttempts: 0, workers: null, slowest: [], files: [], tests: [] };
    if (!data) {
        return { ...empty, unavailable: 'no report' };
    }
    try {
        const ms = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
        const tests = data.tests.map((test) => {
            const attempts = test.attemptMs.map(ms);
            const timed = attempts.filter((value) => value !== null);
            return {
                project: test.project, file: test.file, line: test.line, title: test.title, outcome: test.outcome,
                durationMs: timed.length ? timed.reduce((sum, value) => sum + value, 0) : null,
                untimedAttempts: attempts.length - timed.length,
                attemptMs: attempts,
            };
        });
        const all = tests.flatMap((test) => test.attemptMs);
        const files = new Map();
        for (const test of tests) {
            const file = files.get(test.file) ?? { file: test.file, tests: 0, durationMs: 0, untimedAttempts: 0 };
            file.tests += 1;
            file.durationMs += test.durationMs ?? 0;
            file.untimedAttempts += test.untimedAttempts;
            files.set(test.file, file);
        }
        const byTime = (a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1);
        return {
            wallMs: ms(data.durationMs),
            summedTestMs: all.reduce((sum, value) => sum + (value ?? 0), 0),
            attempts: all.length,
            untimedAttempts: all.filter((value) => value === null).length,
            workers: data.workers,
            slowest: tests.filter((test) => test.durationMs !== null).sort(byTime).slice(0, SLOWEST),
            files: [...files.values()].sort(byTime),
            tests,
        };
    } catch (error) {
        return { ...empty, unavailable: `durations not read: ${error.message}` };
    }
}

function durationsSection(timing) {
    const lines = ['', '## Durations (report only)', ''];
    if (timing.unavailable) {
        lines.push(timing.unavailable, '');
        return lines.join('\n');
    }
    const workers = timing.workers?.actual ?? timing.workers?.configured;
    lines.push(
        `- Wall time: ${seconds(timing.wallMs)}${workers != null ? `, ${workers} worker${workers === 1 ? '' : 's'}` : ''}`,
        `- Summed test time: ${seconds(timing.summedTestMs)} over ${timing.attempts} attempt${timing.attempts === 1 ? '' : 's'}${timing.untimedAttempts ? ` (${timing.untimedAttempts} without a time)` : ''}; workers run tests side by side, so it is not the wall time`,
        '',
    );
    if (timing.slowest.length) {
        lines.push(`### Slowest ${timing.slowest.length} tests`, '', '| Time | Attempts | Test |', '|---:|---:|---|');
        for (const test of timing.slowest) {
            lines.push(`| ${atLeast(test)} | ${test.attemptMs.length} | [${cell(test.project)}] ${cell(`${test.file}:${test.line} › ${test.title}`)} |`);
        }
        lines.push('');
    }
    if (timing.files.length) {
        lines.push('### Per file', '', '| Time | Tests | File |', '|---:|---:|---|');
        for (const file of timing.files) {
            lines.push(`| ${atLeast(file)} | ${file.tests} | ${cell(file.file ?? 'unknown')} |`);
        }
        lines.push('');
    }
    lines.push(`The same numbers, each test included: ${keptIn('durations.json')}.`, '');
    return lines.join('\n');
}

/** A test's or a file's time: a lower bound (≥), never a total, when an attempt in it has no time */
function atLeast({ durationMs, untimedAttempts }) {
    return `${untimedAttempts ? '≥ ' : ''}${seconds(durationMs)}`;
}

/** Text for a Markdown table cell: a backslash of its own first, so it can't escape the \| that follows */
function cell(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function headlineOf(status) {
    return { missing: 'no test evidence', invalid: 'report invalid', 'not-reached': 'tests not reached' }[status];
}

function summary(data) {
    const { counts } = data;
    const total = counts.passed + counts.failed + counts.flaky + counts.skipped;
    const parts = [];
    if (total === 0) {
        parts.push('no tests ran');
    } else if (counts.failed + counts.flaky + counts.skipped === 0) {
        parts.push(`all ${counts.passed} passed`);
    } else {
        if (counts.failed) parts.push(`${counts.failed} failed`);
        if (counts.flaky) parts.push(`${counts.flaky} flaky (passed on retry)`);
        parts.push(`${counts.passed} passed`);
        if (counts.skipped) parts.push(`${counts.skipped} skipped`);
    }
    if (data.globalErrors.length) {
        parts.unshift(`${data.globalErrors.length} error${data.globalErrors.length > 1 ? 's' : ''} outside tests`);
    }
    const lines = [
        `## Playwright${data.shard ? `, shard ${data.shard}` : ''}: ${parts.join(', ')}`,
        '',
        '| Passed | Failed | Flaky (passed on retry) | Skipped |',
        '|---:|---:|---:|---:|',
        `| ${counts.passed} | ${counts.failed} | ${counts.flaky} | ${counts.skipped} |`,
        '',
        context(data.shard, data.projects, data),
    ];
    if (data.globalErrors.length) {
        lines.push(`## Errors outside tests (${data.globalErrors.length})`, '');
        for (const error of data.globalErrors) {
            lines.push(fence(firstLines(error)), '');
        }
    }
    const section = (outcome, heading) => {
        const tests = data.tests.filter((test) => test.outcome === outcome);
        if (!tests.length) return;
        lines.push(`## ${heading} (${tests.length})`, '');
        for (const test of tests) {
            const note = outcome === 'flaky'
                ? `failed ${test.failedAttempts.length} of ${test.attempts} attempts, passed on retry ${test.passedOnRetry}`
                : `${test.attempts} attempt${test.attempts > 1 ? 's' : ''}, all failed`;
            lines.push(`- **[${test.project}] ${test.file}:${test.line} › ${test.title}** (${note})`, '');
            let previous = null;
            for (const attempt of test.failedAttempts) {
                const error = firstLines(attempt.error);
                const where = attempt.errorLocation ? ` at ${attempt.errorLocation.file}:${attempt.errorLocation.line}` : '';
                lines.push(`  Attempt ${attempt.retry + 1} (retry ${attempt.retry}), ${attempt.status}${where}, ${seconds(attempt.durationMs)}:${error === previous ? ' the same error' : ''}`, '');
                if (error !== previous) {
                    lines.push(fence(error, '  '), '');
                }
                previous = error;
            }
        }
    };
    section('failed', 'Failed');
    section('flaky', 'Flaky: failed, then passed on retry');
    if (data.tests.some((test) => test.outcome === 'failed' || test.outcome === 'flaky')) {
        const report = env.REPORT_ARTIFACT ? `; traces and the HTML report in \`${env.REPORT_ARTIFACT}\`` : '';
        lines.push(`Every failed attempt, retry-recovered ones included: ${keptIn('failed-attempts.json')}${report}.`, '');
    }
    return lines.join('\n');
}

function context(shard, projects, data) {
    const versions = { ...runtime, ...(data?.playwright ? { Playwright: data.playwright } : {}) };
    const commit = run.sha ? `\`${run.sha}\`${run.ref ? ` (${run.ref})` : ''}` : 'unknown (GITHUB_SHA not set)';
    const lines = [
        `- Tested commit: ${commit}`,
        `- Shard: ${shard ?? 'unknown'}${projects.length ? `; projects: ${projects.join(', ')}` : ''}${data?.durationMs != null ? `; ${seconds(data.durationMs)}` : ''}`,
        `- Runtime: ${Object.entries(versions).map(([name, version]) => `${name} ${version}`).join(', ')}`,
    ];
    if (run.runUrl) {
        lines.push(`- Run: ${run.runUrl}${run.runAttempt ? ` (attempt ${run.runAttempt})` : ''}`);
    }
    return lines.join('\n') + '\n';
}

function annotate(test) {
    const attempt = test.failedAttempts[0];
    const at = attempt?.errorLocation ?? { file: test.file, line: test.line, column: null };
    const kind = test.outcome === 'failed' ? 'error' : 'warning';
    const note = test.outcome === 'failed' ? `failed in ${test.attempts} attempt${test.attempts > 1 ? 's' : ''}` : `flaky - passed on retry ${test.passedOnRetry}`;
    const props = [`file=${property(at.file)}`, `line=${at.line ?? 1}`, ...(at.column ? [`col=${at.column}`] : []), `title=${property(`[${test.project}] ${test.title} (${note})`)}`];
    console.log(`::${kind} ${props.join(',')}::${message(firstLines(attempt?.error ?? ''))}`);
}

/** The first lines of an error, up to Playwright's call log. */
function firstLines(text) {
    const lines = [];
    for (const line of text.split('\n')) {
        if (/^\s*Call log:/.test(line) || lines.length === ERROR_LINES) break;
        if (line.trim() === '' && (lines.length === 0 || lines.at(-1) === '')) continue;
        lines.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
    }
    while (lines.at(-1) === '') lines.pop();
    return lines.join('\n');
}

function clean(text) {
    return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}

function fence(text, indent = '') {
    return ['```', ...text.split('\n'), '```'].map((line) => indent + line).join('\n');
}

function seconds(ms) {
    return ms == null ? 'unknown time' : `${(ms / 1000).toFixed(1)} s`;
}

/** Lines of "<name>=<value>", in order; empty values dropped. */
function pairs(text) {
    const entries = (text ?? '').split('\n').map((line) => {
        const at = line.indexOf('=');
        return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : null;
    });
    return Object.fromEntries(entries.filter((entry) => entry && entry[1] !== ''));
}

// GitHub's workflow command escaping: https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts
function message(text) {
    return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function property(text) {
    return message(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}
