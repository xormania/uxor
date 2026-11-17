// The cases of tools/ci/wait-for-job.mjs: a job of the same run, found by its name through GitHub's API, waited for
// until it ends; only its success lets the waiting job go on. The API is a local server here.
// Run: node --test tools/tests/*.test.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/wait-for-job.mjs');
const NAME = 'Importmap packages';

const job = (name, status, conclusion = null, run_attempt = 1) => ({ name, status, conclusion, run_attempt });

/** A fake API answering each jobs request with the next of `pages` (the last one repeats); records the requests. */
async function api(pages) {
    const requests = [];
    const server = createServer((request, response) => {
        requests.push({ url: request.url, auth: request.headers.authorization, at: Date.now() });
        const page = pages[Math.min(requests.length - 1, pages.length - 1)];
        if ('number' === typeof page || page.status) {
            const status = 'number' === typeof page ? page : page.status;
            const headers = 'function' === typeof page.headers ? page.headers() : page.headers ?? {};
            response.writeHead(status, { 'content-type': 'application/json', ...headers });
            response.end('{"message":"nope"}');
            return;
        }
        const jobs = page.page2 && /[?&]page=2\b/.test(request.url) ? page.page2 : page.jobs;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ total_count: page.total ?? jobs.length, jobs }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

function wait(url, ...args) {
    // the run's attempt is set here, never inherited: in CI the tests themselves run in some attempt of a run
    const env = 'object' === typeof args.at(-1) ? args.pop() : {};
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script, ...args], {
            env: { ...process.env, GITHUB_API_URL: url, GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GH_TOKEN: 'secret-token', ...env },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

test('waits while the job is queued or running, and goes on when it succeeds', async (t) => {
    const server = await api([
        { jobs: [job('Changes', 'completed', 'success'), job(NAME, 'queued')] },
        { jobs: [job(NAME, 'in_progress')] },
        { jobs: [job(NAME, 'completed', 'success')] },
    ]);
    t.after(server.close);
    const result = await wait(server.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(server.requests.length, 3);
    assert.match(server.requests[0].url, /^\/repos\/owner\/repo\/actions\/runs\/42\/jobs\?.*filter=latest/, 'the latest attempt of each job, so a re-run of failed jobs sees the earlier success');
    assert.equal(server.requests[0].auth, 'Bearer secret-token');
    assert.doesNotMatch(result.stdout + result.stderr, /secret-token/);
});

test('a job that ends any other way fails the wait with an error naming it and its conclusion', async (t) => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
        const server = await api([{ jobs: [job(NAME, 'completed', conclusion)] }]);
        const result = await wait(server.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
        server.close();
        assert.equal(result.status, 1, conclusion);
        assert.match(result.stdout, new RegExp(`::error::${NAME} ended ${conclusion}`), conclusion);
    }
});

test('the job is found by its exact name on any page, never by position', async (t) => {
    const many = Array.from({ length: 100 }, (_, i) => job(`Demo + Playwright (chromium ${i + 1}/100)`, 'completed', 'failure'));
    const server = await api([{ total: 101, jobs: many, page2: [job(`${NAME} (old)`, 'completed', 'failure'), job(NAME, 'completed', 'success')] }]);
    t.after(server.close);
    const result = await wait(server.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(server.requests.some((r) => /[?&]page=2\b/.test(r.url)), 'the second page was read');
});

test('a job that is not listed or does not end in time fails at the bound', async (t) => {
    for (const pages of [[{ jobs: [job('Changes', 'completed', 'success')] }], [{ jobs: [job(NAME, 'in_progress')] }]]) {
        const server = await api(pages);
        const begin = Date.now();
        const result = await wait(server.url, '--name', NAME, '--timeout', '1', '--interval', '0.05');
        server.close();
        assert.equal(result.status, 1);
        assert.ok(Date.now() - begin < 10000, 'bounded');
        assert.match(result.stdout, new RegExp(`::error::${NAME} did not succeed within 1 s`));
    }
});

test('an API error is retried, and is never read as success', async (t) => {
    const flaky = await api([502, 503, { jobs: [job(NAME, 'completed', 'success')] }]);
    t.after(flaky.close);
    const recovered = await wait(flaky.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    assert.match(recovered.stdout, /::warning::.*502/);

    const down = await api([500]);
    t.after(down.close);
    const failed = await wait(down.url, '--name', NAME, '--timeout', '1', '--interval', '0.05');
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /::error::/);
});

test('a usage error exits 64', async () => {
    assert.equal((await wait('http://127.0.0.1:1', '--timeout', '1')).status, 64, 'no name');
    assert.equal((await wait('http://127.0.0.1:1', '--name', NAME, '--timeout', 'soon')).status, 64);
    assert.equal((await wait('http://127.0.0.1:1', '--name', NAME)).status, 64, 'no timeout');
});

test("ci.yml: every job that downloads the importmap packages without needing their job waits for it by its name first", async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const jobs = workflow.split(/\n(?= {4}[a-z0-9-]+:\n)/).slice(1).map((text) => ({
        id: text.match(/^ {4}([a-z0-9-]+):/)[1],
        text,
        name: text.match(/^ {8}name: (.+)$/m)?.[1] ?? '',
        needs: text.match(/^ {8}needs: (.+)$/m)?.[1] ?? '',
    }));
    const importmap = jobs.find((j) => j.id === 'importmap');
    assert.ok(importmap, 'the importmap job');
    const waiting = jobs.filter((j) => j.text.includes('name: importmap-packages') && !/\bimportmap\b/.test(j.needs) && j.id !== 'importmap');
    assert.ok(waiting.some((j) => j.id === 'demo'), 'the browser job no longer needs the importmap job');
    for (const j of waiting) {
        const steps = j.text.split(/\n(?= {12}- )/);
        const wait = steps.findIndex((s) => /run: node tools\/ci\/wait-for-job\.mjs/.test(s));
        const download = steps.findIndex((s) => s.includes('name: importmap-packages'));
        assert.ok(wait >= 0 && wait < download, `${j.id}: waits before it downloads`);
        assert.ok(steps[wait].includes(`--name '${importmap.name}'`), `${j.id}: waits for "${importmap.name}" by that name`);
        assert.match(steps[wait], /GH_TOKEN: \$\{\{ github\.token \}\}/, `${j.id}: reads the run's jobs with the job's own token`);
        assert.match(j.text, /^ {12}actions: read\b/m, `${j.id}: its token may read the run's jobs`);
    }
});

// the stack's review: items 3 (requests) and 7 (attempts)

test('the wait backs off, and gives up after its cap of requests (3)', async (t) => {
    const server = await api([{ jobs: [job(NAME, 'in_progress')] }]);
    t.after(server.close);
    const result = await wait(server.url, '--name', NAME, '--timeout', '60', '--interval', '0.05', '--max-interval', '0.4', '--max-requests', '6');
    assert.equal(result.status, 1);
    assert.equal(server.requests.length, 6, 'no request beyond the cap');
    assert.match(result.stdout, /::error::.*6 requests/);
    const gaps = server.requests.slice(1).map((r, i) => r.at - server.requests[i].at);
    assert.ok(gaps.at(-1) > gaps[0] * 2, `the interval grows (${gaps.join(', ')} ms)`);
});

test('a rate-limit answer waits for the reset the API reports, then asks again (3)', async (t) => {
    const reset = () => ({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 1) });
    const server = await api([{ status: 403, headers: reset }, { jobs: [job(NAME, 'completed', 'success')] }]);
    t.after(server.close);
    const result = await wait(server.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(server.requests.length, 2, 'no polling while limited');
    assert.ok(server.requests[1].at - server.requests[0].at >= 500, 'it waited for the reset');
    assert.match(result.stdout, /rate limit/i);
    // a 429 with retry-after the same way
    const later = await api([{ status: 429, headers: { 'retry-after': '1' } }, { jobs: [job(NAME, 'completed', 'success')] }]);
    t.after(later.close);
    const retried = await wait(later.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
    assert.equal(retried.status, 0, retried.stdout);
    assert.equal(later.requests.length, 2);
});

test('a sustained 403 ends the wait at once: a reset past the timeout, or no rate limit at all (3)', async (t) => {
    const far = await api([{ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 3600) } }]);
    t.after(far.close);
    const begin = Date.now();
    const limited = await wait(far.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
    assert.equal(limited.status, 1);
    assert.ok(Date.now() - begin < 5000, 'it does not sit out the hour');
    assert.equal(far.requests.length, 1);
    assert.match(limited.stdout, /::error::.*rate limit/i);
    const denied = await api([403]);
    t.after(denied.close);
    const refused = await wait(denied.url, '--name', NAME, '--timeout', '30', '--interval', '0.05');
    assert.equal(refused.status, 1);
    assert.equal(denied.requests.length, 1, 'a refusal is not retried');
    assert.match(refused.stdout, /::error::.*403/);
});

test("the job's result counts only from this attempt, or from an earlier one this attempt did not re-run (7)", async (t) => {
    // Re-run all jobs: Changes ran again in attempt 2, so the target will too; its attempt-1 success is not this attempt's
    const all = await api([
        { jobs: [job('Changes', 'completed', 'success', 2), job(NAME, 'completed', 'success', 1)] },
        { jobs: [job('Changes', 'completed', 'success', 2), job(NAME, 'in_progress', null, 2)] },
        { jobs: [job('Changes', 'completed', 'success', 2), job(NAME, 'completed', 'success', 2)] },
    ]);
    t.after(all.close);
    const rerunAll = await wait(all.url, '--name', NAME, '--timeout', '30', '--interval', '0.05', { GITHUB_RUN_ATTEMPT: '2' });
    assert.equal(rerunAll.status, 0, rerunAll.stdout);
    assert.equal(all.requests.length, 3, 'waited for attempt 2');
    // Re-run failed jobs: Changes and the target kept attempt 1's success
    const failed = await api([{ jobs: [job('Changes', 'completed', 'success', 1), job(NAME, 'completed', 'success', 1)] }]);
    t.after(failed.close);
    const rerunFailed = await wait(failed.url, '--name', NAME, '--timeout', '30', '--interval', '0.05', { GITHUB_RUN_ATTEMPT: '2' });
    assert.equal(rerunFailed.status, 0, rerunFailed.stdout);
    assert.equal(failed.requests.length, 1);
    // an earlier attempt's failure is re-run by this attempt: wait for its new result, do not fail on the old one
    const again = await api([
        { jobs: [job('Changes', 'completed', 'success', 1), job(NAME, 'completed', 'failure', 1)] },
        { jobs: [job('Changes', 'completed', 'success', 1), job(NAME, 'completed', 'success', 2)] },
    ]);
    t.after(again.close);
    const retried = await wait(again.url, '--name', NAME, '--timeout', '30', '--interval', '0.05', { GITHUB_RUN_ATTEMPT: '2' });
    assert.equal(retried.status, 0, retried.stdout);
    assert.equal(again.requests.length, 2);
});
