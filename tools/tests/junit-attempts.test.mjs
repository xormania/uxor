// The cases of tools/ci/junit-attempts.mjs: a PHPUnit or Node JUnit report turned into the failed-attempts.json Jev reads.
// Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptsOf } from '../ci/junit-attempts.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'tools/ci/junit-attempts.mjs');
const fixture = join(root, 'tools/tests/fixtures/junit/phpunit.xml');

function convert(report, env = {}, args = []) {
    const out = join(mkdtempSync(join(tmpdir(), 'junit-')), 'failed-attempts.json');
    const run = spawnSync(process.execPath, [script, report, out, ...args], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, GITHUB_SHA: 'abc', GITHUB_WORKSPACE: '/runner/work/flowbite-xor/flowbite-xor', ...env },
    });
    return { code: run.status, stderr: run.stderr, data: run.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) : null };
}

test('each failure and error becomes one attempt, with its test, file relative to the repository, line and message', () => {
    const { code, stderr, data } = convert(fixture);
    assert.equal(code, 0, stderr);
    assert.equal(data.schema, 1);
    assert.equal(data.status, 'valid');
    assert.equal(data.shard, 'phpunit');
    assert.deepEqual(data.counts, { passed: 2, failed: 2, flaky: 0, skipped: 0 });
    assert.deepEqual(data.attempts.map((a) => [a.project, a.file, a.line, a.title, a.status, a.outcome, a.retry]), [
        ['phpunit', 'demo/tests/DataTable/TableQueryTest.php', 34, 'TableQueryTest::testRejectsAnUnknownSort', 'failed', 'failed', 0],
        ['phpunit', 'demo/tests/Editor/HtmlPolicyTest.php', 12, 'HtmlPolicyTest::testStripsScript', 'failed', 'failed', 0],
    ]);
    assert.match(data.attempts[0].error, /Failed asserting that 'price' is identical to 'name'\./);
    // the frames name the repository's own paths, the runner's prefix removed
    assert.match(data.attempts[1].error, /^TypeError: .*clean\(\): Argument #1/m);
    assert.match(data.attempts[1].error, /\neditor\/src\/HtmlPolicy\.php:30\n/);
    assert.deepEqual(data.attempts[1].errorLocation, { file: 'editor/src/HtmlPolicy.php', line: 30, column: null });
    assert.equal(data.attempts[0].testId, 'App\\Tests\\DataTable\\TableQueryTest::testRejectsAnUnknownSort');
});

test('a report with no failure has no attempt; a missing or unreadable report is said so, not a pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'junit-'));
    const clean = join(dir, 'clean.xml');
    writeFileSync(clean, '<testsuites><testsuite name="s" tests="1"><testcase name="testA" file="/x/demo/tests/ATest.php" line="3" class="ATest"/></testsuite></testsuites>');
    const ok = convert(clean, { GITHUB_WORKSPACE: '/x' });
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(ok.data.attempts, []);
    assert.deepEqual(ok.data.counts, { passed: 1, failed: 0, flaky: 0, skipped: 0 });
    const missing = convert(join(dir, 'nope.xml'));
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /no JUnit report/);
});

// Node's built-in junit reporter (Tool tests: node --test --test-reporter=junit): no file or line attribute, a test
// inside its describe() and t.test() suites, attributes that hold a raw '>', and the location only in the stack
const nodeFixture = join(root, 'tools/tests/fixtures/junit/node-test.xml');

test("Node's JUnit: each failed test becomes one attempt, its file and line from the failure's stack", () => {
    const { code, stderr, data } = convert(nodeFixture, { GITHUB_WORKSPACE: '/home/runner/work/flowbite-xor/flowbite-xor' }, ['--project', 'node']);
    assert.equal(code, 0, stderr);
    assert.equal(data.shard, 'node');
    assert.deepEqual(data.projects, ['node']);
    assert.deepEqual(data.counts, { passed: 1, failed: 3, flaky: 0, skipped: 1 });
    assert.deepEqual(data.attempts.map((a) => [a.project, a.file, a.line, a.title]), [
        ['node', 'tools/tests/broken.test.mjs', null, 'tools/tests/broken.test.mjs'],
        ['node', 'tools/tests/release-notes.test.mjs', 5, 'the notes › keep the "Unreleased" <section> out'],
        ['node', 'tools/tests/release-notes.test.mjs', 7, 'the notes › name the tag › of a patch'],
    ]);
    // the assertion's own frame (the cause), not the frame of the t.test() call that wraps it
    assert.deepEqual(data.attempts.map((a) => a.errorLocation), [
        null,
        { file: 'tools/tests/release-notes.test.mjs', line: 5, column: 62 },
        { file: 'tools/tests/release-notes.test.mjs', line: 7, column: 46 },
    ]);
    assert.equal(data.attempts[2].testId, 'tools/tests/release-notes.test.mjs::the notes › name the tag › of a patch');
    assert.match(data.attempts[1].error, /^Error \[ERR_TEST_FAILURE\]: Expected values to be strictly equal:/);
    assert.match(data.attempts[2].error, /TypeError: Cannot read properties of undefined \(reading 'tag'\) & more/);
    // the runner's prefix and the file:// scheme removed, so the frames name the repository's paths
    for (const attempt of data.attempts) assert.doesNotMatch(attempt.error, /file:\/\/|\/home\/runner/);
    assert.match(data.attempts[1].error, /\(tools\/tests\/release-notes\.test\.mjs:5:62\)/);
});

test("a raw '>' inside a failure's message attribute does not cut the failure's text", () => {
    const xml = `<testsuites><testsuite name="s"><testcase name="compares markup" classname="test" file="tools/tests/x.test.mjs">
<failure message="Expected values to be strictly equal: '<section>' !== '<div>'" type="testCodeFailure">AssertionError: the real error
    at TestContext.&lt;anonymous&gt; (tools/tests/x.test.mjs:12:5)</failure>
</testcase></testsuite></testsuites>`;
    const { attempts } = attemptsOf(xml, '', 'node');
    assert.equal(attempts.length, 1);
    assert.match(attempts[0].error, /^AssertionError: the real error/);
    assert.doesNotMatch(attempts[0].error, /!==/);
});
