// audit.yml's coverage of the browser packages each importmap.php selects, which no lock file lists: every tracked
// importmap.php has a lane that runs `importmap:audit` and fails on its failure, pull requests changing it start the
// workflow, the lane names the package versions it checked, and `importmap:outdated` reports in a separate step that
// never fails the lane (a newer version is not an advisory).
// Run: node --test tools/tests/importmap-audit.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    // dedented as YAML's block scalar is, so a heredoc keeps its own indentation
    const lines = body.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
    const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
    return lines.map((line) => line.slice(indent)).join('\n');
}

/** Whether a step's script runs `bin/console [options] <command>` as a command (a line's start, or after ;, && or ||), not as an argument. */
const runsCommand = (step, command) => new RegExp(`(?:^\\s*|[;&|]\\s*)(?:php\\s+)?(?:\\./)?bin/console(?:\\s+-[^\\s]+)*\\s+${command}\\b`, 'm').test(script(step));
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

/**
 * Runs each lane's importmap:outdated step script as Actions does (bash -eo pipefail), in a scratch directory whose
 * bin/console is a stand-in: it prints `stdout` and `stderr` and exits with `status` for importmap:outdated asked for
 * JSON, and answers anything else with exit 64 and no output (the text format would be misread).
 */
function runOutdated(job, { status, stdout = '', stderr = '' }) {
    const step = steps(job).find((candidate) => runsCommand(candidate, 'importmap:outdated'));
    assert.ok(step, `${job.id} has an importmap:outdated step`);
    const scratch = mkdtempSync(join(tmpdir(), 'importmap-audit-outdated-'));
    try {
        mkdirSync(join(scratch, 'bin'));
        mkdirSync(join(scratch, 'runner-temp'));
        writeFileSync(join(scratch, 'stdout'), stdout);
        writeFileSync(join(scratch, 'stderr'), stderr);
        const stub = join(scratch, 'bin/console');
        writeFileSync(stub, `#!/usr/bin/env bash\ncase " $* " in *' importmap:outdated '*'--format=json '*|*' --format=json '*'importmap:outdated '*) cat '${join(scratch, 'stdout')}'; cat '${join(scratch, 'stderr')}' >&2; exit ${status} ;; esac\nexit 64\n`);
        spawnSync('chmod', ['+x', stub]);
        const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(step)], {
            cwd: scratch,
            env: { ...process.env, RUNNER_TEMP: join(scratch, 'runner-temp') },
            encoding: 'utf8',
        });
        return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

const OUTDATED = JSON.stringify([
    { name: '@hotwired/stimulus', current: '3.2.1', latest: '3.2.2', 'latest-status': 'semver-safe-update' },
    { name: 'lodash', current: '3.10.1', latest: '4.17.21', 'latest-status': 'update-possible' },
], null, 4);

test('importmap:outdated with nothing newer ends the step quietly: no notice, no warning, no error', () => {
    for (const job of requiredAuditJobs()) {
        const run = runOutdated(job, { status: 0, stdout: '[]\n' });
        assert.equal(run.status, 0, run.stderr);
        assert.doesNotMatch(run.stdout + run.stderr, /::(?:notice|warning|error)/, `${job.id}: ${run.stdout}`);
    }
});

test('importmap:outdated listing newer versions ends the step with them listed and a notice naming the count', () => {
    for (const job of requiredAuditJobs()) {
        const run = runOutdated(job, { status: 1, stdout: `${OUTDATED}\n` });
        assert.equal(run.status, 0, `${job.id}: the step passes (${run.stderr})`);
        assert.match(run.stdout, /^.*@hotwired\/stimulus.*3\.2\.1.*3\.2\.2.*$/m, `${job.id} lists each package: ${run.stdout}`);
        assert.match(run.stdout, /^.*lodash.*3\.10\.1.*4\.17\.21.*$/m, `${job.id} lists each package: ${run.stdout}`);
        assert.match(run.stdout, /^::notice::.*\b2\b.*$/m, `${job.id}: a notice names the count`);
        assert.doesNotMatch(run.stdout + run.stderr, /::(?:warning|error)/, `${job.id}: ${run.stdout}`);
    }
});

test('importmap:outdated that cannot check ends the step with a warning, the error left in the log, and no notice', () => {
    const cases = {
        'no output, an error': { status: 1, stderr: 'In ImportMapUpdateChecker: the registry cannot be reached\n' },
        'an object, not a list': { status: 1, stdout: '{"error": "unexpected"}\n', stderr: 'In ImportMapUpdateChecker: the registry cannot be reached\n' },
        'an empty list with a failure': { status: 1, stdout: '[]\n', stderr: 'In ImportMapUpdateChecker: the registry cannot be reached\n' },
        'not JSON': { status: 1, stdout: 'Fatal error\n', stderr: 'In ImportMapUpdateChecker: the registry cannot be reached\n' },
    };
    for (const job of requiredAuditJobs()) {
        for (const [label, outcome] of Object.entries(cases)) {
            const run = runOutdated(job, outcome);
            assert.equal(run.status, 0, `${job.id}, ${label}: the step passes (${run.stderr})`);
            assert.match(run.stdout, /^::warning::/m, `${job.id}, ${label}: a warning says nothing could be checked`);
            assert.doesNotMatch(run.stdout + run.stderr, /::(?:notice|error)/, `${job.id}, ${label}: ${run.stdout}`);
            assert.match(run.stderr, /the registry cannot be reached/, `${job.id}, ${label}: the command's error reaches the log`);
        }
    }
});

// The advisory request authenticated with the job's own token: only the importmap:audit step gets it (from
// `${{ github.token }}`, at step level), and only behind a non-empty check does that step write a lane config scoping an
// Authorization header to api.github.com and aliasing AssetMapper's HTTP client to it. The step removes the config when
// it ends, pass or fail, so a later step (importmap:outdated boots the same app without the variable) never loads it.
const TOKEN_VARIABLE = 'AUDIT_GITHUB_TOKEN';
const LANE_CONFIG = 'config/packages/zz_audit_github.yaml';

/** A step's own `env:` mapping (at 14 spaces, its entries at 16 or more), as name => value. */
function stepEnv(step) {
    const block = /^ {14}env:\n((?: {16,}.*\n?)*)/m.exec(`${step}\n`)?.[1] ?? '';
    return Object.fromEntries([...block.matchAll(/^ {16,}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/gm)].map(([, name, value]) => [name, value]));
}

test('only the importmap:audit step gets the job token, at step level from github.token', () => {
    const workflowEnv = /^env:\n((?: {4,}.*\n?)*)/m.exec(workflow)?.[1] ?? '';
    assert.doesNotMatch(workflowEnv, new RegExp(TOKEN_VARIABLE), 'no workflow-level env carries it');
    for (const job of requiredAuditJobs()) {
        const jobEnv = /^ {8}env:\n((?: {12,}.*\n?)*)/m.exec(job.text)?.[1] ?? '';
        assert.doesNotMatch(jobEnv, new RegExp(TOKEN_VARIABLE), `${job.id}: no job-level env carries it`);
        const all = steps(job);
        const audit = all.filter((step) => runsCommand(step, 'importmap:audit'));
        assert.equal(audit.length, 1, `${job.id}: one importmap:audit step`);
        assert.equal(stepEnv(audit[0])[TOKEN_VARIABLE], '${{ github.token }}', `${job.id}: the audit step sets ${TOKEN_VARIABLE}: \${{ github.token }}`);
        for (const step of all.filter((candidate) => candidate !== audit[0])) {
            assert.doesNotMatch(step, new RegExp(`${TOKEN_VARIABLE}|github\\.token`), `${job.id}: "${step.split('\n')[0]}" does not get the token`);
        }
    }
});

/**
 * Runs each lane's importmap:audit step script as Actions does, in a scratch app directory with a stand-in bin/console
 * that answers importmap:audit with `status` and `output`, and keeps a copy of the lane config if it exists when called.
 */
function runAudit(job, { token, status = 0, output = 'No vulnerabilities found.' }) {
    const step = steps(job).find((candidate) => runsCommand(candidate, 'importmap:audit'));
    const scratch = mkdtempSync(join(tmpdir(), 'importmap-audit-token-'));
    try {
        mkdirSync(join(scratch, 'bin'));
        mkdirSync(join(scratch, 'config/packages'), { recursive: true });
        mkdirSync(join(scratch, 'runner-temp'));
        // a container an earlier boot built, and a log the cache clearing must leave alone
        mkdirSync(join(scratch, 'var/cache/dev'), { recursive: true });
        mkdirSync(join(scratch, 'var/log'), { recursive: true });
        writeFileSync(join(scratch, 'var/cache/dev/built-before.marker'), 'container\n');
        writeFileSync(join(scratch, 'var/log/kept.log'), 'log\n');
        const seen = join(scratch, 'runner-temp/seen-config.yaml');
        const cacheAtAudit = join(scratch, 'runner-temp/cache-at-audit');
        const stub = join(scratch, 'bin/console');
        writeFileSync(stub, `#!/usr/bin/env bash\ncase " $* " in *' importmap:audit '*) [ -f '${LANE_CONFIG}' ] && cp '${LANE_CONFIG}' '${seen}'; [ -e var/cache/dev/built-before.marker ] && echo present > '${cacheAtAudit}'; printf '%s\\n' '${output.replaceAll("'", '')}'; exit ${status} ;; esac\nexit 64\n`);
        spawnSync('chmod', ['+x', stub]);
        const env = { ...process.env, RUNNER_TEMP: join(scratch, 'runner-temp') };
        delete env[TOKEN_VARIABLE];
        if (token !== undefined) env[TOKEN_VARIABLE] = token;
        const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(step)], { cwd: scratch, env, encoding: 'utf8' });
        return {
            status: result.status,
            log: result.stdout + result.stderr,
            seen: existsSync(seen) ? readFileSync(seen, 'utf8') : null,
            left: existsSync(join(scratch, LANE_CONFIG)),
            staleCacheAtAudit: existsSync(cacheAtAudit),
            logKept: existsSync(join(scratch, 'var/log/kept.log')),
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

const FAKE_TOKEN = 'ghs_FAKE0token0for0the0test';

/** The lane config's shape: a scoped client on api.github.com with the header from the variable, and the alias. */
function assertLaneConfig(label, yaml) {
    assert.ok(yaml, `${label}: the config exists when importmap:audit runs`);
    assert.match(yaml, /^framework:\s*$/m, `${label}: a framework section`);
    assert.match(yaml, /^ +http_client:\s*$/m, `${label}: http_client`);
    assert.match(yaml, /^ +scoped_clients:\s*$/m, `${label}: scoped_clients`);
    assert.match(yaml, /^ +audit_github\.client:\s*$/m, `${label}: the audit_github.client scoped client`);
    assert.match(yaml, /^ +scope:\s*(?:'\^https:\/\/api\\\.github\\\.com\/'|"\^https:\/\/api\\\\\.github\\\\\.com\/")\s*$/m, `${label}: scope anchored on https://api.github.com/, its dots escaped`);
    assert.match(yaml, /^ +Authorization:\s*['"]Bearer %env\(AUDIT_GITHUB_TOKEN\)%['"]\s*$/m, `${label}: the header reads the variable at run time`);
    assert.doesNotMatch(yaml, /default_options/, `${label}: no default headers, so no other host gets the token`);
    assert.match(yaml, /^services:\s*$/m, `${label}: a services section`);
    assert.match(yaml, /^ +asset_mapper\.http_client:\s*(?:'@audit_github\.client'|"@audit_github\.client"|\n +alias:\s*['"]?audit_github\.client['"]?)\s*$/m, `${label}: asset_mapper.http_client is the scoped client`);
    assert.ok(!yaml.includes(FAKE_TOKEN), `${label}: the token's value is not written into the file`);
}

test('with the token, the audit step writes the lane config before importmap:audit, never prints the token, and removes the config', () => {
    for (const job of requiredAuditJobs()) {
        const run = runAudit(job, { token: FAKE_TOKEN });
        assert.equal(run.status, 0, `${job.id}: ${run.log}`);
        assertLaneConfig(job.id, run.seen);
        assert.ok(!run.log.includes(FAKE_TOKEN), `${job.id}: the token never reaches the log`);
        assert.ok(!run.left, `${job.id}: the config is gone when the step ends, so a later step does not load it`);
    }
});

test('without the token (unset or empty), the audit step writes no config and the request stays anonymous', () => {
    for (const job of requiredAuditJobs()) {
        for (const [label, token] of [['unset', undefined], ['empty', '']]) {
            const run = runAudit(job, { token });
            assert.equal(run.status, 0, `${job.id}, ${label}: ${run.log}`);
            assert.equal(run.seen, null, `${job.id}, ${label}: no lane config when importmap:audit runs`);
            assert.ok(!run.left, `${job.id}, ${label}: none left`);
        }
    }
});

test('a refused advisory request (403, rate limit) still fails the audit step, with or without the token, and leaves no config', () => {
    const refused = 'Error 403 auditing packages. Response: API rate limit exceeded';
    for (const job of requiredAuditJobs()) {
        for (const [label, token] of [['with the token', FAKE_TOKEN], ['without', undefined]]) {
            const run = runAudit(job, { token, status: 1, output: refused });
            assert.notEqual(run.status, 0, `${job.id}, ${label}: the step fails`);
            assert.doesNotMatch(run.log, /::(?:warning|notice)::/, `${job.id}, ${label}: not turned into a warning or a notice`);
            assert.match(run.log, /Error 403 auditing packages/, `${job.id}, ${label}: the error reaches the log`);
            assert.ok(!run.left, `${job.id}, ${label}: the config is gone even when the step fails`);
        }
    }
});

test('no tracked file of the demo or the consumer application configures the token or api.github.com', () => {
    const result = spawnSync('git', ['ls-files', '-z', 'demo/config', 'packages/uxor/dev/app/config'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const files = result.stdout.split('\0').filter(Boolean);
    assert.ok(files.length > 0, 'the applications have tracked config');
    for (const file of files) {
        const text = readFileSync(join(root, file), 'utf8');
        assert.ok(!text.includes(TOKEN_VARIABLE) && !text.includes('api.github.com'), `${file} holds no token configuration`);
    }
});

test('with the token, the audit step clears the app cache before the audit, so a container built earlier cannot hide the lane config; without it, the cache stays', () => {
    for (const job of requiredAuditJobs()) {
        const withToken = runAudit(job, { token: FAKE_TOKEN });
        assert.equal(withToken.status, 0, `${job.id}: ${withToken.log}`);
        assert.ok(!withToken.staleCacheAtAudit, `${job.id}: with the token, var/cache from an earlier boot is gone when importmap:audit runs`);
        assert.ok(withToken.logKept, `${job.id}: only the cache is cleared, var/log stays`);
        for (const [label, token] of [['unset', undefined], ['empty', '']]) {
            const run = runAudit(job, { token });
            assert.ok(run.staleCacheAtAudit, `${job.id}, ${label}: without the token the cache is left alone`);
            assert.ok(run.logKept, `${job.id}, ${label}: var/log stays`);
        }
    }
});
