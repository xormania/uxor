#!/usr/bin/env node
/**
 * Reuse of an earlier pass of a CI lane whose inputs are unchanged (docs/TESTING.md, *Reused lanes*).
 *
 * A lane's inputs are the whole tree but a few administrative files no reusable lane reads (EXCLUDED): its fingerprint
 * hashes `git ls-tree -r` of the commit without them, so a change to anything else, ci.yml, this tool and the pinned
 * versions included, gives every lane a new fingerprint. CI result records a marker artifact for each lane that ran
 * fresh: `ci-pass-v1-<lane>-<fingerprint>` when every job of the lane passed, `ci-fail-v1-...` when one failed. A later
 * run with the same fingerprint reuses the pass only when the newest marker is a pass, at most MAX_AGE_DAYS old, from a
 * push or manual run of ci.yml in this repository whose lane jobs all passed (latest attempt), and when the fingerprint
 * recomputed at the producer's commit is the same. Anything missing, ambiguous or failing to load runs the lane.
 *
 *   fingerprint --sha <rev>
 *   plan --repo <o/r> --sha <sha> --selection <file> [--ref <ref>] [--reuse on|off] --out <plan.json> [--github-output <f>]
 *   record --plan <plan.json> --jobs <jobs.json> [--shards <dir>] --run-id <n> --run-attempt <n> --out <dir> [--github-output <f>]
 *   verdict --plan <plan.json> --needs <needs.json> --repo <o/r> [--wo-draft true|false] [--summary <f>]
 * Common: --gh <command> (gh), --git-dir <dir> (.), --now <ISO time> (the clock).
 *
 * Self-contained (Node's own modules only): CI result runs the copy the Changes job ran.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

/** every lane of ci.yml's Changes job, in its order */
export const LANES = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows', 'package', 'prod-image'];
/** the lanes whose pass can be reused, with their jobs' names in ci.yml and how many a full pass has */
export const REUSABLE = {
    'lint-kit': { prefix: 'Lint kit (', count: 2 },
    php: { name: 'Kit PHP', count: 1 },
    'static-site': { name: 'Static site', count: 1 },
    demo: { prefix: 'Demo + Playwright (', count: 10 },
    'prod-image': { name: 'Production image', count: 1 },
};
/** read by people, agents and Contrast only: no reusable lane's job reads them (export-ignored, not in the image) */
export const EXCLUDED = ['CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', '.github/pull_request_template.md'];
export const MAX_AGE_DAYS = 14;
const WORKFLOW = '.github/workflows/ci.yml';
const PRODUCER_EVENTS = ['push', 'workflow_dispatch'];
/** the jobs of ci.yml that make up each lane, as CI result's `needs` names them */
const NEEDS = { 'fresh-install': ['fresh-install', 'docker-install'] };
const SETUP_NEEDS = ['changes', 'tools', 'importmap'];
const IMPORTMAP_USERS = ['php', 'static-site', 'demo'];
const MARKER_LIMIT = 65536;

class Refused extends Error {
    constructor(reason, detail) {
        super(detail);
        this.reason = reason;
    }
}

function options(argv) {
    const [command, ...rest] = argv;
    const opts = { command };
    for (let i = 0; i < rest.length; i += 2) {
        if (!rest[i].startsWith('--') || rest[i + 1] === undefined) usage(`bad argument ${rest[i]}`);
        opts[rest[i].slice(2)] = rest[i + 1];
    }
    return opts;
}

function usage(message) {
    console.error(`lane-evidence: ${message}`);
    process.exit(2);
}

function need(opts, ...names) {
    for (const name of names) if (opts[name] === undefined) usage(`${opts.command} needs --${name}`);
}

// git -------------------------------------------------------------------------------------------------------------------

function git(dir, args) {
    return spawnSync('git', ['-C', dir, ...args], { encoding: 'buffer', maxBuffer: 1 << 28 });
}

export function fingerprints(dir, sha) {
    const tree = git(dir, ['ls-tree', '-r', '-z', '--full-tree', sha]);
    if (tree.status !== 0) throw new Refused('producer_commit_unavailable', `git ls-tree ${sha}: ${tree.stderr.toString().trim()}`);
    const entries = tree.stdout.toString('utf8').split('\0').filter(Boolean)
        .filter((entry) => !EXCLUDED.includes(entry.slice(entry.indexOf('\t') + 1)));
    const body = entries.map((entry) => `${entry}\0`).join('');
    return Object.fromEntries(Object.keys(REUSABLE).map((lane) =>
        [lane, createHash('sha256').update(`uxor-lane-evidence/1\0${lane}\0`).update(body).digest('hex')]));
}

function ensureCommit(dir, sha) {
    if (git(dir, ['cat-file', '-e', `${sha}^{commit}`]).status === 0) return;
    const fetched = git(dir, ['fetch', '-q', '--no-tags', '--depth=1', 'origin', sha]);
    if (fetched.status !== 0 || git(dir, ['cat-file', '-e', `${sha}^{commit}`]).status !== 0) {
        throw new Refused('producer_commit_unavailable', `the producer's commit ${sha} cannot be fetched`);
    }
}

// GitHub's API ------------------------------------------------------------------------------------------------------------

function api(ctx) {
    return {
        raw(path) {
            if (Date.now() > ctx.deadline) throw new Refused('lookup_error', 'the lookup ran out of time');
            ctx.calls++;
            const result = spawnSync(ctx.gh, ['api', path], { encoding: 'buffer', maxBuffer: 1 << 26, timeout: 20000 });
            if (result.status !== 0) throw new Refused('lookup_error', `gh api ${path}: ${(result.stderr ?? '').toString().trim() || 'failed'}`);
            return result.stdout;
        },
        json(path) {
            try {
                return JSON.parse(this.raw(path).toString('utf8'));
            } catch (error) {
                if (error instanceof Refused) throw error;
                throw new Refused('lookup_error', `gh api ${path}: not JSON`);
            }
        },
    };
}

/** the one file of a small artifact ZIP, without extracting anything */
export function zipEntry(buffer, wanted) {
    const fail = (detail) => { throw new Refused('marker_invalid', `the marker's ZIP: ${detail}`); };
    if (buffer.length > MARKER_LIMIT) fail('too large');
    let end = -1;
    for (let i = buffer.length - 22; i >= 0; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) fail('no central directory');
    if (buffer.readUInt16LE(end + 10) !== 1) fail('not exactly one file');
    const central = buffer.readUInt32LE(end + 16);
    if (central + 46 > buffer.length || buffer.readUInt32LE(central) !== 0x02014b50) fail('bad central directory');
    const method = buffer.readUInt16LE(central + 10);
    const compressed = buffer.readUInt32LE(central + 20);
    const size = buffer.readUInt32LE(central + 24);
    const name = buffer.toString('utf8', central + 46, central + 46 + buffer.readUInt16LE(central + 28));
    if (name !== wanted) fail(`holds ${name}, not ${wanted}`);
    const local = buffer.readUInt32LE(central + 42);
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) fail('bad local header');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + compressed);
    if (data.length !== compressed || size > MARKER_LIMIT) fail('truncated or too large');
    let content;
    try {
        content = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: MARKER_LIMIT }) : fail(`method ${method}`);
    } catch (error) {
        if (error instanceof Refused) throw error;
        fail('cannot inflate');
    }
    if (content.length !== size) fail('size differs');
    return content;
}

// lanes -------------------------------------------------------------------------------------------------------------------

export function laneJobs(lane, jobs) {
    const rule = REUSABLE[lane];
    return jobs.filter((job) => (rule.name !== undefined ? job.name === rule.name : job.name.startsWith(rule.prefix)));
}

const markerName = (kind, lane, fp) => `ci-${kind}-v1-${lane}-${fp}`;
const time = (value) => Date.parse(value ?? '');

function markers(client, repo, kind, lane, fp) {
    const name = markerName(kind, lane, fp);
    const list = client.json(`repos/${repo}/actions/artifacts?name=${name}&per_page=100`);
    if (!Array.isArray(list.artifacts)) throw new Refused('lookup_error', `the ${kind} markers' listing has no artifacts`);
    return list.artifacts.filter((artifact) => artifact.name === name).map((artifact) => ({ ...artifact, kind }));
}

/** the newest marker for the lane's fingerprint, when it is a pass young enough; throws Refused otherwise */
function newestPass(client, ctx, lane, fp) {
    const all = [...markers(client, ctx.repo, 'pass', lane, fp), ...markers(client, ctx.repo, 'fail', lane, fp)];
    if (all.some((artifact) => Number.isNaN(time(artifact.created_at)))) throw new Refused('lookup_error', 'a marker without a creation time');
    all.sort((a, b) => time(b.created_at) - time(a.created_at));
    if (all.length === 0) throw new Refused('no_evidence', `no marker ${markerName('pass', lane, fp)}`);
    const [newest] = all;
    if (newest.kind === 'fail') throw new Refused('later_failure', `run ${newest.workflow_run?.id} failed the lane with these inputs at ${newest.created_at}, after any pass`);
    return newest;
}

function checkAge(ctx, artifact) {
    if (artifact.expired) throw new Refused('evidence_expired', `marker ${artifact.id} has expired`);
    const age = ctx.now - time(artifact.created_at);
    if (age > MAX_AGE_DAYS * 86400000) throw new Refused('evidence_too_old', `marker ${artifact.id} is ${Math.floor(age / 86400000)} days old (at most ${MAX_AGE_DAYS})`);
}

/** the producer run, checked against its marker's artifact: ci.yml, a push or manual run, this repository's */
function producerRun(client, ctx, artifact) {
    const origin = artifact.workflow_run ?? {};
    if (!Number.isInteger(origin.id)) throw new Refused('wrong_producer', 'the marker names no run');
    const run = ctx.runs.get(origin.id) ?? client.json(`repos/${ctx.repo}/actions/runs/${origin.id}`);
    ctx.runs.set(origin.id, run);
    const problems = [
        run.id !== origin.id && 'another run id',
        run.path !== WORKFLOW && `workflow ${run.path}`,
        !PRODUCER_EVENTS.includes(run.event) && `event ${run.event}`,
        run.repository?.full_name !== ctx.repo && `repository ${run.repository?.full_name}`,
        run.head_repository?.full_name !== ctx.repo && `head repository ${run.head_repository?.full_name}`,
        (origin.repository_id !== run.repository?.id || origin.head_repository_id !== run.repository?.id) && 'the artifact belongs to another repository',
        (!/^[0-9a-f]{40}$/.test(run.head_sha ?? '') || run.head_sha !== origin.head_sha) && 'another commit',
    ].filter(Boolean);
    if (problems.length) throw new Refused('wrong_producer', `run ${origin.id}: ${problems.join(', ')}`);
    return run;
}

function producerJobs(client, ctx, lane, run) {
    const jobs = ctx.jobs.get(run.id) ?? client.json(`repos/${ctx.repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`).jobs;
    if (!Array.isArray(jobs)) throw new Refused('lookup_error', `run ${run.id}: no job list`);
    ctx.jobs.set(run.id, jobs);
    const mine = laneJobs(lane, jobs);
    const { count } = REUSABLE[lane];
    const bad = mine.filter((job) => job.conclusion !== 'success');
    if (mine.length !== count || bad.length) {
        throw new Refused('jobs_incomplete', `run ${run.id}: ${mine.length} of ${count} ${lane} jobs${bad.length ? `, ${bad.map((job) => `${job.name} ${job.conclusion}`).join(', ')}` : ''}`);
    }
    return mine;
}

function qualify(client, ctx, lane, fp) {
    const artifact = newestPass(client, ctx, lane, fp);
    checkAge(ctx, artifact);
    const run = producerRun(client, ctx, artifact);
    const jobs = producerJobs(client, ctx, lane, run);
    let marker;
    try {
        marker = JSON.parse(zipEntry(client.raw(`repos/${ctx.repo}/actions/artifacts/${artifact.id}/zip`), 'evidence.json').toString('utf8'));
    } catch (error) {
        if (error instanceof Refused) throw error;
        throw new Refused('marker_invalid', 'evidence.json is not JSON');
    }
    const ids = (list) => (Array.isArray(list) ? list.map((job) => job?.id).sort((a, b) => a - b).join(',') : null);
    const problems = [
        marker?.schema !== 1 && 'schema',
        marker?.kind !== 'pass' && `kind ${marker?.kind}`,
        marker?.lane !== lane && `lane ${marker?.lane}`,
        marker?.fingerprint !== fp && 'fingerprint',
        marker?.run_id !== run.id && 'run',
        marker?.sha !== run.head_sha && 'commit',
        ids(marker?.jobs) !== ids(jobs) && 'jobs',
    ].filter(Boolean);
    if (problems.length) throw new Refused('marker_invalid', `marker ${artifact.id} disagrees on its ${problems.join(', ')}`);
    ensureCommit(ctx.gitDir, run.head_sha);
    if (fingerprints(ctx.gitDir, run.head_sha)[lane] !== fp) {
        throw new Refused('fingerprint_mismatch', `the inputs of ${lane} at ${run.head_sha} differ from this commit's`);
    }
    return {
        artifact_id: artifact.id, artifact_name: artifact.name, run_id: run.id, run_attempt: marker.run_attempt ?? null,
        head_sha: run.head_sha, head_branch: run.head_branch ?? null, created_at: artifact.created_at,
        url: run.html_url ?? `https://github.com/${ctx.repo}/actions/runs/${run.id}`,
        jobs: jobs.map(({ id, name, conclusion, run_attempt }) => ({ id, name, conclusion, run_attempt })),
        flaky: Number.isInteger(marker.flaky) ? marker.flaky : null, tests: marker.tests ?? null,
    };
}

function context(opts) {
    const now = opts.now ? Date.parse(opts.now) : Date.now();
    if (Number.isNaN(now)) usage('--now is not a time');
    return {
        repo: opts.repo, gh: opts.gh ?? 'gh', gitDir: opts['git-dir'] ?? '.', now, calls: 0, runs: new Map(), jobs: new Map(),
        deadline: Date.now() + Number(opts['budget-ms'] ?? 60000),
    };
}

function writeOutputs(file, values) {
    if (file) appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

// commands ----------------------------------------------------------------------------------------------------------------

function fingerprintCommand(opts) {
    need(opts, 'sha');
    const dir = opts['git-dir'] ?? '.';
    const sha = git(dir, ['rev-parse', '--verify', `${opts.sha}^{commit}`]).stdout.toString().trim();
    if (!sha) usage(`no commit ${opts.sha}`);
    console.log(JSON.stringify({ schema: 1, sha, excluded: EXCLUDED, lanes: fingerprints(dir, sha) }));
}

function planCommand(opts) {
    need(opts, 'repo', 'sha', 'selection', 'out');
    const started = Date.now();
    const ctx = context(opts);
    const client = api(ctx);
    const selected = Object.fromEntries(readFileSync(opts.selection, 'utf8').split('\n').filter(Boolean).map((line) => {
        const [lane, value] = line.split('=');
        return [lane, value === 'true'];
    }));
    const reuseOff = opts.ref === 'refs/heads/main' ? 'main' : opts.reuse === 'off' ? 'switch' : null;
    let own = null;
    const lanes = {};
    for (const lane of LANES) {
        const entry = { selected: selected[lane] ?? true, decision: 'run', fingerprint: null, reason: '', detail: '', evidence: null };
        lanes[lane] = entry;
        if (!entry.selected) Object.assign(entry, { decision: 'skip', reason: 'not_selected', detail: 'the change cannot affect it' });
        else if (!REUSABLE[lane]) Object.assign(entry, { reason: 'not_reusable', detail: 'it always runs when selected' });
        else if (reuseOff) Object.assign(entry, { reason: 'reuse_off', detail: reuseOff === 'main' ? 'main always runs fresh' : 'reuse is switched off' });
        else {
            try {
                own ??= fingerprints(ctx.gitDir, opts.sha);
                entry.fingerprint = own[lane];
                entry.evidence = qualify(client, ctx, lane, entry.fingerprint);
                Object.assign(entry, { decision: 'reuse', reason: 'reused', detail: `run ${entry.evidence.run_id} passed it on ${entry.evidence.head_sha}` });
            } catch (error) {
                if (!(error instanceof Refused)) throw error;
                Object.assign(entry, { decision: 'run', reason: error.reason, detail: error.message, evidence: null });
            }
        }
    }
    const plan = { schema: 1, repo: opts.repo, sha: opts.sha, ref: opts.ref ?? null, reuse: !reuseOff, reuse_off: reuseOff, elapsed_ms: Date.now() - started, api_calls: ctx.calls, lanes };
    writeFileSync(opts.out, `${JSON.stringify(plan, null, 2)}\n`);
    for (const [lane, entry] of Object.entries(lanes)) {
        const producer = entry.evidence ? ` run ${entry.evidence.run_id} attempt ${entry.evidence.run_attempt} on ${entry.evidence.head_sha} ${entry.evidence.url}` : '';
        console.log(`${lane}: ${entry.decision} (${entry.reason})${producer}${entry.decision === 'run' && entry.detail ? `: ${entry.detail}` : ''}`);
    }
    const summary = `${Object.values(lanes).filter((e) => e.decision === 'reuse').length} reused, ${Object.values(lanes).filter((e) => e.decision === 'run').length} run, ${Object.values(lanes).filter((e) => e.decision === 'skip').length} skipped; ${plan.elapsed_ms} ms, ${plan.api_calls} API calls`;
    console.log(summary);
    writeOutputs(opts['github-output'], {
        ...Object.fromEntries(Object.entries(lanes).map(([lane, entry]) => [lane, entry.decision])),
        importmap: IMPORTMAP_USERS.some((lane) => lanes[lane].decision === 'run') ? 'run' : 'skip',
        'plan-summary': summary,
    });
}

/** the browser shards' counts, from every results.json under the directory (Playwright's JSON report) */
function testCounts(dir) {
    if (!dir || !existsSync(dir)) return null;
    const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    let found = false;
    const visit = (suite) => {
        for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) {
            const outcome = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' }[t.status];
            if (outcome) counts[outcome]++;
        }
        for (const child of suite.suites ?? []) visit(child);
    };
    const walk = (path) => {
        for (const name of readdirSync(path)) {
            const child = join(path, name);
            if (statSync(child).isDirectory()) walk(child);
            else if (name === 'results.json') {
                try {
                    for (const suite of JSON.parse(readFileSync(child, 'utf8')).suites ?? []) visit(suite);
                    found = true;
                } catch { /* an unreadable report counts nothing; the shard's own job judged it */ }
            }
        }
    };
    walk(dir);
    return found ? counts : null;
}

function recordCommand(opts) {
    need(opts, 'plan', 'jobs', 'run-id', 'run-attempt', 'out');
    const plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
    const jobs = JSON.parse(readFileSync(opts.jobs, 'utf8'));
    const outputs = {};
    for (const lane of Object.keys(REUSABLE)) {
        outputs[`${lane}-marker`] = '';
        const entry = plan.lanes?.[lane];
        if (entry?.decision !== 'run' || !/^[0-9a-f]{64}$/.test(entry.fingerprint ?? '')) continue;
        const mine = laneJobs(lane, jobs);
        const passed = mine.length === REUSABLE[lane].count && mine.every((job) => job.conclusion === 'success');
        const failed = mine.some((job) => job.conclusion === 'failure' || job.conclusion === 'timed_out');
        if (!passed && !failed) continue;
        const kind = passed ? 'pass' : 'fail';
        const tests = lane === 'demo' ? testCounts(opts.shards) : null;
        const name = markerName(kind, lane, entry.fingerprint);
        mkdirSync(join(opts.out, name), { recursive: true });
        writeFileSync(join(opts.out, name, 'evidence.json'), `${JSON.stringify({
            schema: 1, kind, lane, fingerprint: entry.fingerprint, repo: plan.repo, sha: plan.sha,
            run_id: Number(opts['run-id']), run_attempt: Number(opts['run-attempt']),
            jobs: mine.map(({ id, name: job, conclusion, run_attempt }) => ({ id, name: job, conclusion, run_attempt })),
            flaky: tests ? tests.flaky : null, tests,
            runner: { image_os: process.env.ImageOS ?? null, image_version: process.env.ImageVersion ?? null },
            recorded_at: new Date(opts.now ? Date.parse(opts.now) : Date.now()).toISOString(),
        }, null, 2)}\n`);
        outputs[`${lane}-marker`] = name;
        console.log(`${lane}: recorded ${name}`);
    }
    writeOutputs(opts['github-output'], outputs);
}

function verdictCommand(opts) {
    need(opts, 'plan', 'needs', 'repo');
    const plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
    const needs = JSON.parse(readFileSync(opts.needs, 'utf8'));
    const ctx = context(opts);
    const client = api(ctx);
    const result = (job) => needs[job]?.result ?? 'missing';
    const lanes = {};
    for (const lane of LANES) {
        const entry = plan.lanes?.[lane];
        const results = (NEEDS[lane] ?? [lane]).map(result);
        const status = (value, reason = '', producer = null, flaky = null) => { lanes[lane] = { status: value, reason, producer, flaky }; };
        if (!entry) status('incomplete', 'not in the plan');
        else if (entry.decision === 'run') {
            if (results.every((value) => value === 'success')) status('fresh');
            else status('incomplete', `ended with ${results.join(', ')}`);
        } else if (entry.decision === 'skip') {
            if (results.every((value) => value === 'skipped')) status('not_applicable');
            else status('incomplete', `planned to skip, ended with ${results.join(', ')}`);
        } else if (entry.decision === 'reuse') {
            const evidence = entry.evidence;
            const producer = evidence && { run_id: evidence.run_id, run_attempt: evidence.run_attempt, head_sha: evidence.head_sha, url: evidence.url };
            if (!results.every((value) => value === 'skipped')) status('incomplete', `planned for reuse, ended with ${results.join(', ')}`, producer);
            else {
                try {
                    if (!evidence) throw new Refused('marker_invalid', 'the plan holds no evidence');
                    const artifact = client.json(`repos/${ctx.repo}/actions/artifacts/${evidence.artifact_id}`);
                    if (artifact.name !== evidence.artifact_name) throw new Refused('marker_invalid', `artifact ${evidence.artifact_id} is now ${artifact.name}`);
                    checkAge(ctx, artifact);
                    // a failure recorded since the plan refuses it; a newer pass does not contradict it
                    newestPass(client, ctx, lane, entry.fingerprint);
                    const run = producerRun(client, ctx, artifact);
                    if (run.id !== evidence.run_id) throw new Refused('wrong_producer', 'another run');
                    producerJobs(client, ctx, lane, run);
                    status('reused', '', producer, evidence.flaky ?? null);
                } catch (error) {
                    if (!(error instanceof Refused)) throw error;
                    status('incomplete', `${error.reason}: ${error.message}`, producer);
                }
            }
        } else status('incomplete', `unknown decision ${entry.decision}`);
    }
    const setup = SETUP_NEEDS.map((job) => [job, result(job)]).filter(([, value]) => value !== 'success' && value !== 'skipped');
    const draft = opts['wo-draft'] === 'true';
    const ok = !draft && setup.length === 0 && Object.values(lanes).every((lane) => lane.status !== 'incomplete');
    const rows = Object.entries(lanes).map(([lane, value]) => `| ${lane} | ${value.status} | ${value.producer ? `[run ${value.producer.run_id}](${value.producer.url}) attempt ${value.producer.run_attempt}, ${value.producer.head_sha.slice(0, 12)}` : ''} | ${value.flaky ?? ''} | ${value.reason} |`);
    const summary = [
        '### Lanes', '',
        draft ? 'Work order draft: CI ran no tests.\n' : '',
        '| Lane | Result | Producer | Flaky | Why |', '|---|---|---|---|---|', ...rows, '',
        ...setup.map(([job, value]) => `- ${job} ended with ${value}`),
        `Qualification: plan ${plan.elapsed_ms ?? '?'} ms, ${plan.api_calls ?? '?'} API calls; verdict ${ctx.calls} API calls.`, '',
    ].join('\n');
    if (opts.summary) appendFileSync(opts.summary, summary);
    for (const [lane, value] of Object.entries(lanes)) if (value.status === 'incomplete') console.error(`::error::${lane}: ${value.reason}`);
    for (const [job, value] of setup) console.error(`::error::${job} ended with ${value}`);
    console.log(JSON.stringify({ schema: 1, ok, lanes }));
    process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const opts = options(process.argv.slice(2));
    const commands = { fingerprint: fingerprintCommand, plan: planCommand, record: recordCommand, verdict: verdictCommand };
    if (!commands[opts.command]) usage('the command is fingerprint, plan, record or verdict');
    commands[opts.command](opts);
}
