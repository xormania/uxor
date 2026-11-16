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

const job = (name, status, conclusion = null) => ({ name, status, conclusion });

/** A fake API answering each jobs request with the next of `pages` (the last one repeats); records the requests. */
async function api(pages) {
    const requests = [];
    const server = createServer((request, response) => {
        requests.push({ url: request.url, auth: request.headers.authorization });
        const page = pages[Math.min(requests.length - 1, pages.length - 1)];
        if ('number' === typeof page) {
            response.writeHead(page, { 'content-type': 'application/json' });
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
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script, ...args], {
            env: { ...process.env, GITHUB_API_URL: url, GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '42', GH_TOKEN: 'secret-token' },
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
    const flaky = await api([502, 403, { jobs: [job(NAME, 'completed', 'success')] }]);
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
