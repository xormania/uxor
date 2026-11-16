#!/usr/bin/env node
/*
 * Waits for another job of the same workflow run, found by its exact name through GitHub's API, and lets the calling
 * job go on only when that job succeeded. The browser jobs start without `needs: importmap` and wait here for
 * *Importmap packages* just before they download its artifact: the job usually ends while they set up, so they no
 * longer queue behind it.
 *
 * Usage: node tools/ci/wait-for-job.mjs --name <job name> --timeout <seconds> [--interval <seconds>]
 * Environment: GH_TOKEN (a token that can read the run's jobs: `actions: read`), GITHUB_API_URL, GITHUB_REPOSITORY,
 * GITHUB_RUN_ID.
 *
 * It reads the latest attempt of each job (`filter=latest`), so a re-run of failed jobs sees the earlier attempt's
 * success. Exit status 0 when the job succeeded; 1 with an error annotation when it ended any other way (failed,
 * cancelled, skipped, timed out), was not listed, or did not end within the timeout; an API error is retried until
 * then, never read as success. Exit status 64 on a usage error.
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
    ({ values } = parseArgs({ options: { name: { type: 'string' }, timeout: { type: 'string' }, interval: { type: 'string', default: '3' } } }));
} catch (error) {
    usage(error.message);
}
if (!values.name) usage('--name is required');
if (!/^\d+$/.test(values.timeout ?? '')) usage('--timeout <seconds> is required');
if (!/^\d+(\.\d+)?$/.test(values.interval)) usage('--interval is a number of seconds');
const { GH_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env;
const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
if (!repository || !runId) usage('GITHUB_REPOSITORY and GITHUB_RUN_ID are required');

const timeout = Number(values.timeout) * 1000;
const interval = Number(values.interval) * 1000;
const begin = Date.now();
const elapsed = () => Math.round((Date.now() - begin) / 1000);

/** Every job of the run, latest attempt each, read page by page; throws on an API error. */
async function jobs() {
    const all = [];
    for (let page = 1; ; page++) {
        const response = await fetch(`${apiUrl}/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`, {
            headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`the API answered ${response.status}`);
        const body = await response.json();
        all.push(...(body.jobs ?? []));
        if (!body.jobs?.length || all.length >= (body.total_count ?? 0)) return all;
    }
}

let last = 'not listed';
while (Date.now() - begin < timeout) {
    try {
        const job = (await jobs()).find((j) => j.name === values.name);
        if (job && 'completed' === job.status) {
            if ('success' === job.conclusion) {
                console.log(`${values.name} succeeded (waited ${elapsed()} s)`);
                process.exit(0);
            }
            console.log(`::error::${values.name} ended ${job.conclusion}: this job cannot go on without its result`);
            process.exit(1);
        }
        last = job ? job.status : 'not listed';
    } catch (error) {
        last = error.message;
        console.log(`::warning::reading the run's jobs failed (${error.message}); retrying`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
}
console.log(`::error::${values.name} did not succeed within ${values.timeout} s (last seen: ${last})`);
process.exit(1);
