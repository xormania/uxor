#!/usr/bin/env node
/*
 * Waits for another job of the same workflow run, found by its exact name through GitHub's API, and lets the calling
 * job go on only when that job succeeded. The browser jobs start without `needs: importmap` and wait here for
 * *Importmap packages* just before they download its artifact: the job usually ends while they set up, so they no
 * longer queue behind it.
 *
 * Usage: node tools/ci/wait-for-job.mjs --name <job name> --timeout <seconds> [--interval <seconds>]
 *        [--max-interval <seconds>] [--max-requests <n>] [--upstream <job name>]
 * Environment: GH_TOKEN (a token that can read the run's jobs: `actions: read`), GITHUB_API_URL, GITHUB_REPOSITORY,
 * GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT.
 *
 * Requests: the interval starts at --interval (3 s) and grows by half each time to --max-interval (15 s), and the wait
 * gives up after --max-requests (60) reads of the run's jobs, so a slow job cannot spend the repository's API budget. A
 * rate-limit answer (403 or 429 with no requests left, or a retry-after) waits for the reset the API reports, once; a
 * reset past the timeout, or a 403 that is not a rate limit, ends the wait at once. Other API errors are retried with
 * the same backoff, never read as success.
 *
 * Attempts: it reads the latest attempt of each job (`filter=latest`). A result counts when the job ran in this attempt
 * (GITHUB_RUN_ATTEMPT), or, from an earlier attempt, only when it succeeded and this attempt did not re-run the job:
 * --upstream (Changes) is a job the target needs, and an upstream that ran again in this attempt means the target runs
 * again too ("Re-run all jobs"); with "Re-run failed jobs" both keep their earlier success. An earlier failure is never
 * this attempt's result: the target, failed, is re-run, and the wait goes on for its new result.
 *
 * Exit status 0 when the job succeeded; 1 with an error annotation when it ended any other way (failed, cancelled,
 * skipped, timed out), was not listed, did not end within the timeout or the request cap, or the API refused. Exit
 * status 64 on a usage error.
 * Test: node --test tools/tests/wait-for-job.test.mjs
 */
import { parseArgs } from 'node:util';

const usage = (message) => {
    console.error(`wait-for-job.mjs: ${message}`);
    console.error('usage: wait-for-job.mjs --name <job name> --timeout <seconds> [--interval <seconds>]');
    process.exit(64);
};

let values;
try {
    ({ values } = parseArgs({ options: {
        name: { type: 'string' }, timeout: { type: 'string' }, interval: { type: 'string', default: '3' },
        'max-interval': { type: 'string', default: '15' }, 'max-requests': { type: 'string', default: '60' }, upstream: { type: 'string', default: 'Changes' },
    } }));
} catch (error) {
    usage(error.message);
}
if (!values.name) usage('--name is required');
if (!/^\d+$/.test(values.timeout ?? '')) usage('--timeout <seconds> is required');
if (!/^\d+(\.\d+)?$/.test(values.interval)) usage('--interval is a number of seconds');
if (!/^\d+(\.\d+)?$/.test(values['max-interval'])) usage('--max-interval is a number of seconds');
if (!/^[1-9]\d*$/.test(values['max-requests'])) usage('--max-requests is a whole number');
const { GH_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env;
const attempt = Number(process.env.GITHUB_RUN_ATTEMPT || '1');
const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
if (!repository || !runId) usage('GITHUB_REPOSITORY and GITHUB_RUN_ID are required');

const timeout = Number(values.timeout) * 1000;
let interval = Number(values.interval) * 1000;
const maxInterval = Math.max(interval, Number(values['max-interval']) * 1000);
const maxRequests = Number(values['max-requests']);
let requests = 0;

class Stop extends Error {}
/** A rate-limit answer: how long to wait for its reset, in ms, or null when it is not one */
function rateLimitWait(response) {
    const retryAfter = Number(response.headers.get('retry-after'));
    if (response.headers.get('retry-after') !== null && Number.isFinite(retryAfter)) return retryAfter * 1000;
    if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - Date.now()) + 500;
    }
    return null;
}
const begin = Date.now();
const elapsed = () => Math.round((Date.now() - begin) / 1000);

/** Every job of the run, latest attempt each, read page by page; throws on an API error. */
async function jobs() {
    const all = [];
    for (let page = 1; ; page++) {
        if (requests >= maxRequests) throw new Stop(`gave up after ${maxRequests} requests`);
        requests++;
        const response = await fetch(`${apiUrl}/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`, {
            headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
            const pause = [403, 429].includes(response.status) ? rateLimitWait(response) : null;
            if (pause !== null) {
                if (Date.now() + pause - begin >= timeout) throw new Stop(`the API's rate limit resets after the timeout (in ${Math.round(pause / 1000)} s)`);
                console.log(`the API's rate limit is spent: waiting ${Math.round(pause / 1000)} s for its reset`);
                await new Promise((resolve) => setTimeout(resolve, pause));
                page--;
                continue;
            }
            if (403 === response.status || 401 === response.status || 404 === response.status) throw new Stop(`the API refused: ${response.status}`);
            throw new Error(`the API answered ${response.status}`);
        }
        const body = await response.json();
        all.push(...(body.jobs ?? []));
        if (!body.jobs?.length || all.length >= (body.total_count ?? 0)) return all;
    }
}

/** this attempt's record of the job, or an earlier success this attempt did not re-run; else undefined (wait on) */
function current(list) {
    const job = list.find((j) => j.name === values.name);
    if (!job || (job.run_attempt ?? attempt) >= attempt) return job;
    const upstream = list.find((j) => j.name === values.upstream);
    const upstreamAgain = upstream && (upstream.run_attempt ?? attempt) >= attempt;
    return 'completed' === job.status && 'success' === job.conclusion && !upstreamAgain ? job : undefined;
}

let last = 'not listed';
while (Date.now() - begin < timeout) {
    try {
        const job = current(await jobs());
        if (job && 'completed' === job.status) {
            if ('success' === job.conclusion) {
                console.log(`${values.name} succeeded (waited ${elapsed()} s)`);
                process.exit(0);
            }
            console.log(`::error::${values.name} ended ${job.conclusion}: this job cannot go on without its result`);
            process.exit(1);
        }
        last = job ? job.status : `not listed for attempt ${attempt}`;
    } catch (error) {
        if (error instanceof Stop) {
            console.log(`::error::${values.name}: ${error.message} (last seen: ${last})`);
            process.exit(1);
        }
        last = error.message;
        console.log(`::warning::reading the run's jobs failed (${error.message}); retrying`);
    }
    if (requests >= maxRequests) {
        console.log(`::error::${values.name} did not succeed within ${maxRequests} requests (last seen: ${last})`);
        process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(maxInterval, interval * 1.5);
}
console.log(`::error::${values.name} did not succeed within ${values.timeout} s (last seen: ${last})`);
process.exit(1);
