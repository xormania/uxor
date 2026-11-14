// audit.yml's coverage of the browser packages each importmap.php selects, which no lock file lists: every tracked
// importmap.php has a lane that runs `importmap:audit` and fails on its failure, pull requests changing it start the
// workflow, the lane names the package versions it checked, and `importmap:outdated` reports in a separate step that
// never fails the lane (a newer version is not an advisory).
// Run: node --test tools/tests/importmap-audit.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
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
const runsCommand = (step, command) => new RegExp(`(?:^|[\\s/])(?:bin/)?console\\s+${command}\\b|\\b${command}\\b`).test(step.replace(/^\s*#.*$/gm, ''));
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
