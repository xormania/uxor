// The cases of tools/ci/ci-metrics.mjs, run as CI runs it: `job` in a browser shard (its caches and setup times next
// to the shard's results), `run` in CI result (every shard's durations.json and job-metrics.json, and the run's jobs
// from GitHub's API). The shards are written by tools/ci/playwright-summary.mjs itself, from its own fixtures, so the
// aggregate reads what CI writes. Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/ci-metrics.mjs');
const summarizer = join(root, 'tools/ci/playwright-summary.mjs');
const reports = join(root, 'tools/tests/fixtures/playwright-results');
const fixtures = join(root, 'tools/tests/fixtures/ci-metrics');

const baseEnv = {
    PATH: process.env.PATH,
    GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
    GITHUB_REF_NAME: 'claude/ci-shards',
    GITHUB_REPOSITORY: 'xorman/flowbite-xor',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '1',
};

function metrics(args, env = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-metrics-'));
    const summaryFile = join(dir, 'step-summary.md');
    writeFileSync(summaryFile, '');
    const run = spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        cwd: dir,
        env: { ...baseEnv, GITHUB_STEP_SUMMARY: summaryFile, ...env },
    });
    return { code: run.status, stdout: run.stdout, stderr: run.stderr, summary: readFileSync(summaryFile, 'utf8'), dir };
}

/** One shard's artifact directory, as the browser job uploads it: the summarizer's output from a fixture report. */
function shard(shardsDir, browser, current, total, fixture, { workers = 2, setupFailed = false } = {}) {
    const dir = join(shardsDir, `playwright-results-${browser}-${current}`);
    mkdirSync(dir, { recursive: true });
    const env = { ...baseEnv, BROWSER: browser, SHARD: `${current}/${total}` };
    if (setupFailed) {
        env.SETUP_STEPS = 'Build the demo image=success\nStart the demo=failure';
    } else {
        const report = JSON.parse(readFileSync(join(reports, fixture), 'utf8'));
        report.config.shard = { current, total };
        report.config.workers = workers;
        report.config.metadata = { actualWorkers: workers };
        writeFileSync(join(dir, 'results.json'), JSON.stringify(report));
    }
    spawnSync(process.execPath, [summarizer, join(dir, 'results.json')], { encoding: 'utf8', env });
    assert.ok(existsSync(join(dir, 'durations.json')), `durations.json for ${browser} ${current}/${total}`);
    return dir;
}

/** Four Chromium shards, two of Firefox's three (one not reached, one missing), and the run's jobs. */
function run() {
    const dir = mkdtempSync(join(tmpdir(), 'ci-metrics-run-'));
    const shards = join(dir, 'shards');
    const chromium1 = shard(shards, 'chromium', 1, 4, 'timed.json');
    shard(shards, 'chromium', 2, 4, 'clean.json');
    shard(shards, 'chromium', 3, 4, 'flaky.json');
    shard(shards, 'chromium', 4, 4, 'failed.json');
    shard(shards, 'firefox', 1, 3, 'clean.json');
    shard(shards, 'firefox', 2, 3, null, { setupFailed: true });
    // chromium 1's job metrics, as its `job` step writes them
    const job = metrics(['job', '--buildx', join(fixtures, 'buildx-history.jsonl'), '--out', join(chromium1, 'job-metrics.json')], {
        BROWSER: 'chromium', SHARD: '1/4', NPM_CACHE_HIT: 'true', NPM_CI_SECONDS: '21', IMAGE_PULL_SECONDS: '38',
    });
    assert.equal(job.code, 0, job.stderr);
    const out = join(dir, 'out');
    const result = metrics(['run', '--shards', shards, '--jobs', join(fixtures, 'jobs.jsonl'), '--out', out]);
    const json = existsSync(join(out, 'ci-metrics.json')) ? JSON.parse(readFileSync(join(out, 'ci-metrics.json'), 'utf8')) : null;
    return { ...result, json, markdown: existsSync(join(out, 'ci-metrics.md')) ? readFileSync(join(out, 'ci-metrics.md'), 'utf8') : null };
}

test('job: the shard\'s Docker build cache (cached of total steps), npm cache hit and setup times, in job-metrics.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-metrics-job-'));
    const out = join(dir, 'playwright-results', 'job-metrics.json');
    const result = metrics(['job', '--buildx', join(fixtures, 'buildx-history.jsonl'), '--out', out], {
        BROWSER: 'webkit', SHARD: '3/3', NPM_CACHE_HIT: 'false', NPM_CI_SECONDS: '25', IMAGE_PULL_SECONDS: '41',
    });
    assert.equal(result.code, 0, result.stderr);
    const job = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(job.schema, 1);
    assert.equal(job.browser, 'webkit');
    assert.equal(job.shard, '3/3');
    assert.equal(job.sha, baseEnv.GITHUB_SHA);
    assert.equal(job.npmCacheHit, false);
    assert.deepEqual(job.setupSeconds, { npmCi: 25, playwrightImagePull: 41 });
    assert.deepEqual(job.dockerCache, { builds: 2, totalSteps: 24, cachedSteps: 16, ratio: 0.67 });
    assert.deepEqual(job.dockerBuilds.map((b) => [b.name, b.status, b.cachedSteps, b.totalSteps, b.durationMs]),
        [['php', 'Completed', 14, 20, 114500], ['php', 'Completed', 2, 4, 1000]]);
});

test('job: no build record or no inputs is metrics left unknown, never a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-metrics-job-'));
    const out = join(dir, 'job-metrics.json');
    const result = metrics(['job', '--buildx', join(dir, 'missing.jsonl'), '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    const job = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(job.npmCacheHit, null);
    assert.deepEqual(job.setupSeconds, { npmCi: null, playwrightImagePull: null });
    assert.equal(job.dockerCache, null);
    assert.match(job.unavailable.join('\n'), /build history/);
});

test('run: each shard\'s tests, retries, wall and summed time, worker use, and its job\'s setup, tests and the rest', () => {
    const { code, stderr, json } = run();
    assert.equal(code, 0, stderr);
    assert.equal(json.schema, 1);
    assert.equal(json.runId, '42');
    assert.equal(json.sha, baseEnv.GITHUB_SHA);
    assert.deepEqual(json.shards.map((s) => `${s.browser} ${s.shard}/${s.shards}`),
        ['chromium 1/4', 'chromium 2/4', 'chromium 3/4', 'chromium 4/4', 'firefox 1/3', 'firefox 2/3']);
    const [c1, , c3, c4, f1, f2] = json.shards;
    assert.equal(c1.status, 'valid');
    assert.equal(c1.tests, 13);
    assert.equal(c1.attempts, 14);
    assert.equal(c1.retries, 1);
    assert.equal(c1.flaky, 1);
    assert.equal(c1.skipped, 1);
    assert.equal(c1.wallMs, 40251);
    assert.equal(c1.summedTestMs, 67500);
    assert.equal(c1.workers, 2);
    assert.equal(c1.utilisation, 0.84); // 67500 / (40251 × 2)
    assert.equal(c1.idleWorkerMs, 13002); // 40251 × 2 − 67500
    assert.equal(c4.failed, 2);
    assert.equal(c3.flaky, 1);
    // the job behind the shard, from the API: queued, then setup until the Playwright step, the tests, the rest
    assert.deepEqual(c1.job, { name: 'Demo + Playwright (chromium 1/4)', conclusion: 'success', queuedMs: 10000, durationMs: 710000, setupMs: 230000, testsMs: 420000, afterMs: 60000 });
    assert.deepEqual(c1.dockerCache, { builds: 2, totalSteps: 24, cachedSteps: 16, ratio: 0.67 });
    assert.equal(c1.npmCacheHit, true);
    assert.deepEqual(c1.setupSeconds, { npmCi: 21, playwrightImagePull: 38 });
    assert.equal(f1.job.testsMs, 145000);
    assert.equal(f2.status, 'not-reached');
    assert.equal(f2.wallMs, null);
    assert.equal(f2.utilisation, null);
    assert.equal(f2.job, null);
});

test('run: the shard balance per browser, and the shards that left no results said as missing', () => {
    const { json, markdown, summary } = run();
    const chromium = json.browsers.chromium;
    assert.equal(chromium.shards, 4);
    assert.equal(chromium.reported, 4);
    assert.deepEqual(chromium.wallMs, { max: 40251, min: 15000, mean: 28998 });
    assert.equal(chromium.imbalance, 0.87); // (max − min) / mean
    assert.equal(chromium.tests, 13 + 3 + 2 + 3);
    assert.deepEqual(chromium.jobMs, { max: 710000, min: 490000, mean: 600000 });
    const firefox = json.browsers.firefox;
    assert.equal(firefox.shards, 3);
    assert.equal(firefox.reported, 2);
    assert.deepEqual(firefox.missing, ['3/3']);
    assert.deepEqual(firefox.notReached, ['2/3']);
    assert.match(markdown, /## CI metrics/);
    assert.match(markdown, /### Shard balance/);
    assert.match(markdown, /\| chromium \| 4 of 4 \| 40\.3 s \| 15\.0 s \| 29\.0 s \| 87% \|/);
    assert.match(markdown, /firefox.*missing: 3\/3/);
    assert.equal(summary, markdown);
});

test('run: the slowest tests and files across every shard, and each retried test, with the shard it ran in', () => {
    const { json, markdown } = run();
    assert.deepEqual(json.slowestTests.slice(0, 3).map((t) => [t.browser, t.shard, t.title, t.durationMs]), [
        ['chromium', '4/4', 'closes on Back', 35000],
        ['chromium', '3/4', 'search, filter, sort, page and page size each add a history entry', 13300],
        ['chromium', '1/4', 'dismisses \\| each alert', 12500],
    ]);
    assert.ok(json.slowestTests.length <= 20);
    const a11y = json.slowestFiles.find((f) => f.browser === 'chromium' && f.file === 'tests/e2e/a11y.spec.ts');
    assert.equal(a11y.durationMs, 45000);
    assert.deepEqual(a11y.shards, ['1/4']);
    assert.deepEqual(json.retried.map((t) => [t.browser, t.shard, t.outcome, t.title]).sort(), [
        ['chromium', '1/4', 'flaky', 'pauses while hovered'],
        ['chromium', '3/4', 'flaky', 'search, filter, sort, page and page size each add a history entry'],
        ['chromium', '4/4', 'failed', 'closes on Back'],
        ['chromium', '4/4', 'failed', 'dismisses each alert independently'],
    ]);
    assert.match(markdown, /### Slowest tests/);
    assert.match(markdown, /### Retried tests/);
});

test('run: every job\'s queue and duration, the run\'s wall time, and where the browser jobs\' time goes, step by step', () => {
    const { json, markdown } = run();
    assert.deepEqual(json.jobs.map((j) => j.name), ['Changes', 'Tool tests', 'Demo + Playwright (chromium 1/4)', 'Demo + Playwright (chromium 2/4)', 'Demo + Playwright (firefox 1/3)']);
    const changes = json.jobs[0];
    assert.equal(changes.queuedMs, 5000);
    assert.equal(changes.durationMs, 30000);
    assert.deepEqual(changes.steps.map((s) => [s.name, s.durationMs]), [['Set up job', 2000], ["The script's own cases", 23000], ['Complete job', 5000]]);
    assert.deepEqual(json.run, { wallMs: 780000, jobs: 5, longestJob: 'Demo + Playwright (chromium 1/4)', longestJobMs: 710000 });
    assert.deepEqual(json.demoSteps['Build the demo image'], { chromium: 90000, firefox: 60000 });
    assert.deepEqual(json.demoSteps['Playwright (smoke + every README example + upstream recipe specs)'], { chromium: 347500, firefox: 145000 });
    assert.equal(json.demoSteps['The sync leaves tracked files unchanged'], undefined, 'a skipped step is no time spent');
    assert.match(markdown, /### Browser jobs, step by step/);
    assert.match(markdown, /\| Build the demo image \| 90\.0 s \| 60\.0 s \| – \|/);
    assert.match(markdown, /### Jobs/);
});

test('run: no shard and no job is said, never a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-metrics-empty-'));
    const out = join(dir, 'out');
    const result = metrics(['run', '--shards', join(dir, 'none'), '--jobs', join(dir, 'none.jsonl'), '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    const json = JSON.parse(readFileSync(join(out, 'ci-metrics.json'), 'utf8'));
    assert.deepEqual(json.shards, []);
    assert.deepEqual(json.jobs, []);
    assert.match(json.unavailable.join('\n'), /no shard results/);
    assert.match(json.unavailable.join('\n'), /no job list/);
    assert.match(result.summary, /no shard results/);
});

test('bad usage exits 64', () => {
    assert.equal(metrics([]).code, 64);
    assert.equal(metrics(['run']).code, 64);
    assert.equal(metrics(['job']).code, 64);
});
