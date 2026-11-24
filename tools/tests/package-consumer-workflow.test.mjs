// Exercise the Package job's real shell commands with external programs replaced by recording stubs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stepIn } from '../ci/step-attempts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const consumer = 'packages/uxor/dev';
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const recordingStub = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { basename } = require('node:path');
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.CONSUMER_TEST_LOG, JSON.stringify({
    tool, args, cwd: process.cwd(), browserEndpoint: process.env.PW_BROWSER_WS_ENDPOINT,
}) + '\\n');
if (tool === 'curl') process.stdout.write('200');
if (tool === 'docker' && args[0] === 'run') process.stdout.write('test-browser');
if (tool === 'npm' && args[0] === 'run' && args[1] === process.env.CONSUMER_TEST_FAIL_SCRIPT) {
    process.exit(7);
}
`;

function runStep(t, id, failingScript = '', job = 'package') {
    const step = stepIn(workflow, job, id);
    assert.ok(step?.run, `${job} runs the ${id} step`);
    const lines = workflow.split('\n');
    const runLine = step.line - 1;
    const stepStart = lines.slice(0, runLine).findLastIndex((line) => /^ {12}- /.test(line));
    const stepEnd = lines.findIndex((line, index) => index > runLine && /^ {0,12}\S/.test(line));
    const stepSource = lines.slice(stepStart, stepEnd < 0 ? lines.length : stepEnd).join('\n');
    const directory = stepSource.match(/^ {14}working-directory:\s*(\S+)\s*$/m)?.[1] ?? '.';
    assert.doesNotMatch(stepSource, /^ {14}continue-on-error: true\s*$/m);

    const scratch = mkdtempSync(join(tmpdir(), 'uxor-package-workflow-test-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const log = join(scratch, 'commands.log');
    writeFileSync(log, '');
    for (const tool of ['npm', 'npx', 'python3', 'php', 'composer', 'ss', 'docker', 'curl']) {
        writeFileSync(join(scratch, tool), recordingStub, { mode: 0o755 });
    }
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {
        cwd: resolve(root, directory),
        encoding: 'utf8',
        env: {
            PATH: `${scratch}:${process.env.PATH}`,
            RUNNER_TEMP: scratch,
            CONSUMER_TEST_LOG: log,
            CONSUMER_TEST_FAIL_SCRIPT: failingScript,
        },
        timeout: 15_000,
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { result, calls };
}

test('Package installs the independent consumer client from its lock', (t) => {
    const { result, calls } = runStep(t, 'consumer-browser-install');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls.map(({ tool, args, cwd }) => [tool, args.slice(0, 1), cwd]), [
        ['npm', ['ci'], join(root, consumer)],
    ]);
});

test('Static site uses the root lock and its pinned browser while testing navigation', (t) => {
    const install = runStep(t, 'website-browser-install', '', 'static-site');
    assert.equal(install.result.status, 0, install.result.stderr);
    assert.deepEqual(install.calls.map(({ tool, args }) => [tool, args]), [['npm', ['ci', '--no-audit', '--no-fund']]]);

    const navigation = runStep(t, 'navigation', '', 'static-site');
    assert.equal(navigation.result.status, 0, navigation.result.stderr);
    const image = JSON.parse(readFileSync(join(root, 'tools/playwright-image.json'), 'utf8')).image;
    const browser = navigation.calls.find(({ tool, args }) => tool === 'docker' && 'run' === args[0]);
    assert.ok(browser?.args.includes(image));
    assert.ok(browser.args.includes(`type=bind,source=${join(root, 'node_modules')},target=/opt/browser/node_modules,readonly`));
    const testClient = navigation.calls.find(({ tool }) => tool === 'npx');
    assert.deepEqual(testClient?.args, ['playwright', 'test', '--config=website/playwright.config.ts']);
    assert.equal(testClient.browserEndpoint, 'ws://127.0.0.1:3000/');
    assert.deepEqual(navigation.calls.at(-1).args, ['rm', '-f', 'test-browser']);
});

test('Package prepares, installs, and exercises the customer app before checking the no-dev runtime', (t) => {
    const { result, calls } = runStep(t, 'consumer-workflow');
    assert.equal(result.status, 0, result.stderr);
    const commands = calls.map(({ tool, args }) => [tool, ...args].join(' '));
    const image = readFileSync(join(root, 'packages/uxor/resources/browser/Dockerfile'), 'utf8').split('\n')[0].split(' ')[1];
    const browserServer = calls.find(({ tool, args }) => tool === 'docker' && 'run' === args[0]);
    assert.ok(browserServer?.args.includes(image));
    assert.ok(browserServer.args.includes(`type=bind,source=${join(root, consumer, 'node_modules')},target=/opt/browser/node_modules,readonly`));

    const prepare = commands.findIndex((command) => /run\.py .*--native.*\bprepare\b/.test(command));
    const nativeRecorder = commands.findIndex((command) => /check-headless\.py\b/.test(command) && !command.includes('--docker'));
    const install = commands.findIndex((command) => /install-uxor\.py\b/.test(command));
    const requestOnly = commands.indexOf('npm run test:request-only');
    const browser = commands.indexOf('npm run test:workflow');
    const noDev = commands.findIndex((command) => /\bcomposer (?:[^ ]+ )*install\b.*--no-dev/.test(command));
    const cache = commands.findIndex((command) => /\b(?:bin\/console )?cache:clear\b.*--env[= ]prod/.test(command));
    const runtime = commands.findIndex((command) => /check-workflow-runtime\.php\b/.test(command));

    const sequence = [prepare, nativeRecorder, install, requestOnly, browser, noDev, cache, runtime];
    assert.ok(sequence.every((index, at) => index >= 0 && (at === 0 || index > sequence[at - 1])), commands.join('\n'));
    assert.equal(calls[requestOnly].cwd, join(root, consumer));
    assert.equal(calls[browser].cwd, join(root, consumer));
    assert.equal(calls[browser].browserEndpoint, 'ws://127.0.0.1:3000/');
    assert.deepEqual(calls.at(-1).args, ['rm', '-f', 'test-browser']);
});

for (const script of ['test:request-only', 'test:workflow']) {
    test(`a failing ${script} stops the Package step`, (t) => {
        const { result, calls } = runStep(t, 'consumer-workflow', script);
        assert.equal(result.status, 7, result.stdout);
        const last = calls.findLast(({ tool }) => tool !== 'docker');
        assert.equal(last.tool, 'npm');
        assert.deepEqual(last.args, ['run', script]);
        assert.deepEqual(calls.at(-1).args, ['rm', '-f', 'test-browser']);
    });
}

function assertPackageSelection(cwd, path, expected) {
    const result = spawnSync('bash', [join(root, 'tools/ci-changes.sh')], { cwd, input: path + '\n', encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.split('\n').includes(`package=${expected}`), `Package selection for ${path}:\n${result.stdout}`);
}

test('the Package lane follows consumer fixture and installed recipe sources', () => {
    const changed = new Map([
        ['packages/uxor/dev/app/src/Controller/CustomerController.php', true],
        ['packages/uxor/dev/package-lock.json', true],
        ['packages/uxor/dev/e2e/customer-workflow.spec.mjs', true],
        ['data-table/templates/components/DataTable.html.twig', true],
        ['pagination/templates/components/Pagination.html.twig', true],
        ['alert/templates/components/Alert.html.twig', false],
        ['docs/NOTES.md', false],
    ]);
    for (const [path, expected] of changed) {
        assertPackageSelection(root, path, expected);
    }
});

test('noncanonical copy source syntax cannot omit a customer workflow payload from Package', (t) => {
    const scratch = mkdtempSync(join(tmpdir(), 'uxor-consumer-selection-test-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    mkdirSync(join(scratch, consumer), { recursive: true });
    // The recipes exercised by the workflow are fixed even before the selector understands this file.
    const roots = 'workflow-recipes.json';
    const rootList = join(root, consumer, roots);
    writeFileSync(join(scratch, consumer, roots), existsSync(rootList)
        ? readFileSync(rootList) : JSON.stringify(['theme', 'data-table', 'modal', 'toast', 'form-theme']));
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const source = join(root, entry.name, 'manifest.json');
        if (entry.isDirectory() && existsSync(source)) {
            mkdirSync(join(scratch, entry.name));
            cpSync(source, join(scratch, entry.name, 'manifest.json'));
        }
    }

    const manifestPath = join(scratch, 'toast', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete manifest['copy-files']['assets/'];
    manifest['copy-files']['assets/./controllers//'] = 'assets/controllers/';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    assertPackageSelection(scratch, 'toast/assets/controllers/toast_controller.js', true);
});
