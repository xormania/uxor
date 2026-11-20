import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { assessComparison } from '../ci/jev-php-analysis.mjs';

const policy = JSON.parse(readFileSync(new URL('../ci/jev-ci.json', import.meta.url)));
const totals = () => ({
    true_positive: 3, true_negative: 4, miss: 1, false_positive: 0, tool_error_bad: 0, tool_error_good: 0,
});
function report() {
    const cases = ['return_type', 'nullable_receiver', 'symfony_argument', 'phpunit_narrowing'].map((id) => ({
        id,
        good: { tools: { phpstan: { status: 'pass' }, mago: { status: 'pass' } } },
        bad: { tools: {
            phpstan: { status: id === 'nullable_receiver' ? 'miss' : 'pass' },
            mago: { status: id === 'phpunit_narrowing' ? 'miss' : 'pass' },
        } },
    }));
    return { schema_version: 1, complete: true, runtime: { outcome: 'passed' }, cases, totals: { phpstan: totals(), mago: totals() } };
}

test('equal totals retain distinct fixture gaps without leaking arbitrary producer data', async (t) => {
    let received;
    let confidence = 0.96;
    const server = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk.toString();
        received = JSON.parse(body);
        const choices = Object.keys(received.questions.next_focus.criteria);
        const probabilities = Object.fromEntries(choices.map((choice) => [choice, Number(choice === 'phpunit_narrowing')]));
        res.end(JSON.stringify({ model: policy.model, answers: { next_focus: {
            type: 'choice', choice: 'phpunit_narrowing', probabilities, confidence,
        } }, usage: { input_tokens: 80, output_tokens: 3 } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const localPolicy = { ...policy, connection: { ...policy.connection, endpoint: `http://127.0.0.1:${server.address().port}/` } };
    const data = report();
    data.cases[0].bad.tools.phpstan.diagnostics = [{ message: 'UNTRUSTED_PAYLOAD', path: 'PRIVATE.php' }];
    data.totals.mago.message = 'UNTRUSTED_PAYLOAD';
    const result = await assessComparison(data, localPolicy, 'dummy-local-test');
    assert.equal(result.status, 'assessed');
    assert.equal(result.next_focus, 'phpunit_narrowing');
    assert.equal(result.confidence, 0.96);
    assert.deepEqual(received.state.totals, report().totals);
    assert.deepEqual(received.state.cases.nullable_receiver.phpstan, { bad: 'miss', good: 'pass' });
    assert.deepEqual(received.state.cases.phpunit_narrowing.mago, { bad: 'miss', good: 'pass' });
    assert.doesNotMatch(JSON.stringify(received), /UNTRUSTED_PAYLOAD|PRIVATE/);

    await t.test('the advisory focus requires the configured confidence, including the threshold itself', async () => {
        const threshold = policy.min_confidence;
        for (const [value, expectedFocus] of [[threshold, 'phpunit_narrowing'], [threshold - 0.01, 'unknown']]) {
            confidence = value;
            const response = await assessComparison(data, localPolicy, 'dummy-local-test');
            assert.equal(response.status, 'assessed');
            assert.equal(response.choice, 'phpunit_narrowing');
            assert.equal(response.confidence, value);
            assert.equal(response.next_focus, expectedFocus);
        }
    });
});

test('incomplete, forged and unavailable evidence never yields a model judgment', async () => {
    for (const corrupt of [
        (data) => { data.schema_version = 2; },
        (data) => { data.complete = 'yes'; },
        (data) => { delete data.runtime; },
        (data) => { delete data.totals.mago; },
        (data) => { data.cases[0].id = data.cases[1].id; },
        (data) => { data.cases[0].id = 'untrusted'; },
        (data) => { data.cases[0].bad.tools.mago.status = 'false-positive'; },
        (data) => { data.cases[0].good.tools.mago.status = 'miss'; },
        (data) => { data.cases[0].bad.tools.phpstan.status = 'miss'; },
        (data) => { data.cases[1].bad.tools.mago.status = { code: 'bad' }; },
        (data) => { data.totals.phpstan.miss = 6; },
        (data) => { data.totals.phpstan.true_positive = 2; },
        (data) => { data.totals.mago.true_negative = '4'; },
        (data) => { data.totals.mago.false_positive = -1; },
    ]) {
        const data = report();
        corrupt(data);
        assert.equal((await assessComparison(data, policy, '')).reason, 'invalid_evaluation');
    }
    const incomplete = report();
    incomplete.cases[0].bad.tools.mago.status = 'tool-error';
    incomplete.totals.mago.true_positive--;
    incomplete.totals.mago.tool_error_bad++;
    assert.equal((await assessComparison(incomplete, policy, '')).reason, 'tool_error');
    for (const [outcome, expected, complete] of [
        ['failed', 'runtime_failed', true], ['tool_error', 'runtime_error', false], ['passed', 'incomplete_evaluation', false],
    ]) {
        const data = report();
        data.runtime.outcome = outcome;
        data.complete = complete;
        assert.equal((await assessComparison(data, policy, '')).reason, expected);
    }
    assert.equal((await assessComparison(report(), policy, '')).reason, 'missing_credential');
    assert.equal((await assessComparison(report(), { ...policy, enabled: false }, '')).reason, 'disabled');
});

test('comparison consumer binds the input and output to one source run and attempt', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/jev.yml', import.meta.url), 'utf8');
    assert.match(workflow, /name: php-analysis-comparison-\$\{\{ github\.event\.workflow_run\.id \}\}-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}/);
    assert.match(workflow, /name: php-analysis-jev-\$\{\{ github\.event\.workflow_run\.id \}\}-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}/);
    assert.match(workflow, /github\.event\.workflow_run\.path == '\.github\/workflows\/php-analysis-comparison.yml'/);
    assert.match(workflow, /node trusted\/tools\/ci\/jev-php-analysis.mjs/);
    const credentialSteps = workflow.split(/\n            - /).filter((step) => step.includes('secrets.TYPESAFE_API_KEY'));
    assert.deepEqual(credentialSteps.map((step) => step.split('\n')[0]), ['name: Jev diagnosis', 'name: Evaluate PHP analyzer calibration']);
    assert.match(credentialSteps[1], /run:\s*\|\s+node trusted\/tools\/ci\/jev-php-analysis\.mjs "\$RUNNER_TEMP\/php-analysis-input\/evaluation\.json"/);
    assert.doesNotMatch(credentialSteps[1].split('run: |')[1], /\$\{\{|\b(?:eval|source|sh|bash)\b/);
});

test('offline CLI retains source IDs and explicit reasons for missing, unreadable or incomplete provider input', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-php-analysis-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const program = fileURLToPath(new URL('../ci/jev-php-analysis.mjs', import.meta.url));
    const output = join(dir, 'out/assessment.json');
    const env = { SOURCE_SHA: 'a'.repeat(40), SOURCE_RUN_ID: '1234', SOURCE_RUN_ATTEMPT: '2', GITHUB_REPOSITORY: 'owner/example' };
    const input = join(dir, 'evaluation.json');
    const link = join(dir, 'link');
    writeFileSync(input, JSON.stringify(report()));
    symlinkSync(input, link);
    for (const [file, reason] of [[link, 'invalid_evaluation'], [join(dir, 'absent'), 'missing_evaluation'], [input, 'missing_credential']]) {
        const run = spawnSync(process.execPath, [program, file, output], { env, encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        const result = JSON.parse(readFileSync(output));
        assert.equal(result.model, policy.model);
        assert.equal(result.rubric_version, 1);
        assert.equal(result.schema_version, 1);
        assert.equal(result.status, 'unavailable');
        assert.equal(result.reason, reason);
        assert.deepEqual(result.source, { repository: 'owner/example', sha: env.SOURCE_SHA, run_id: '1234', run_attempt: '2' });
    }
});
