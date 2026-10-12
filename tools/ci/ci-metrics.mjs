#!/usr/bin/env node
/*
 * CI's own numbers, for later optimizations: report only, never a verdict, no threshold. Two commands:
 *
 *   job  in each browser shard, after its tests: what the shard's setup cost and found in its caches, written to
 *        job-metrics.json next to the shard's results (uploaded with them): the Docker build's cached and total steps
 *        (each build record of `docker buildx history ls --format json`, one JSON object per line), whether setup-node
 *        restored the npm cache, and the seconds `npm ci` and the Playwright image's pull took.
 *   run  in CI result, once per run: every shard's durations.json (tools/ci/playwright-summary.mjs) and job-metrics.json,
 *        one directory per shard artifact (playwright-results-<browser>-<shard>), and the run's jobs from GitHub's API
 *        (`gh api .../actions/runs/<id>/attempts/<n>/jobs --jq '.jobs[]'`: JSON lines, an array or the API's object).
 *        It writes ci-metrics.json and ci-metrics.md to --out, and the Markdown to $GITHUB_STEP_SUMMARY (printed
 *        without it): per shard its tests, retries, wall and summed test time, worker use (summed test time over wall
 *        time × workers) and its job's queue, setup, tests and the rest; per browser the shard balance (the wall times'
 *        max, min, mean and spread, the missing shards); the 20 slowest tests and 15 slowest files of the run; every
 *        retried test; each job's queue, duration and steps; the browser jobs' mean time per step and browser.
 *
 * Usage: node tools/ci/ci-metrics.mjs job --out <job-metrics.json> [--buildx <history.jsonl>]
 *        node tools/ci/ci-metrics.mjs run --out <dir> [--shards <dir>] [--jobs <jobs.json>]
 * Environment (job, all optional): BROWSER, SHARD ("2/3"), NPM_CACHE_HIT (setup-node's cache-hit output),
 * NPM_CI_SECONDS, IMAGE_PULL_SECONDS. Both: GITHUB_SHA, GITHUB_REF_NAME, GITHUB_SERVER_URL, GITHUB_REPOSITORY,
 * GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_STEP_SUMMARY.
 * Exit status: 0 whatever it found or could not read (missing inputs are said, in the output's `unavailable`); 64 bad usage.
 * Test: node --test tools/tests/*.test.mjs
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SLOWEST_TESTS = 20;
const SLOWEST_FILES = 15;
const BROWSERS = ['chromium', 'firefox', 'webkit'];
const TESTS_STEP = /^Playwright \(/;
const DEMO_JOB = /^Demo \+ Playwright \((\S+) (\d+)\/(\d+)\)$/;
const env = process.env;

const [command, ...rest] = process.argv.slice(2);
const args = options(rest);
if (!args || !args.out || !['job', 'run'].includes(command)) {
    console.error('Usage: ci-metrics.mjs job --out <job-metrics.json> [--buildx <history.jsonl>]\n       ci-metrics.mjs run --out <dir> [--shards <dir>] [--jobs <jobs.json>]');
    process.exit(64);
}

const run = {
    sha: env.GITHUB_SHA ?? null,
    ref: env.GITHUB_REF_NAME ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : null,
    runUrl: env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
        ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
};

if (command === 'job') {
    job(args);
} else {
    aggregate(args);
}

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

// ---- job ----------------------------------------------------------------------------------------------------------

function job({ out, buildx }) {
    const unavailable = [];
    const builds = buildx ? lines(buildx) : null;
    if (!builds) {
        unavailable.push(`no Docker build history${buildx ? ` (${buildx} is missing or empty)` : ''}`);
    }
    const dockerBuilds = (builds ?? []).map((record) => ({
        name: record.name ?? null,
        status: record.status ?? null,
        totalSteps: count(record.total_steps ?? record.NumTotalSteps),
        cachedSteps: count(record.cached_steps ?? record.NumCachedSteps),
        completedSteps: count(record.completed_steps ?? record.NumCompletedSteps),
        durationMs: span(record.created_at ?? record.CreatedAt, record.completed_at ?? record.CompletedAt),
    }));
    const metrics = {
        schema: 1,
        ...run,
        browser: env.BROWSER || null,
        shard: env.SHARD || null,
        npmCacheHit: { true: true, false: false }[env.NPM_CACHE_HIT] ?? null,
        setupSeconds: { npmCi: number(env.NPM_CI_SECONDS), playwrightImagePull: number(env.IMAGE_PULL_SECONDS) },
        dockerCache: dockerBuilds.length ? cacheOf(dockerBuilds) : null,
        dockerBuilds,
        unavailable,
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(metrics, null, 2) + '\n');
    const cache = metrics.dockerCache;
    console.log(`Docker build cache: ${cache ? `${cache.cachedSteps} of ${cache.totalSteps} steps cached (${percent(cache.ratio)})` : 'unknown'}; npm cache hit: ${metrics.npmCacheHit ?? 'unknown'}`);
}

function cacheOf(builds) {
    const totalSteps = builds.reduce((sum, b) => sum + (b.totalSteps ?? 0), 0);
    const cachedSteps = builds.reduce((sum, b) => sum + (b.cachedSteps ?? 0), 0);
    return { builds: builds.length, totalSteps, cachedSteps, ratio: totalSteps ? round2(cachedSteps / totalSteps) : null };
}

// ---- run ----------------------------------------------------------------------------------------------------------

function aggregate({ out, shards: shardsDir, jobs: jobsFile }) {
    const unavailable = [];
    const jobs = readJobs(jobsFile);
    if (!jobs) {
        unavailable.push(`no job list${jobsFile ? ` (${jobsFile} is missing, empty or not JSON)` : ''}`);
    }
    const shards = readShards(shardsDir, jobs ?? []);
    if (!shards.length) {
        unavailable.push(`no shard results${shardsDir ? ` in ${shardsDir}` : ''} (the browser jobs were skipped, or left no artifact)`);
    }
    const tests = shards.flatMap((shard) => shard.testList.map((test) => ({ browser: shard.browser, shard: `${shard.shard}/${shard.shards}`, ...test })));
    const metrics = {
        schema: 1,
        ...run,
        shards: shards.map(({ testList, ...shard }) => shard),
        browsers: balance(shards),
        slowestTests: tests.filter((t) => t.durationMs !== null).sort((a, b) => b.durationMs - a.durationMs).slice(0, SLOWEST_TESTS)
            .map(({ browser, shard, project, file, line, title, outcome, durationMs, attemptMs }) => ({ browser, shard, project, file, line, title, outcome, durationMs, attempts: attemptMs.length })),
        slowestFiles: slowestFiles(tests),
        retried: tests.filter((t) => t.attemptMs.length > 1 || t.outcome === 'failed' || t.outcome === 'flaky')
            .map(({ browser, shard, project, file, line, title, outcome, attemptMs }) => ({ browser, shard, project, file, line, title, outcome, attempts: attemptMs.length })),
        jobs: (jobs ?? []).map(jobSummary),
        run: runOf(jobs ?? []),
        demoSteps: demoSteps(jobs ?? []),
        unavailable,
    };
    const markdown = render(metrics);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'ci-metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
    writeFileSync(join(out, 'ci-metrics.md'), markdown);
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
        console.log(`CI metrics: ${metrics.shards.length} shards, ${metrics.jobs.length} jobs (${join(out, 'ci-metrics.json')})`);
    } else {
        console.log(markdown);
    }
}

/** The completed jobs of the run, the API's objects; null when there is no list. */
function readJobs(file) {
    if (!file || !existsSync(file)) {
        return null;
    }
    const text = readFileSync(file, 'utf8').trim();
    if (!text) {
        return null;
    }
    let list;
    try {
        const parsed = JSON.parse(text);
        list = Array.isArray(parsed) ? parsed : (parsed.jobs ?? [parsed]);
    } catch {
        list = lines(file);
    }
    return list ? list.filter((j) => j && j.completed_at && j.started_at) : null;
}

function readShards(dir, jobs) {
    if (!dir || !existsSync(dir)) {
        return [];
    }
    const shards = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const durations = json(join(dir, entry.name, 'durations.json'));
        if (!durations) continue;
        const jobMetrics = json(join(dir, entry.name, 'job-metrics.json'));
        const id = /^(\S+) (\d+)\/(\d+)$/.exec(durations.shard ?? '') ?? /^playwright-results-(.+)-(\d+)$/.exec(entry.name);
        if (!id) continue;
        const [browser, current, total] = [id[1], Number(id[2]), id[3] ? Number(id[3]) : null];
        const testList = (durations.tests ?? []).map((t) => ({
            project: t.project, file: t.file, line: t.line, title: t.title, outcome: t.outcome,
            durationMs: t.durationMs ?? null, attemptMs: t.attemptMs ?? [],
        }));
        const outcomes = (outcome) => testList.filter((t) => t.outcome === outcome).length;
        const workers = durations.workers?.actual ?? durations.workers?.configured ?? null;
        const valid = durations.status === 'valid' && durations.wallMs != null;
        const capacity = valid && workers ? durations.wallMs * workers : null;
        const attempts = valid ? durations.attempts : null;
        const apiJob = jobs.find((j) => j.name === `Demo + Playwright (${browser} ${current}/${total})`);
        shards.push({
            browser,
            shard: current,
            shards: total,
            artifact: entry.name,
            status: durations.status ?? null,
            tests: valid ? testList.length : null,
            attempts,
            retries: valid ? attempts - testList.length : null,
            failed: valid ? outcomes('failed') : null,
            flaky: valid ? outcomes('flaky') : null,
            skipped: valid ? outcomes('skipped') : null,
            wallMs: valid ? durations.wallMs : null,
            summedTestMs: valid ? durations.summedTestMs : null,
            workers: valid ? workers : null,
            utilisation: capacity ? round2(durations.summedTestMs / capacity) : null,
            idleWorkerMs: capacity ? Math.max(0, capacity - durations.summedTestMs) : null,
            job: apiJob ? phases(apiJob) : null,
            dockerCache: jobMetrics?.dockerCache ?? null,
            npmCacheHit: jobMetrics?.npmCacheHit ?? null,
            setupSeconds: jobMetrics?.setupSeconds ?? null,
            testList: valid ? testList : [],
        });
    }
    return shards.sort((a, b) => browserOrder(a.browser, b.browser) || a.shard - b.shard);
}

/** A browser job's time: queued, then setup up to the Playwright step, the tests, and the rest (reports, uploads). */
function phases(apiJob) {
    const tests = (apiJob.steps ?? []).find((step) => TESTS_STEP.test(step.name ?? ''));
    const ran = tests && tests.conclusion !== 'skipped';
    return {
        name: apiJob.name,
        conclusion: apiJob.conclusion ?? null,
        queuedMs: span(apiJob.created_at, apiJob.started_at),
        durationMs: span(apiJob.started_at, apiJob.completed_at),
        setupMs: ran ? span(apiJob.started_at, tests.started_at) : null,
        testsMs: ran ? span(tests.started_at, tests.completed_at) : null,
        afterMs: ran ? span(tests.completed_at, apiJob.completed_at) : null,
    };
}

function balance(shards) {
    const out = {};
    for (const browser of [...new Set(shards.map((s) => s.browser))]) {
        const mine = shards.filter((s) => s.browser === browser);
        const total = Math.max(...mine.map((s) => s.shards ?? 0)) || null;
        const seen = new Set(mine.map((s) => s.shard));
        const valid = mine.filter((s) => s.wallMs !== null);
        const wall = stats(valid.map((s) => s.wallMs));
        out[browser] = {
            shards: total,
            reported: mine.length,
            missing: total ? Array.from({ length: total }, (_, i) => i + 1).filter((n) => !seen.has(n)).map((n) => `${n}/${total}`) : [],
            notReached: mine.filter((s) => s.status !== 'valid').map((s) => `${s.shard}/${s.shards}`),
            tests: valid.reduce((sum, s) => sum + s.tests, 0),
            wallMs: wall,
            summedTestMs: stats(valid.map((s) => s.summedTestMs)),
            jobMs: stats(mine.map((s) => s.job?.durationMs).filter((v) => v != null)),
            testsStepMs: stats(mine.map((s) => s.job?.testsMs).filter((v) => v != null)),
            setupMs: stats(mine.map((s) => s.job?.setupMs).filter((v) => v != null)),
            imbalance: wall && wall.mean ? round2((wall.max - wall.min) / wall.mean) : null,
        };
    }
    return out;
}

function slowestFiles(tests) {
    const files = new Map();
    for (const test of tests) {
        const key = `${test.browser}\u0000${test.file}`;
        const file = files.get(key) ?? { browser: test.browser, file: test.file, tests: 0, durationMs: 0, shards: [] };
        file.tests += 1;
        file.durationMs += test.durationMs ?? 0;
        if (!file.shards.includes(test.shard)) file.shards.push(test.shard);
        files.set(key, file);
    }
    return [...files.values()].sort((a, b) => b.durationMs - a.durationMs).slice(0, SLOWEST_FILES);
}

function jobSummary(apiJob) {
    return {
        name: apiJob.name,
        conclusion: apiJob.conclusion ?? null,
        runner: apiJob.runner_name ?? null,
        queuedMs: span(apiJob.created_at, apiJob.started_at),
        durationMs: span(apiJob.started_at, apiJob.completed_at),
        steps: [...(apiJob.steps ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).map((step) => ({
            name: step.name,
            conclusion: step.conclusion ?? null,
            durationMs: step.conclusion === 'skipped' ? null : span(step.started_at, step.completed_at),
        })),
    };
}

/** The run as its jobs saw it: from the first job queued to the last done, and its longest job. */
function runOf(jobs) {
    if (!jobs.length) {
        return null;
    }
    const starts = jobs.map((j) => Date.parse(j.created_at)).filter(Number.isFinite);
    const ends = jobs.map((j) => Date.parse(j.completed_at)).filter(Number.isFinite);
    const longest = jobs.map(jobSummary).reduce((a, b) => ((b.durationMs ?? -1) > (a.durationMs ?? -1) ? b : a));
    return {
        wallMs: starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null,
        jobs: jobs.length,
        longestJob: longest.name,
        longestJobMs: longest.durationMs,
    };
}

/** The browser jobs' mean time per step and browser, in the steps' order; a skipped step spent no time. */
function demoSteps(jobs) {
    const sums = new Map();
    for (const apiJob of jobs) {
        const match = DEMO_JOB.exec(apiJob.name ?? '');
        if (!match) continue;
        for (const step of [...(apiJob.steps ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
            const ms = step.conclusion === 'skipped' ? null : span(step.started_at, step.completed_at);
            if (ms === null) continue;
            const byBrowser = sums.get(step.name) ?? {};
            (byBrowser[match[1]] ??= []).push(ms);
            sums.set(step.name, byBrowser);
        }
    }
    return Object.fromEntries([...sums].map(([name, byBrowser]) => [name, Object.fromEntries(
        Object.entries(byBrowser).sort(([a], [b]) => browserOrder(a, b)).map(([browser, list]) => [browser, Math.round(list.reduce((s, v) => s + v, 0) / list.length)]),
    )]));
}

// ---- Markdown -----------------------------------------------------------------------------------------------------

function render(m) {
    const lines = ['## CI metrics (report only)', ''];
    if (m.run) {
        lines.push(`- Run: ${seconds(m.run.wallMs)} from the first job queued to the last done, ${m.run.jobs} jobs; longest: ${m.run.longestJob} (${seconds(m.run.longestJobMs)})`);
    }
    for (const note of m.unavailable) {
        lines.push(`- ${note}`);
    }
    lines.push('');
    const browsers = Object.entries(m.browsers);
    if (browsers.length) {
        lines.push('### Shard balance', '', 'Wall time is Playwright\'s; imbalance is (max − min) / mean of the shards\' wall times.', '',
            '| Browser | Shards | Max wall | Min wall | Mean wall | Imbalance | Tests | Mean job | Mean setup | Notes |',
            '|---|---|---:|---:|---:|---:|---:|---:|---:|---|');
        for (const [browser, b] of browsers) {
            const notes = [b.missing.length ? `missing: ${b.missing.join(', ')}` : '', b.notReached.length ? `not reached: ${b.notReached.join(', ')}` : ''].filter(Boolean).join('; ');
            lines.push(`| ${browser} | ${b.reported} of ${b.shards ?? '?'} | ${seconds(b.wallMs?.max)} | ${seconds(b.wallMs?.min)} | ${seconds(b.wallMs?.mean)} | ${b.imbalance === null ? '–' : percent(b.imbalance)} | ${b.tests} | ${seconds(b.jobMs?.mean)} | ${seconds(b.setupMs?.mean)} | ${notes} |`);
        }
        lines.push('');
    }
    if (m.shards.length) {
        lines.push('### Shards', '',
            '| Shard | Status | Tests | Retries | Failed | Flaky | Wall | Summed tests | Worker use | Queued | Setup | Tests step | After | Docker cache | npm cache |',
            '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
        for (const s of m.shards) {
            const cache = s.dockerCache ? `${s.dockerCache.cachedSteps}/${s.dockerCache.totalSteps}` : '–';
            lines.push(`| ${s.browser} ${s.shard}/${s.shards} | ${s.status} | ${dash(s.tests)} | ${dash(s.retries)} | ${dash(s.failed)} | ${dash(s.flaky)} | ${seconds(s.wallMs)} | ${seconds(s.summedTestMs)} | ${s.utilisation === null ? '–' : percent(s.utilisation)} | ${seconds(s.job?.queuedMs)} | ${seconds(s.job?.setupMs)} | ${seconds(s.job?.testsMs)} | ${seconds(s.job?.afterMs)} | ${cache} | ${s.npmCacheHit === null ? '–' : s.npmCacheHit ? 'hit' : 'miss'} |`);
        }
        lines.push('');
    }
    const steps = Object.entries(m.demoSteps);
    if (steps.length) {
        const columns = [...new Set([...BROWSERS, ...steps.flatMap(([, byBrowser]) => Object.keys(byBrowser))])];
        lines.push('### Browser jobs, step by step', '', 'Mean time of each step over the browser\'s shards (GitHub\'s step times, to the second).', '',
            `| Step | ${columns.join(' | ')} |`, `|---|${columns.map(() => '---:').join('|')}|`);
        for (const [name, byBrowser] of steps) {
            lines.push(`| ${cell(name)} | ${columns.map((browser) => (byBrowser[browser] === undefined ? '–' : seconds(byBrowser[browser]))).join(' | ')} |`);
        }
        lines.push('');
    }
    if (m.slowestTests.length) {
        lines.push(`### Slowest tests (${m.slowestTests.length})`, '', '| Time | Attempts | Shard | Test |', '|---:|---:|---|---|');
        for (const t of m.slowestTests) {
            lines.push(`| ${seconds(t.durationMs)} | ${t.attempts} | ${t.browser} ${t.shard} | [${cell(t.project)}] ${cell(`${t.file}:${t.line} › ${t.title}`)} |`);
        }
        lines.push('');
    }
    if (m.slowestFiles.length) {
        lines.push(`### Slowest files (${m.slowestFiles.length})`, '', '| Time | Tests | Browser | Shards | File |', '|---:|---:|---|---|---|');
        for (const f of m.slowestFiles) {
            lines.push(`| ${seconds(f.durationMs)} | ${f.tests} | ${f.browser} | ${f.shards.join(', ')} | ${cell(f.file ?? 'unknown')} |`);
        }
        lines.push('');
    }
    if (m.retried.length) {
        lines.push(`### Retried tests (${m.retried.length})`, '', '| Outcome | Attempts | Shard | Test |', '|---|---:|---|---|');
        for (const t of m.retried) {
            lines.push(`| ${t.outcome} | ${t.attempts} | ${t.browser} ${t.shard} | [${cell(t.project)}] ${cell(`${t.file}:${t.line} › ${t.title}`)} |`);
        }
        lines.push('');
    }
    if (m.jobs.length) {
        lines.push('### Jobs', '', '| Job | Conclusion | Queued | Duration | Longest step |', '|---|---|---:|---:|---|');
        for (const j of [...m.jobs].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))) {
            const longest = j.steps.filter((s) => s.durationMs !== null).sort((a, b) => b.durationMs - a.durationMs)[0];
            lines.push(`| ${cell(j.name)} | ${j.conclusion ?? '–'} | ${seconds(j.queuedMs)} | ${seconds(j.durationMs)} | ${longest ? `${cell(longest.name)} (${seconds(longest.durationMs)})` : '–'} |`);
        }
        lines.push('');
    }
    lines.push(`Every number, each job's steps included: \`ci-metrics.json\` in the \`ci-metrics-<run>-<attempt>\` artifact.`, '');
    return lines.join('\n');
}

// ---- helpers ------------------------------------------------------------------------------------------------------

/** A file of JSON objects, one per line; null when missing, empty or unreadable. */
function lines(file) {
    if (!existsSync(file)) {
        return null;
    }
    const out = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
            out.push(JSON.parse(line));
        } catch {
            // a line that is not JSON (a warning the command printed) is not a record
        }
    }
    return out.length ? out : null;
}

function json(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function span(from, to) {
    const ms = Date.parse(to) - Date.parse(from);
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function stats(values) {
    if (!values.length) {
        return null;
    }
    return { max: Math.max(...values), min: Math.min(...values), mean: Math.round(values.reduce((s, v) => s + v, 0) / values.length) };
}

function browserOrder(a, b) {
    const rank = (name) => (BROWSERS.includes(name) ? BROWSERS.indexOf(name) : BROWSERS.length);
    return rank(a) - rank(b) || a.localeCompare(b);
}

function count(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function number(value) {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

function percent(ratio) {
    return `${Math.round(ratio * 100)}%`;
}

function seconds(ms) {
    return ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`;
}

function dash(value) {
    return value ?? '–';
}

function cell(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
