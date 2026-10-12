// The cases of tools/ci/jev-diagnosis.mjs, run as CI runs it: a process reading a shard's failed-attempts.json, with
// a local HTTP server standing in for TypeSafe (the policy's endpoint pointed at it). These cases check the mechanics:
// what is sent, what is accepted, what is kept and that every failure path ends with exit status 0. Mocked answers
// say nothing about how well Jev diagnoses. Run: node --test tools/tests/*.test.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/jev-diagnosis.mjs');
const POLICY = JSON.parse(readFileSync(join(root, 'tools/ci/jev-ci.json'), 'utf8'));
const KEY = 'fixture-key-never-publish';
const CATEGORIES = ['environment_failure', 'product_defect', 'test_defect', 'timing_assertion', 'unknown'];
const START = '2026-10-09T12:00:10.000Z';

/** One failed attempt as tools/ci/playwright-summary.mjs writes it. */
function attempt(overrides = {}) {
    return {
        testId: 'aaa-111@smoke',
        specId: 'aaa-111',
        project: 'smoke',
        file: 'tests/e2e/lab.data-table-frame.spec.ts',
        line: 31,
        title: 'search, filter, sort, page and page size each add a history entry',
        titlePath: ['search, filter, sort, page and page size each add a history entry'],
        shard: '2/3',
        retry: 0,
        status: 'failed',
        outcome: 'flaky',
        durationMs: 4000,
        startTime: START,
        workerIndex: 0,
        error: 'Error: expect(page).toHaveURL(expected) failed\n\nExpected pattern: /size=10/\nReceived string: "https://localhost/lab/data-table-frame?size=25"',
        errorLocation: { file: 'tests/e2e/lab.data-table-frame.spec.ts', line: 52, column: 9 },
        ...overrides,
    };
}

function report(attempts, overrides = {}) {
    return {
        schema: 1, status: 'valid', reason: null, sha: 'a'.repeat(40), shard: '2/3', projects: ['smoke'],
        counts: { passed: 1, failed: 0, flaky: 1, skipped: 0 }, tests: [], attempts, globalErrors: [], ...overrides,
    };
}

/** A server log as `docker compose logs --timestamps php` prints it. */
function serverLog(lines) {
    return lines.map(([time, text]) => `php-1  | ${time} ${text}`).join('\n') + '\n';
}

function answer(question, choice, confidence) {
    const keys = Object.keys(question.criteria);
    const rest = 0.1 / (keys.length - 1);
    return { type: 'choice', choice, confidence, probabilities: Object.fromEntries(keys.map((key) => [key, key === choice ? 0.9 : rest])) };
}

/** A valid TypeSafe answer to the request it receives (the shape the reference's fixtures and validator use). */
function valid(request, { kind = 'timing_assertion', excerpt = 'excerpt_0', confidence = 0.9, excerptConfidence = confidence } = {}) {
    return {
        model: request.model,
        answers: {
            failure_kind: answer(request.questions.failure_kind, kind, confidence),
            causal_excerpt: answer(request.questions.causal_excerpt, excerpt, excerptConfidence),
        },
        usage: { input_tokens: 1200, output_tokens: 90 },
    };
}

const json = (status, value, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });

/**
 * Runs the tool on `attempts` with the default policy (changed by `policy`), the provider answered by `respond`
 * (request, index) => { status, headers, body } | 'hang'. Returns what it wrote and what the provider received.
 */
async function diagnose({ attempts = [attempt()], data, policy = (value) => value, respond = (request) => json(200, valid(request)), env = {}, log, args = [] } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'jev-diagnosis-'));
    const requests = [];
    const hanging = [];
    const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            requests.push({ method: req.method, url: req.url, headers: req.headers, raw, body: JSON.parse(raw) });
            const reply = respond(requests.at(-1).body, requests.length - 1);
            if (reply === 'hang') {
                hanging.push(res);
                return;
            }
            res.writeHead(reply.status, reply.headers ?? {});
            res.end(reply.body ?? '');
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;
    const settings = policy(structuredClone({ ...POLICY, connection: { ...POLICY.connection, endpoint } }));
    const policyFile = join(dir, 'jev-ci.json');
    writeFileSync(policyFile, typeof settings === 'string' ? settings : JSON.stringify(settings));
    const attemptsFile = join(dir, 'failed-attempts.json');
    if (data !== null) {
        writeFileSync(attemptsFile, typeof data === 'string' ? data : JSON.stringify(data ?? report(attempts)));
    }
    const logFile = join(dir, 'server.log');
    if (log !== undefined) {
        writeFileSync(logFile, log);
    }
    const output = join(dir, 'jev');
    const stepSummary = join(dir, 'step-summary.md');
    writeFileSync(stepSummary, '');
    const started = Date.now();
    const run = await new Promise((resolve) => {
        const child = spawn(process.execPath, [script, '--attempts', attemptsFile, '--output', output, '--config', policyFile,
            ...(log !== undefined ? ['--server-log', logFile] : []), ...args], {
            env: {
                PATH: process.env.PATH,
                GITHUB_ACTIONS: 'true',
                GITHUB_STEP_SUMMARY: stepSummary,
                GITHUB_REPOSITORY: 'xormania/uxor',
                GITHUB_SHA: 'a'.repeat(40),
                GITHUB_RUN_ID: '123',
                GITHUB_RUN_ATTEMPT: '2',
                SHARD: '2/3',
                TYPESAFE_API_KEY: KEY,
                ...env,
            },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        const timer = setTimeout(() => child.kill(), 30000); // a hung tool fails its case instead of the suite
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    for (const res of hanging) res.destroy();
    server.close();
    const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
    const attemptsDir = join(output, 'attempts');
    const assessments = existsSync(attemptsDir)
        ? readdirSync(attemptsDir).sort().map((name) => JSON.parse(readFileSync(join(attemptsDir, name, 'assessment.json'), 'utf8')))
        : [];
    const written = [];
    const walk = (path) => {
        if (!existsSync(path)) return;
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const full = join(path, entry.name);
            entry.isDirectory() ? walk(full) : written.push(readFileSync(full, 'utf8'));
        }
    };
    walk(output);
    return {
        ...run,
        seconds: (Date.now() - started) / 1000,
        requests,
        assessments,
        summary: read(join(output, 'summary.md')),
        stepSummary: read(stepSummary),
        written: written.join('\n'),
        warnings: run.stdout.split('\n').filter((line) => line.startsWith('::warning ')),
    };
}

test('a valid answer: two Choice questions on bounded excerpts, the selected text kept as it was, a warning at the failing line', async () => {
    const log = serverLog([
        ['2026-10-09T12:00:01.000000000Z', '{"level":"info","msg":"GET /lab/other 200"}'],
        ['2026-10-09T12:00:11.500000000Z', '{"level":"error","msg":"Uncaught exception in /lab/data-table-frame <script>"}'],
        ['2026-10-09T12:00:30.000000000Z', '{"level":"error","msg":"timeout in an unrelated test"}'],
    ]);
    const run = await diagnose({ log, respond: (request) => json(200, valid(request, { excerpt: 'excerpt_1' })) });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.requests.length, 1);
    const [{ method, url, headers, body }] = run.requests;
    assert.equal(method, 'POST');
    assert.equal(url, '/v1/systemone');
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers.accept, 'application/json');
    assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state']);
    assert.equal(body.model, 'jev-1.13.0');
    assert.deepEqual(Object.keys(body.questions).sort(), ['causal_excerpt', 'failure_kind']);
    assert.equal(body.questions.failure_kind.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.failure_kind.criteria), CATEGORIES);
    assert.match(body.questions.failure_kind.instructions, /A timeout or assertion alone does not prove an environment problem or flaky test/);
    assert.equal(body.questions.causal_excerpt.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.causal_excerpt.criteria), ['excerpt_0', 'excerpt_1', 'none']);
    assert.equal(body.questions.causal_excerpt.criteria.excerpt_0, 'Supplied test error lines 1-4');
    assert.equal(body.questions.causal_excerpt.criteria.excerpt_1, 'Supplied server log lines 2-2');
    // the test's identity and only the server log lines inside the attempt's time span
    assert.equal(body.state.test.file, 'tests/e2e/lab.data-table-frame.spec.ts');
    assert.equal(body.state.test.retry, 0);
    assert.equal(body.state.test.outcome, 'flaky');
    assert.equal(body.state.sources.server_log.selection, 'attempt_window');
    assert.deepEqual(body.state.candidates.map((candidate) => candidate.source), ['test_error', 'server_log']);
    assert.doesNotMatch(JSON.stringify(body.state), /unrelated test|GET \/lab\/other/);

    assert.equal(run.assessments.length, 1);
    const [assessment] = run.assessments;
    assert.equal(assessment.status, 'assessed', JSON.stringify(assessment));
    assert.equal(assessment.likely_cause, 'timing_assertion');
    assert.equal(assessment.selected_excerpt.id, 'excerpt_1');
    assert.equal(assessment.selected_excerpt.text, log.split('\n')[1]);
    assert.deepEqual(assessment.request, body);
    assert.deepEqual(assessment.response.usage, { input_tokens: 1200, output_tokens: 90 });
    assert.match(assessment.input_sha256, /^[0-9a-f]{64}$/);
    assert.equal(assessment.policy.model, 'jev-1.13.0');
    assert.equal(assessment.context.GITHUB_RUN_ID, '123');
    assert.equal(assessment.attempt.retry, 0);

    assert.equal(run.warnings.length, 1);
    const [warning] = run.warnings;
    assert.match(warning, /^::warning file=tests\/e2e\/lab\.data-table-frame\.spec\.ts,line=52,col=9,title=Jev diagnosis/);
    assert.match(warning, /timing_assertion \(classifier confidence 0\.90\)/);
    assert.match(warning, /server log lines 2-2/);
    assert.match(run.summary, /### Jev diagnosis, shard 2\/3/);
    assert.match(run.summary, /timing_assertion/);
    assert.match(run.summary, /&lt;script&gt;/);
    assert.ok(!run.summary.toLowerCase().includes('<script'), 'no raw script tag, whatever its case');
    assert.ok(run.stepSummary.includes(run.summary), 'the section is added to the job summary');
});

test('low confidence: the category is shown as unknown and no excerpt is selected; the answer is kept', async () => {
    const run = await diagnose({ respond: (request) => json(200, valid(request, { kind: 'product_defect', confidence: 0.64 })) });
    assert.equal(run.code, 0, run.stderr);
    const [assessment] = run.assessments;
    assert.equal(assessment.status, 'assessed');
    assert.equal(assessment.likely_cause, 'unknown');
    assert.equal(assessment.selected_excerpt, null);
    assert.equal(assessment.response.answers.failure_kind.choice, 'product_defect');
    assert.match(run.warnings[0], /unknown \(classifier confidence 0\.64\)/);
    assert.match(run.warnings[0], /no excerpt selected/i);
});

test('an invalid answer is never used: each one is an unavailable assessment, exit 0', async () => {
    const cases = {
        model_mismatch: (request) => ({ ...valid(request), model: 'jev-1.12.0' }),
        incomplete_evaluation: (request) => { const value = valid(request); delete value.answers.causal_excerpt; return value; },
        extra_question: (request) => { const value = valid(request); value.answers.other = value.answers.failure_kind; return value; },
        choice_not_allowed: (request) => { const value = valid(request); value.answers.failure_kind.choice = 'flaky'; return value; },
        excerpt_not_supplied: (request) => { const value = valid(request); value.answers.causal_excerpt.choice = 'excerpt_9'; return value; },
        probabilities_not_summing: (request) => { const value = valid(request); value.answers.failure_kind.probabilities.unknown = 0.5; return value; },
        probability_missing_choice: (request) => { const value = valid(request); delete value.answers.failure_kind.probabilities.unknown; return value; },
        confidence_out_of_bounds: (request) => { const value = valid(request); value.answers.failure_kind.confidence = 1.2; return value; },
        answer_type: (request) => { const value = valid(request); value.answers.failure_kind.type = 'score'; return value; },
        negative_usage: (request) => ({ ...valid(request), usage: { input_tokens: -1, output_tokens: 90 } }),
        fractional_usage: (request) => ({ ...valid(request), usage: { input_tokens: 1.5, output_tokens: 90 } }),
    };
    const raw = {
        nan: (request) => JSON.stringify(valid(request)).replace('"confidence":0.9', '"confidence":NaN'),
        infinite: (request) => JSON.stringify(valid(request)).replace('"confidence":0.9', '"confidence":1e999'),
        not_json: () => 'not json',
    };
    const responders = {
        ...Object.fromEntries(Object.entries(cases).map(([name, make]) => [name, (request) => json(200, make(request))])),
        ...Object.fromEntries(Object.entries(raw).map(([name, make]) => [name, (request) => ({ status: 200, body: make(request) })])),
    };
    for (const [name, respond] of Object.entries(responders)) {
        const run = await diagnose({ respond });
        assert.equal(run.code, 0, `${name}: ${run.stderr}`);
        const [assessment] = run.assessments;
        assert.equal(assessment.status, 'unavailable', `${name}: ${JSON.stringify(assessment)}`);
        assert.equal(assessment.reason, 'invalid_response', name);
        assert.equal(assessment.response, undefined, `${name}: an invalid answer is not kept as the response`);
        assert.equal(run.warnings.length, 0, `${name}: no diagnosis is shown`);
        assert.match(run.summary, /unavailable \(invalid_response/, name);
    }
});

test('429 then a valid answer: one bounded retry; a long Retry-After or a 500 is not retried', async () => {
    const retried = await diagnose({ respond: (request, index) => (index === 0 ? json(429, {}, { 'retry-after': '0' }) : json(200, valid(request))) });
    assert.equal(retried.code, 0, retried.stderr);
    assert.equal(retried.requests.length, 2);
    assert.equal(retried.assessments[0].status, 'assessed');

    const longWait = await diagnose({ respond: () => json(429, {}, { 'retry-after': '60' }) });
    assert.equal(longWait.code, 0, longWait.stderr);
    assert.equal(longWait.requests.length, 1);
    assert.equal(longWait.assessments[0].status, 'unavailable');
    assert.equal(longWait.assessments[0].reason, 'provider_http_error');
    assert.equal(longWait.assessments[0].details.status, 429);

    const always = await diagnose({ respond: () => json(429, {}, { 'retry-after': '0' }) });
    assert.equal(always.requests.length, 2, 'at most max_attempts requests');
    assert.equal(always.assessments[0].reason, 'provider_http_error');

    const serverError = await diagnose({ respond: () => json(500, {}) });
    assert.equal(serverError.requests.length, 1);
    assert.equal(serverError.assessments[0].details.status, 500);
});

test('a provider that does not answer: unavailable after the timeout, not retried', async () => {
    const run = await diagnose({ policy: (value) => ({ ...value, transport: { ...value.transport, timeout: 0.3 } }), respond: () => 'hang' });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.requests.length, 1);
    assert.equal(run.assessments[0].status, 'unavailable');
    assert.equal(run.assessments[0].reason, 'transport_unavailable');
    assert.ok(run.seconds < 5, `bounded by the timeout (${run.seconds} s)`);
});

test('the total time budget: attempts left when it runs out are not assessed', async () => {
    const run = await diagnose({
        attempts: [attempt(), attempt({ testId: 'bbb@smoke', specId: 'bbb' }), attempt({ testId: 'ccc@smoke', specId: 'ccc' })],
        policy: (value) => ({ ...value, transport: { ...value.transport, timeout: 0.6 }, limits: { ...value.limits, total_seconds: 1 } }),
        respond: () => 'hang',
    });
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(run.assessments.map((a) => a.status), ['unavailable', 'unavailable', 'not_assessed']);
    assert.equal(run.assessments[2].reason, 'deadline');
    assert.ok(run.seconds < 5, `${run.seconds} s`);
});

test('no secret: an unavailable assessment per attempt, nothing sent, exit 0', async () => {
    const run = await diagnose({ env: { TYPESAFE_API_KEY: '' }, attempts: [attempt(), attempt({ retry: 1 })] });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.requests.length, 0);
    assert.deepEqual(run.assessments.map((a) => [a.status, a.reason]), [['unavailable', 'missing_credential'], ['unavailable', 'missing_credential']]);
    assert.equal(run.warnings.length, 0);
    assert.match(run.summary, /unavailable \(missing_credential\)/);
});

test('disabled by the policy: a disabled assessment, nothing sent', async () => {
    const run = await diagnose({ policy: (value) => ({ ...value, enabled: false }) });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.requests.length, 0);
    assert.equal(run.assessments[0].status, 'disabled');
});

test('sanitized before it leaves: the key, other secrets in the environment, bearer strings and sensitive fields', async () => {
    const error = `Error: request failed\nAuthorization: Bearer abc.DEF-ghi_123\nkey was ${KEY} and ${'other-secret-value'}`;
    const log = serverLog([['2026-10-09T12:00:11.000000000Z', '{"level":"error","msg":"login failed","password":"hunter2-hunter2","context":{"api_key":"xyz-123"}}']]);
    const run = await diagnose({
        attempts: [attempt({ error })], log, env: { DEPLOY_API_KEY: 'other-secret-value' },
        respond: (request) => json(200, valid(request, { excerpt: 'excerpt_0' })),
    });
    assert.equal(run.code, 0, run.stderr);
    const sent = run.requests[0].raw;
    for (const text of [sent, run.written, run.stdout, run.stepSummary]) {
        assert.ok(!text.includes(KEY), 'the key is never sent or written');
        assert.ok(!text.includes('other-secret-value'), 'a secret from the environment is never sent or written');
        assert.ok(!text.includes('abc.DEF-ghi_123'), 'a bearer token is never sent or written');
        assert.ok(!text.includes('hunter2-hunter2') && !text.includes('xyz-123'), 'sensitive fields are never sent or written');
    }
    assert.match(sent, /Bearer \[REDACTED\]/);
    assert.match(sent, /\[REDACTED\]/);
    assert.equal(run.assessments[0].status, 'assessed');

    // a key whose variable name the environment filter does not recognize is still never sent: it is a known secret
    const unnamed = await diagnose({
        attempts: [attempt({ error: 'Error: provider said jev-unlisted-key-value' })],
        policy: (value) => ({ ...value, connection: { ...value.connection, credential: { env: 'JEV_PROVIDER' } } }),
        env: { TYPESAFE_API_KEY: '', JEV_PROVIDER: 'jev-unlisted-key-value' },
    });
    assert.equal(unnamed.requests[0].headers.authorization, 'Bearer jev-unlisted-key-value');
    for (const text of [unnamed.requests[0].raw, unnamed.written, unnamed.stdout]) {
        assert.ok(!text.includes('jev-unlisted-key-value'), 'the key is never sent or written');
    }
});

test('a request over the budget drops server log excerpts first, then error excerpts, and says so', async () => {
    const error = Array.from({ length: 60 }, (_, i) => `Error: step ${i} failed ${'x'.repeat(200)}`).join('\n');
    const log = serverLog(Array.from({ length: 40 }, (_, i) => [`2026-10-09T12:00:1${i % 4}.000000000Z`, `{"level":"error","msg":"exception ${i} ${'y'.repeat(300)}"}`]));
    const run = await diagnose({ attempts: [attempt({ error })], log, policy: (value) => ({ ...value, transport: { ...value.transport, max_request_bytes: 9000 } }) });
    assert.equal(run.code, 0, run.stderr);
    const [{ raw, body }] = run.requests;
    assert.ok(Buffer.byteLength(raw) <= 9000, `${Buffer.byteLength(raw)} bytes`);
    assert.ok(body.state.candidates.some((candidate) => candidate.source === 'test_error'), 'the error itself is kept');
    assert.ok(body.state.sources.server_log.omitted_candidates > 0);
    assert.ok(body.state.candidates.every((candidate) => candidate.source === 'test_error') || body.state.sources.test_error.omitted_candidates === 0,
        'error excerpts are dropped only once no server log excerpt is left');
    assert.ok(body.state.candidates.length >= 1);
    assert.equal(run.assessments[0].status, 'assessed');

    const tooSmall = await diagnose({ attempts: [attempt({ error })], policy: (value) => ({ ...value, transport: { ...value.transport, max_request_bytes: 1000 } }) });
    assert.equal(tooSmall.code, 0, tooSmall.stderr);
    assert.equal(tooSmall.requests.length, 0);
    assert.equal(tooSmall.assessments[0].status, 'unavailable');
    assert.equal(tooSmall.assessments[0].reason, 'request_budget_exceeded');
});

test('the per-shard cap: the first attempts of each test first, the rest reported as not assessed', async () => {
    const attempts = [];
    for (let i = 0; i < 6; i++) {
        attempts.push(attempt({ testId: `t${i}@smoke`, specId: `t${i}`, title: `test ${i}`, retry: 0, outcome: 'failed' }));
        attempts.push(attempt({ testId: `t${i}@smoke`, specId: `t${i}`, title: `test ${i}`, retry: 1, outcome: 'failed' }));
    }
    const run = await diagnose({ attempts });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.requests.length, 10);
    assert.equal(run.assessments.length, 12);
    assert.equal(run.assessments.filter((a) => a.status === 'assessed').length, 10);
    const skipped = run.assessments.filter((a) => a.status === 'not_assessed');
    assert.deepEqual(skipped.map((a) => [a.reason, a.attempt.retry]), [['cap', 1], ['cap', 1]]);
    assert.deepEqual(run.requests.slice(0, 6).map((r) => r.body.state.test.retry), [0, 0, 0, 0, 0, 0]);
    assert.equal(run.warnings.length, 10);
    assert.equal((run.summary.match(/not assessed: cap/g) ?? []).length, 2);
});

test('nothing to read or a broken setup still ends with exit status 0', async () => {
    const cases = {
        'no failed-attempts.json': { data: null },
        'failed-attempts.json does not parse': { data: '{' },
        'no valid report': { data: report([], { status: 'missing' }) },
        'no failed attempt': { data: report([]) },
        'invalid policy': { policy: () => '{"version": 2}' },
        'policy not JSON': { policy: () => 'nope' },
        'endpoint not HTTPS': { policy: (value) => ({ ...value, connection: { ...value.connection, endpoint: 'http://example.com/v1/systemone' } }) },
        'output cannot be written': { args: ['--output', '/dev/null/jev'] },
    };
    for (const [name, options] of Object.entries(cases)) {
        const run = await diagnose(options);
        assert.equal(run.code, 0, `${name}: ${run.stderr}`);
        assert.equal(run.requests.length, 0, name);
        assert.equal(run.stderr, '', `${name}: no crash`);
    }
    for (const policy of [() => '{"version": 2}', (value) => ({ ...value, connection: { ...value.connection, endpoint: 'http://example.com/v1/systemone' } })]) {
        const invalid = await diagnose({ policy });
        assert.equal(invalid.assessments[0].status, 'unavailable');
        assert.equal(invalid.assessments[0].reason, 'invalid_policy', 'the key goes to an HTTPS endpoint only');
    }
});
