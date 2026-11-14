// audit.yml's coverage of the browser packages each importmap.php selects, which no lock file lists: every tracked
// importmap.php has a lane that runs `importmap:audit` and fails on its failure, pull requests changing it start the
// workflow, the lane names the package versions it checked, and `importmap:outdated` reports in a separate step that
// never fails the lane (a newer version is not an advisory).
// Run: node --test tools/tests/importmap-audit.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflowPath = '.github/workflows/audit.yml';
const workflow = readFileSync(join(root, workflowPath), 'utf8');

const importmaps = (() => {
    const result = spawnSync('git', ['ls-files', '*importmap.php'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split('\n').filter(Boolean).sort();
})();

/** The jobs of audit.yml (this repository's layout: jobs at 4 spaces, steps at 12), by id. */
function jobs() {
    const body = workflow.slice(workflow.indexOf('\njobs:\n'));
    return [...body.matchAll(/^ {4}([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^ {4}[a-z][a-z0-9-]*:\n|(?![\s\S]))/gm)].map(([, id, text]) => ({ id, text }));
}

const steps = (job) => job.text.split(/^ {12}- /m).slice(1);
/** A step's shell script: its `run:` value, one line or a block, comment lines left out. */
function script(step) {
    const match = /^ {12,14}run: ?(.*)\n((?: {16,}.*\n?|\s*\n)*)/m.exec(`${step}\n`);
    if (!match) return '';
    const body = match[1] === '|' || match[1] === '>' ? match[2] : `${match[1]}\n`;
    return body.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).join('\n');
}

/** Whether a step's script runs `bin/console <command>` as a command (a line's start, or after ;, && or ||), not as an argument. */
const runsCommand = (step, command) => new RegExp(`(?:^|[;&|]\\s*)(?:php\\s+)?(?:\\./)?bin/console\\s+${command}\\b`, 'm').test(script(step));
const nonFailing = (step) => /^ {14}continue-on-error: true\b/m.test(step) || /\|\|\s*(?:true|:)\s*$/m.test(step);

/** The directories a job works in: its matrix's `directory:` values, or its literal working directories. */
function directories(job) {
    const matrix = [...job.text.matchAll(/^ {20,22}directory: (\S+)\s*$/gm)].map((m) => m[1]);
    if (matrix.length > 0) return matrix;
    return [...job.text.matchAll(/^ {14}working-directory: ([^$\s][^\s]*)\s*$/gm)].map((m) => m[1]);
}

const auditJobs = () => jobs().filter((job) => steps(job).some((step) => runsCommand(step, 'importmap:audit')));
/** The lanes running importmap:audit, at least one: a check over them never passes on none. */
function requiredAuditJobs() {
    const found = auditJobs();
    assert.ok(found.length > 0, `${workflowPath} has a job running importmap:audit`);
    return found;
}

test('the repository tracks the importmaps this test is about', () => {
    assert.deepEqual(importmaps, ['demo/importmap.php', 'packages/uxor/dev/app/importmap.php']);
});

test('every tracked importmap.php has an audit.yml lane running importmap:audit, and no lane audits another directory', () => {
    const lanes = auditJobs().flatMap(directories).map((dir) => posix.normalize(dir)).sort();
    assert.deepEqual(lanes, importmaps.map((path) => posix.dirname(path)), `${workflowPath} importmap:audit lanes`);
});

test('an importmap:audit failure fails its lane: not continued, not swallowed, not lost in a pipe', () => {
    const audits = auditJobs().flatMap((job) => steps(job).filter((step) => runsCommand(step, 'importmap:audit')).map((step) => ({ job: job.id, step })));
    assert.ok(audits.length > 0, `${workflowPath} runs importmap:audit`);
    for (const { job, step } of audits) {
        assert.ok(!nonFailing(step), `${job}: the importmap:audit step neither continues on error nor ends in || true`);
        for (const line of step.split('\n').filter((text) => /importmap:audit/.test(text))) {
            assert.doesNotMatch(line, /\|\|/, `${job}: importmap:audit's status is not replaced: ${line.trim()}`);
            if (/[^|]\|[^|]/.test(line)) assert.match(step, /set -o pipefail|set -[a-z]*o pipefail/, `${job}: a piped importmap:audit keeps its status (pipefail)`);
        }
    }
});

test('pull requests changing an importmap.php start the audit, and the lane runs for it', () => {
    const paths = workflow.slice(workflow.indexOf('    pull_request:'), workflow.indexOf('    workflow_dispatch:'));
    for (const path of importmaps) {
        assert.ok(paths.split('\n').some((line) => line.trim() === `- ${path}`), `pull requests changing ${path} start ${workflowPath}`);
    }
    for (const job of auditJobs()) {
        const changed = steps(job).find((step) => /^id: changed$|^ {14}id: changed$/m.test(step));
        if (changed) assert.match(changed, /importmap\.php/, `${job.id}: its changed-files guard looks at importmap.php`);
    }
});

test('each importmap:audit lane prints the package versions it checked', () => {
    // run against an importmap of known entries: every versioned package and its version on one line
    const scratch = mkdtempSync(join(tmpdir(), 'importmap-audit-listing-'));
    try {
        writeFileSync(join(scratch, 'importmap.php'), "<?php\nreturn [\n    'app' => ['path' => './assets/app.js', 'entrypoint' => true],\n    '@hotwired/stimulus' => ['version' => '3.2.2'],\n    'lodash' => ['version' => '4.17.21'],\n];\n");
        for (const job of requiredAuditJobs()) {
            const candidates = steps(job).filter((step) => /importmap\.php/.test(script(step)) && !/\b(?:composer|bin\/console|git)\b/.test(script(step)));
            const printed = candidates.map((step) => spawnSync('bash', ['-e', '-c', script(step)], { cwd: scratch, encoding: 'utf8' })).filter((result) => result.status === 0).map((result) => result.stdout);
            assert.ok(
                printed.some((out) => /^.*@hotwired\/stimulus.*\b3\.2\.2\b.*$/m.test(out) && /^.*lodash.*\b4\.17\.21\b.*$/m.test(out)),
                `${job.id}: a step reading importmap.php prints each package with its version (printed: ${JSON.stringify(printed)})`,
            );
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }

    for (const job of requiredAuditJobs()) {
        const listing = steps(job).find((step) => !runsCommand(step, 'importmap:audit') && !runsCommand(step, 'importmap:outdated')
            && /importmap/.test(step) && /version/i.test(step) && /\b(?:run|echo|printf|php|cat|jq)\b/.test(step));
        assert.ok(listing, `${job.id}: a step lists the importmap packages and versions audited`);
    }
});

test('importmap:outdated reports in a step of its own that never fails the lane', () => {
    for (const job of requiredAuditJobs()) {
        const outdated = steps(job).filter((step) => runsCommand(step, 'importmap:outdated'));
        assert.ok(outdated.length > 0, `${job.id}: a step runs importmap:outdated`);
        for (const step of outdated) {
            assert.ok(!runsCommand(step, 'importmap:audit'), `${job.id}: importmap:outdated is not in the audit's step`);
            assert.ok(nonFailing(step), `${job.id}: the importmap:outdated step cannot fail the lane (continue-on-error: true or || true)`);
        }
    }
});

/** A step's or job's `if:` (none: always), at its own indentation. */
const condition = (text, indent) => new RegExp(`^ {${indent}}if: (.+)$`, 'm').exec(text)?.[1].replace(/\s+#.*$/, '').trim() ?? null;

/**
 * This workflow's condition grammar, evaluated for one event: `github.event_name` compared with == or != to a quoted
 * name, a step output (`steps.<id>.outputs.<name>`, set or not), `true`, `false`, `success()`, joined by && or ||
 * (&& first). Anything else fails the test, so a new form is read before it is trusted.
 */
function evaluate(expression, { event, outputs = {} }) {
    if (expression === null) return true;
    const atom = (term) => {
        const text = term.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '');
        const compare = /^github\.event_name\s*(==|!=)\s*'([a-z_]+)'$/.exec(text);
        if (compare) return compare[1] === '==' ? event === compare[2] : event !== compare[2];
        const output = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(text);
        if (output) return Boolean(outputs[`${output[1]}.${output[2]}`]);
        if (text === 'true' || text === 'success()') return true;
        if (text === 'false') return false;
        assert.fail(`unsupported condition: ${term}`);
    };
    return expression.split(/\s*\|\|\s*/).some((any) => any.split(/\s*&&\s*/).every((all) => atom(all)));
}

/** Runs a lane's changed-files guard in a scratch repository whose last commit changes `changed`; true when it sets files. */
function guardSelects(job, directory, changed) {
    const guard = steps(job).find((step) => /^id: changed$|^ {14}id: changed$/m.test(step));
    assert.ok(guard, `${job.id} has a changed-files guard`);
    assert.ok(evaluate(condition(guard, 14), { event: 'pull_request' }), `${job.id}: its guard runs on a pull request`);
    const scratch = mkdtempSync(join(tmpdir(), 'importmap-audit-guard-'));
    try {
        const git = (...args) => {
            const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: scratch, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
        };
        const write = (path, content) => {
            mkdirSync(join(scratch, dirname(path)), { recursive: true });
            writeFileSync(join(scratch, path), content);
        };
        git('init', '-q');
        for (const path of [`${directory}/importmap.php`, `${directory}/composer.lock`, 'docs/GUIDE.md', '.github/workflows/audit.yml']) write(path, 'before\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'base');
        write(changed, 'after\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'change');
        const output = join(scratch, '.github-output');
        writeFileSync(output, '');
        const env = { ...process.env, GITHUB_OUTPUT: output };
        for (const [, name, value] of guard.matchAll(/^ {18}([A-Z_][A-Z0-9_]*): (.+)$/gm)) {
            env[name] = value.trim().replace(/\$\{\{\s*matrix\.directory\s*\}\}/g, directory);
        }
        const result = spawnSync('bash', ['-e', '-c', script(guard)], { cwd: scratch, env, encoding: 'utf8' });
        assert.equal(result.status, 0, `${job.id}: its guard runs: ${result.stderr}`);
        return /^files=true$/m.test(readFileSync(output, 'utf8'));
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

test('each lane runs its install, listing and audit on a manual run, and on a pull request its guard selects', () => {
    for (const job of requiredAuditJobs()) {
        const needed = steps(job).filter((step) => runsCommand(step, 'importmap:audit') || /composer install\b/.test(script(step)) || (/importmap/.test(step) && /version/i.test(step) && !runsCommand(step, 'importmap:outdated')));
        assert.ok(needed.length >= 3, `${job.id}: an install, a listing and an audit step`);
        for (const [label, scenario] of [
            ['a manual run', { event: 'workflow_dispatch' }],
            ['a pull request whose guard selected the lane', { event: 'pull_request', outputs: { 'changed.files': 'true' } }],
        ]) {
            assert.ok(evaluate(condition(job.text, 8), scenario), `${job.id} runs on ${label}`);
            for (const step of needed) assert.ok(evaluate(condition(step, 14), scenario), `${job.id}: "${step.split('\n')[0]}" runs on ${label}`);
        }
    }
});

test('the guard of each lane selects it for a change to its importmap.php or the workflow, and not for an unrelated file', () => {
    for (const job of requiredAuditJobs()) {
        for (const directory of directories(job)) {
            assert.ok(guardSelects(job, directory, `${directory}/importmap.php`), `${job.id} (${directory}): a change to its importmap.php selects it`);
            assert.ok(guardSelects(job, directory, '.github/workflows/audit.yml'), `${job.id} (${directory}): a change to the workflow selects it`);
            assert.ok(!guardSelects(job, directory, 'docs/GUIDE.md'), `${job.id} (${directory}): an unrelated change does not`);
        }
    }
});
