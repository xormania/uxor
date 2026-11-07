// Exercise audit.yml's project selection and locked Composer/npm audits on isolated Git repositories and runners.
// Run: node --test tools/tests/dependency-audit.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stepIn } from '../ci/step-attempts.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflowPath = '.github/workflows/audit.yml';
const workflow = readFileSync(join(root, workflowPath), 'utf8');
const dependabot = readFileSync(join(root, '.github/dependabot.yml'), 'utf8');

// Read this repository's job/step layout, not YAML at large. The executed scripts come from the shared reader.
function jobText(name) {
    const match = new RegExp(`^    ${name}:\\n([\\s\\S]*?)(?=^    [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm').exec(workflow);
    assert.ok(match, `job ${name} exists`);
    return match[1];
}

function steps(job) {
    return jobText(job).split(/^ {12}- /m).slice(1);
}

function property(text, name, depth) {
    const value = new RegExp(`^ {${depth}}${name}: (.*)$`, 'm').exec(text)?.[1];
    return value?.replace(/\s+#.*$/, '').trim();
}

function stepText(job, id) {
    const step = steps(job).find((text) => new RegExp(`^(?:id: ${id}$| {14}id: ${id}$)`, 'm').test(text));
    assert.ok(step, `step ${job}/${id} exists`);
    return step;
}

const ecosystems = [
    { name: 'Composer', tool: 'composer', job: 'composer-audit', manifest: 'composer.json', lock: 'composer.lock', args: ['audit', '--locked'], installed: 'vendor' },
    { name: 'npm', tool: 'npm', job: 'npm-audit', manifest: 'package.json', lock: 'package-lock.json', args: ['audit', '--package-lock-only'], installed: 'node_modules' },
].map((ecosystem) => ({
    ...ecosystem,
    projects: [...jobText(ecosystem.job).matchAll(/^ {20}- project: (\S+)\n {22}directory: (\S+)$/gm)]
        .map(([, project, directory]) => ({ project, directory })),
}));
const projectFiles = ({ manifest, lock }, directory) => [manifest, lock].map((name) => posix.join(directory, name));
const allProjectFiles = ecosystems.flatMap((ecosystem) => ecosystem.projects.flatMap(({ directory }) => projectFiles(ecosystem, directory)));
const updates = dependabot.split(/^ {4}- package-ecosystem: /m).slice(1);

function git(cwd, ...args) {
    const run = spawnSync('git', [
        '-c', 'user.name=xor', '-c', 'user.email=127287135+xormania@users.noreply.github.com',
        '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args,
    ], { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
}

function scratch(t) {
    const dir = mkdtempSync(join(tmpdir(), 'dependency-audit-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function shell(script, cwd, env) {
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
        cwd, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 10000,
    });
}

// Only the event, changed-output and status conditions used by this workflow; reject anything unrecognized.
function holds(condition, { event, files = '', failed = false }) {
    assert.ok(condition, 'an explicit audit guard exists');
    const atom = (text) => {
        const comparison = /^github\.event_name (==|!=) '([^']+)'$/.exec(text.trim());
        if (comparison) return comparison[1] === '==' ? event === comparison[2] : event !== comparison[2];
        if (text.trim() === 'steps.changed.outputs.files') return Boolean(files);
        if (text.trim() === 'failure()') return failed;
        assert.fail(`unsupported audit condition: ${text}`);
    };
    return condition.split(/\s*\|\|\s*/).some((term) => atom(term));
}

for (const ecosystem of ecosystems) {
    const { name, tool, job, projects, lock } = ecosystem;

test(`every tracked ${name} lock has an audit lane and weekly Dependabot updates targeting dev`, () => {
    const trackedLocks = git(root, 'ls-files', `*${lock}`).split('\n').filter(Boolean);
    const directories = trackedLocks.map((path) => posix.dirname(path)).sort();
    assert.ok(directories.length > 0);
    assert.equal(new Set(projects.map(({ project }) => project)).size, projects.length, 'unique project labels');
    assert.deepEqual(projects.map(({ directory }) => directory).sort(), directories, 'no unaudited or duplicate lock directories');

    const entries = updates.filter((entry) => entry.startsWith(`${tool}\n`));
    assert.deepEqual(entries.map((entry) => property(entry, 'directory', 6)?.replace(/^\/$/, '.').replace(/^\//, '')).sort(), directories);
    for (const entry of entries) {
        assert.equal(property(entry, 'target-branch', 6), 'dev');
        assert.match(entry, /^ {6}schedule:\n {10}interval: weekly$/m);
    }

    const paths = workflow.slice(workflow.indexOf('    pull_request:'), workflow.indexOf('    workflow_dispatch:'));
    for (const path of [...projects.flatMap(({ directory }) => projectFiles(ecosystem, directory)), workflowPath]) {
        assert.ok(paths.split('\n').some((line) => line.trim() === `- ${path}`), `pull requests changing ${path} start the workflow`);
    }
});

test(`${name}'s actual Git guard selects only its affected project, all for the workflow, and none for other files`, (t) => {
    const dir = scratch(t);
    const files = allProjectFiles;
    for (const path of [...files, workflowPath, 'unrelated.txt']) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), path === workflowPath ? workflow : '{}\n');
    }
    git(dir, 'init', '-q', '--initial-branch=main');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'test: initial audit inputs');
    const base = git(dir, 'rev-parse', 'HEAD');
    const changed = stepIn(workflow, job, 'changed');
    assert.ok(changed?.run);
    assert.match(stepText(job, 'changed'), /^ {18}AUDIT_DIRECTORY: \$\{\{ matrix\.directory \}\}$/m);
    assert.match(jobText(job), /^ {18}fetch-depth: 2$/m, 'checkout includes the base parent used by the guard');

    for (const path of [...files, workflowPath, 'unrelated.txt']) {
        git(dir, 'reset', '--hard', '-q', base);
        writeFileSync(join(dir, path), `${readFileSync(join(dir, path), 'utf8')}\n`);
        git(dir, 'commit', '-qam', 'test: change one audit input');
        const selected = [];
        for (const { project, directory } of projects) {
            const output = join(dir, 'output');
            writeFileSync(output, '');
            const run = shell(changed.run, dir, { AUDIT_DIRECTORY: directory, GITHUB_OUTPUT: output });
            assert.equal(run.status, 0, `${path}/${project}: ${run.stdout}${run.stderr}`);
            const value = readFileSync(output, 'utf8');
            assert.ok(value === '' || value === 'files=true\n', `only the documented output is emitted: ${value}`);
            if (value) selected.push(project);
        }
        const expected = projects.filter(({ directory }) => path === workflowPath || projectFiles(ecosystem, directory).includes(path)).map(({ project }) => project);
        assert.deepEqual(selected, expected, path);
    }
});

test(`${name}'s manual runs audit every lane, and project selection gates its audit and applicable setup`, () => {
    const auditGuard = property(stepText(job, 'audit'), 'if', 14);
    const changeGuard = property(stepText(job, 'changed'), 'if', 14);
    const guarded = [auditGuard];
    if (tool === 'composer') {
        const setup = steps(job).find((step) => /uses: shivammathur\/setup-php@/.test(step));
        assert.ok(setup, 'Composer setup exists');
        guarded.push(/^if: (.*)$/m.exec(setup)?.[1]);
    }
    for (const event of ['workflow_dispatch', 'pull_request']) {
        for (const files of ['', 'true']) {
            assert.equal(holds(changeGuard, { event, files }), event === 'pull_request');
            for (const condition of guarded) {
                assert.equal(holds(condition, { event, files }), event === 'workflow_dispatch' || Boolean(files), `${event}/${files || 'unchanged'}`);
            }
        }
    }
});

test(`${name} lanes fail independently and keep distinct advisory artifacts without tolerating audit failures`, () => {
    assert.match(jobText(job), /^ {12}fail-fast: false$/m);
    const audit = stepText(job, 'audit');
    assert.notEqual(property(audit, 'continue-on-error', 14), 'true');
    assert.equal(property(audit, 'working-directory', 14), '${{ matrix.directory }}');
    const diagnosis = steps(job).find((step) => /uses: \.\/\.github\/actions\/jev-diagnosis/.test(step));
    assert.ok(diagnosis);
    assert.equal(property(diagnosis, 'if', 14), 'failure()');
    assert.equal(property(diagnosis, 'continue-on-error', 14), 'true');
    const timeout = Number(property(diagnosis, 'timeout-minutes', 14));
    assert.ok(timeout > 0 && timeout <= 3, 'advisory diagnosis is bounded');
    const artifact = property(diagnosis, 'artifact', 18);
    assert.ok(artifact);
    assert.ok(artifact.includes('${{ github.job }}'), 'the two ecosystems cannot overwrite each other\'s artifacts');
    const names = projects.map(({ project }) => artifact.replaceAll('${{ github.job }}', job)
        .replaceAll('${{ matrix.project }}', project).replaceAll('${{ github.run_id }}', '123').replaceAll('${{ github.run_attempt }}', '1'));
    assert.equal(new Set(names).size, projects.length, 'matrix lanes cannot overwrite each other\'s evidence');
    assert.ok(names.every((name) => !name.includes('${{')), 'all artifact identifiers are understood');
});

test(`${name}'s actual audit shell reads only the lock, captures each lane's output, and preserves a failure`, (t) => {
    const dir = scratch(t);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, tool), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(process.env.CALLS, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
console.log('audit stdout: ' + process.env.PROJECT);
console.error('audit stderr: ' + process.env.PROJECT);
process.exit(Number(process.env.AUDIT_STATUS));
`);
    chmodSync(join(bin, tool), 0o755);
    const audit = stepIn(workflow, job, 'audit');
    assert.ok(audit?.run);
    for (const { project, directory } of projects) {
        const cwd = join(dir, 'repo', directory);
        mkdirSync(cwd, { recursive: true });
        writeFileSync(join(cwd, lock), '{}\n');
        for (const status of [0, 17]) {
            const runner = join(dir, `${project}-${status}`);
            mkdirSync(runner);
            const calls = join(runner, 'calls.jsonl');
            const run = shell(audit.run, cwd, {
                PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runner, CALLS: calls,
                PROJECT: project, AUDIT_STATUS: String(status),
            });
            assert.equal(run.status, status, `${project}: ${run.stdout}${run.stderr}`);
            const invocations = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
            assert.deepEqual(invocations, [{ args: ecosystem.args, cwd }], 'one locked audit, no install or dependency resolution');
            const log = readFileSync(join(runner, 'jev-audit.log'), 'utf8');
            assert.equal(log, `audit stdout: ${project}\naudit stderr: ${project}\n`);
            assert.equal(run.stdout, log, 'captured output also reaches the job log');
            assert.equal(existsSync(join(cwd, ecosystem.installed)), false);
        }
    }
});
}

test('scheduled runs only dispatch to dev and leave both audit matrices to the dispatched run', () => {
    assert.match(jobText('start'), /run: gh workflow run audit\.yml --repo "\$REPO" --ref dev$/m);
    assert.doesNotMatch(jobText('start'), /actions\/checkout/);
    const start = property(jobText('start'), 'if', 8);
    for (const event of ['schedule', 'workflow_dispatch', 'pull_request']) {
        assert.equal(holds(start, { event }), event === 'schedule');
        for (const { job } of ecosystems) {
            assert.equal(holds(property(jobText(job), 'if', 8), { event }), event !== 'schedule', `${event}/${job}`);
        }
    }
});

test('the root Playwright pin remains ignored by Dependabot while the consumer browser may update', () => {
    const npm = updates.filter((entry) => entry.startsWith('npm\n'));
    const tests = npm.find((entry) => property(entry, 'directory', 6) === '/');
    const consumer = npm.find((entry) => property(entry, 'directory', 6) === '/packages/uxor/dev');
    assert.ok(tests && consumer);
    assert.match(tests, /^ {10}- dependency-name: '@playwright\/test'$/m);
    assert.doesNotMatch(consumer, /dependency-name:.*@playwright\/test/);
});
