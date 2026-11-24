#!/usr/bin/env node
/**
 * Reuse of an earlier pass of a CI lane whose inputs are unchanged (docs/TESTING.md, *Reused lanes*).
 *
 * Each fingerprint hashes the committed tree, with selected administrative files kept by path and mode only.
 * The browser lanes also omit regular files absent from their sparse checkout. The CI workflow, this tool,
 * and the pinned versions are inputs. CI result records a marker artifact for each lane that ran:
 * `ci-pass-v1-<lane>-<fingerprint>` when every job of the lane passed,
 * `ci-fail-v1-...` when one failed. A later run with the same fingerprint takes the markers newest first: a failure from
 * a verified producer stops the search, and the first pass that verifies is reused (at most its MAX_AGE_HOURS old, from a push
 * or manual run of ci.yml in this repository whose lane jobs all passed in their latest attempt, the fingerprint
 * recomputed at the producer's commit the same). Anything missing, ambiguous or failing to load runs the lane.
 *
 *   fingerprint --sha <rev>
 *   plan --repo <o/r> --sha <sha> --selection <file> [--ref <ref>] [--reuse on|off] [--event push|pull_request|daily|dispatch|engines]
 *        [--engines-on daily|every-push] [--engines true|false] [--chromium-shards <1-20>] --out <plan.json> [--github-output <f>]
 *   record --plan <plan.json> --jobs <jobs.json> --needs <needs.json> [--shards <dir>] --run-id <n> --run-attempt <n> --out <dir> [--github-output <f>]
 *   verdict --plan <plan.json> --needs <needs.json> --jobs <jobs.json> --repo <o/r> [--summary <f>] [--github-output <f>]
 *   finish  record's and verdict's options: record, then verdict (CI result's one step)
 *   require --lane <reusable lane> --repo <o/r> --sha <sha> [--chromium-shards <n>]   (exit 0: a pass that verifies; 1: none)
 *
 * One CI matrix runs Toolkit Chromium (`demo`, CHROMIUM_SHARDS jobs), the example app's Chromium project
 * (`demo-app`, one job), and both suites in Firefox and WebKit (`engines`, three shards per engine or four on its dedicated dispatch).
 * With ENGINES_ON=daily the engines run
 * on dev's daily run (unless they already passed on its inputs), on main, when a manual run asks for them, and when the
 * release pull request's Release checks finds no pass for its head and starts one; on any other push they are deferred
 * (not run at this stage, said so in CI result), unless a pass on the same inputs exists. ENGINES_ON=every-push runs them
 * on every push, as before the trial.
 * Common: --gh <command> (gh), --git-dir <dir> (.), --now <ISO time> (the clock), --budget-ms <n> (60000),
 * --retry-delay-ms <n> (1000: the verdict retries a failed API call twice, after it and twice it).
 *
 * Self-contained (Node's own modules only). CI result runs the copy at the run's commit, from its own checkout, and takes
 * only the plan from the Changes job's artifact, by its id and SHA-256.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

/** every lane of ci.yml's Changes job, in its order: the selector's, then the engines, which follow the browser tests */
export const LANES = ['lint-kit', 'php', 'static-site', 'runtime-export', 'fresh-install', 'contrast', 'demo', 'demo-app', 'workflows', 'package-docs', 'package', 'prod-image', 'engines'];
const TOOLKIT_BROWSER_JOB = 'Toolkit browser verification';
const CROSS_BROWSER_JOB = 'Cross-browser verification';
const DEMO_APP_BROWSER_JOB = 'Demo app browser checks';
const BROWSER_LANE_NAMES = { demo: TOOLKIT_BROWSER_JOB, 'demo-app': DEMO_APP_BROWSER_JOB, engines: CROSS_BROWSER_JOB };
const DEMO_APP_BROWSER = { name: `${DEMO_APP_BROWSER_JOB} (chromium 1/1)`, count: 1 };

/**
 * The reusable lanes, their job names in ci.yml and the job count for a full pass. The website and runtime exports
 * include revision metadata and run fresh when selected.
 */
export const REUSABLE = {
    php: { name: 'Kit PHP', count: 1 },
    demo: { prefix: `${TOOLKIT_BROWSER_JOB} (chromium `, count: null }, // CHROMIUM_SHARDS
    engines: { prefixes: [`${CROSS_BROWSER_JOB} (firefox `, `${CROSS_BROWSER_JOB} (webkit `] },
    'prod-image': { name: 'Production image', count: 1 },
    // the lanes that resolve dependencies live (MAX_AGE_HOURS: a day)
    'fresh-install': { names: ['Fresh install', 'Fresh install (Symfony Docker, from GitHub)'], count: 2 },
    'lint-kit': { prefix: 'Lint kit (', count: 2 },
    package: { name: 'Package', count: 1 },
};
export const DEFAULT_CHROMIUM_SHARDS = 6;
/** the browser lanes share one job (`demo` in `needs`): the verdict reads them from the run's jobs */
const BROWSER_LANES = ['demo', 'engines'];
const BROWSER_MATRIX_LANES = [...BROWSER_LANES, 'demo-app'];
const ENGINE_BROWSERS = ['firefox', 'webkit'];
const ENGINE_SHARDS = 3;
const ENGINE_DISPATCH_SHARDS = 4;
const ENGINE_DISPATCH_TITLE = 'CI: Firefox and WebKit only';
const DEFERRED = "NOT RUN AT THIS STAGE: Firefox and WebKit run on dev's daily run, on the release pull request, or by a manual run with engines";
/** read by people, agents and Contrast only: no reusable lane's job reads them (export-ignored, not in the image) */
export const EXCLUDED = ['CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', '.github/pull_request_template.md'];
/**
 * The lanes each excluded file's content is left out for: those that never read it. All of them are export-ignored and
 * kept out of the production image, and the demo only links them; but Package's references step reads CHANGELOG.md's
 * latest version heading (packages/uxor/tools/ReferenceGenerator.php, releaseRef), so CHANGELOG.md's content is
 * Package's input.
 */
export const EXCLUDED_FOR = Object.fromEntries(EXCLUDED.map((file) => [file,
    Object.keys(REUSABLE).filter((lane) => !(file === 'CHANGELOG.md' && lane === 'package'))]));
const excludedFor = (lane) => EXCLUDED.filter((file) => EXCLUDED_FOR[file].includes(lane));
/**
 * How old a pass may be, per lane. The installs, Lint kit and Package resolve dependencies live (a fresh Symfony
 * skeleton and Symfony Docker, the Toolkit and the consumer's packages from Packagist): their evidence goes stale with
 * time, not with the tree. dev's daily run checks that drift, and never reuses them; a pass on the same tree within a
 * day says what a run minutes later would say.
 */
export const MAX_AGE_HOURS = { default: 14 * 24, 'fresh-install': 24, 'lint-kit': 24, package: 24 };
const maxAge = (lane) => MAX_AGE_HOURS[lane] ?? MAX_AGE_HOURS.default;
const WORKFLOW = '.github/workflows/ci.yml';
const PRODUCER_EVENTS = ['push', 'workflow_dispatch'];
/** the jobs of ci.yml that make up each lane, as CI result's `needs` names them */
// the engines run in the browser job (`demo` in `needs`): without the run's job list, a failed browser job may be an
// engines failure, and cannot be told from one before the tests started, so the safe direction is that its marker was due
const NEEDS = { 'fresh-install': ['fresh-install', 'docker-install'], engines: ['demo'] };
const SETUP_NEEDS = ['changes', 'tools', 'importmap'];
/** the checks that are steps of the Quick checks job (`quick` in `needs`): their outcomes are its outputs */
const QUICK_CHECKS = ['tools', 'contrast', 'workflows'];
const IMPORTMAP_USERS = ['php', 'runtime-export', 'demo', 'demo-app', 'engines'];
const MARKER_LIMIT = 65536;
const RERUN_NOTE = 'only "Re-run all jobs" plans the lanes again; re-running failed jobs reuses this plan';

class Refused extends Error {
    constructor(reason, detail) {
        super(detail);
        this.reason = reason;
    }
}

/** any error in a lookup, as a refusal: a crash never decides a lane */
const refusal = (error) => (error instanceof Refused ? error : new Refused('lookup_error', `unexpected: ${error?.message ?? error}`));

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

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// git -------------------------------------------------------------------------------------------------------------------

function git(dir, args) {
    return spawnSync('git', ['-C', dir, ...args], { encoding: 'buffer', maxBuffer: 1 << 28 });
}

// Use Git's own sparse-checkout matcher on the tree of the commit being qualified. Only regular
// files outside the runner's checkout may be omitted. A symlink can point to another path, so a
// tree with any link or submodule falls back to hashing every entry. Unknown paths are included.
const BROWSER_RULES = 'tools/ci/browser-checkout.patterns';
const BROWSER_CONTROLS = new Set([BROWSER_RULES, WORKFLOW, 'tools/ci/lane-evidence.mjs', 'tools/ci-changes.sh', 'tools/tests/ci-changes.sh']);

function browserControl(path) {
    return BROWSER_CONTROLS.has(path) || ['.gitattributes', '.gitignore'].includes(path.split('/').at(-1));
}

function browserCheckout(dir, paths, entries) {
    const rules = fileURLToPath(new URL('./browser-checkout.patterns', import.meta.url));
    const expected = entries.find((entry) => entry.endsWith('\t' + BROWSER_RULES));
    const actual = git(dir, ['hash-object', '--no-filters', rules]);
    // A verifier can inspect a commit other than its own checkout. Apply the rules only if this
    // exact file was in the commit. An older/different policy is compared as a complete tree.
    if (actual.status !== 0 || !expected || expected.split('\t')[0].split(' ')[2] !== actual.stdout.toString().trim()) return null;
    const result = spawnSync('git', ['-C', dir, 'sparse-checkout', 'check-rules', '--no-cone', '--rules-file', rules, '-z'], {
        input: paths.join('\0') + '\0', encoding: 'utf8', maxBuffer: 1 << 28,
    });
    // Older Git installations lack check-rules. They can still qualify identical trees.
    if (result.status !== 0) return null;
    return new Set(result.stdout.split('\0').filter(Boolean));
}

// Playwright specs in the demo suite and in recipes are outside these lanes' archives, production
// image and Tailwind sources. They still contribute their paths and modes to each fingerprint.
const SPEC_INDEPENDENT_LANES = ['php', 'package', 'prod-image', 'lint-kit', 'fresh-install'];

function playwrightSpecs(paths) {
    const names = new Set(paths);
    return new Set(paths.filter((path) => {
        if (!path.endsWith('.spec.ts')) return false;
        if (path.startsWith('tests/e2e/')) return true;
        const recipe = /^([^/]+)\/tests\/[^/]+\.spec\.ts$/.exec(path);
        return recipe && names.has(`${recipe[1]}/manifest.json`);
    }));
}

export function fingerprints(dir, sha) {
    const tree = git(dir, ['ls-tree', '-r', '-z', '--full-tree', sha]);
    if (tree.status !== 0) throw new Refused('producer_commit_unavailable', `git ls-tree ${sha}: ${tree.stderr.toString().trim()}`);
    const all = tree.stdout.toString('utf8').split('\0').filter(Boolean);
    // Links or submodules can expose excluded files through another path.
    const regularPaths = all.every((entry) => entry.startsWith('100'))
        ? all.map((entry) => entry.slice(entry.indexOf('\t') + 1)) : null;
    const browserPaths = regularPaths && browserCheckout(dir, regularPaths, all);
    const specs = regularPaths ? playwrightSpecs(regularPaths) : new Set();
    return Object.fromEntries(Object.keys(REUSABLE).map((lane) => {
        const excluded = excludedFor(lane);
        const browser = BROWSER_LANES.includes(lane);
        const ignoresSpecContent = SPEC_INDEPENDENT_LANES.includes(lane);
        const body = all.map((entry) => {
            const tab = entry.indexOf('\t');
            const path = entry.slice(tab + 1);
            // The kit's checks, install archives and production image exclude the standalone website.
            // Package can publish a guide from any directory. Browser lanes follow their own checkout policy below.
            if (regularPaths && !browser && lane !== 'package' && path.startsWith('website/') && !browserControl(path)) return '';
            if (browser) {
                if (!browserPaths || browserControl(path)) return entry + '\0';
                if (!browserPaths.has(path)) return '';
            }
            if (!excluded.includes(path) && !(ignoresSpecContent && specs.has(path))) return entry + '\0';
            const [mode, type] = entry.slice(0, tab).split(' ');
            return `${mode} ${type} -${entry.slice(tab)}\0`;
        }).join('');
        return [lane, createHash('sha256').update(`uxor-lane-evidence/3\0${lane}\0`).update(body).digest('hex')];
    }));
}

/** the producer's commit, fetched by its id when this clone lacks it, without making the clone shallow */
function ensureCommit(dir, sha) {
    if (git(dir, ['cat-file', '-e', `${sha}^{commit}`]).status === 0) return;
    const fetched = git(dir, ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', sha]);
    if (fetched.status !== 0 || git(dir, ['cat-file', '-e', `${sha}^{commit}`]).status !== 0) {
        throw new Refused('producer_commit_unavailable', `the producer's commit ${sha} cannot be fetched`);
    }
}

// GitHub's API ------------------------------------------------------------------------------------------------------------

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `gh api`; with `retries`, a failure other than a 4xx answer (429 aside) is tried again after a growing delay */
function api(ctx) {
    return {
        raw(path) {
            // answered already by the plan's concurrent prefetch
            if (ctx.cache?.has(path)) return ctx.cache.get(path);
            for (let attempt = 0; ; attempt++) {
                const remaining = ctx.deadline - Date.now();
                if (remaining <= 0) throw new Refused('lookup_error', 'the lookup ran out of time');
                ctx.calls++;
                const result = spawnSync(ctx.gh, ['api', path], { encoding: 'buffer', maxBuffer: 1 << 26, timeout: Math.min(20000, remaining) });
                if (result.status === 0) return result.stdout;
                const error = (result.stderr ?? '').toString().trim() || 'failed';
                const status = Number(error.match(/HTTP (\d{3})/)?.[1]);
                const permanent = status >= 400 && status < 500 && status !== 429;
                if (permanent || attempt >= ctx.retries) throw new Refused('lookup_error', `gh api ${path}: ${error}`);
                sleep(Math.max(0, Math.min(ctx.retryDelay * 2 ** attempt, ctx.deadline - Date.now())));
            }
        },
        object(path) {
            let value;
            try {
                value = JSON.parse(this.raw(path).toString('utf8'));
            } catch (error) {
                if (error instanceof Refused) throw error;
                throw new Refused('lookup_error', `gh api ${path}: not JSON`);
            }
            if (!isObject(value)) throw new Refused('lookup_error', `gh api ${path}: not an object`);
            return value;
        },
    };
}

/** one `gh api` call without blocking: its answer, or null on any error (the synchronous call then fails as usual) */
function ghAsync(ctx, path) {
    return new Promise((resolve) => {
        const child = spawn(ctx.gh, ['api', path], { stdio: ['ignore', 'pipe', 'ignore'] });
        const chunks = [];
        const timer = setTimeout(() => child.kill(), 20000);
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.on('error', () => { clearTimeout(timer); resolve(null); });
        child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? Buffer.concat(chunks) : null); });
    });
}

/** fetches these paths at the same time, at most eight at once, into the cache the synchronous checks read */
async function prefetch(ctx, paths) {
    const todo = [...new Set(paths)].filter((path) => !ctx.cache.has(path));
    for (let i = 0; i < todo.length; i += 8) {
        const answers = await Promise.all(todo.slice(i, i + 8).map(async (path) => {
            ctx.calls++;
            return [path, await ghAsync(ctx, path)];
        }));
        for (const [path, answer] of answers) if (answer) ctx.cache.set(path, answer);
    }
}

/**
 * The plan's lookups, ahead of its checks: every lane's pass and failure listings at once, then, for each lane's newest
 * pass, its ZIP, its run and the run's jobs at once (a run shared by lanes is fetched once). Only answers are cached:
 * what failed here is asked again, and fails, in the checks, which decide exactly as without this.
 */
async function prefetchLookups(ctx, lanes) {
    const listing = (kind, lane, fp) => `repos/${ctx.repo}/actions/artifacts?name=${markerName(kind, lane, fp)}&per_page=100`;
    await prefetch(ctx, lanes.flatMap(({ lane, fp }) => [listing('pass', lane, fp), listing('fail', lane, fp)]));
    const next = [];
    for (const { lane, fp } of lanes) {
        let artifacts;
        try {
            artifacts = JSON.parse(ctx.cache.get(listing('pass', lane, fp))?.toString('utf8') ?? 'null')?.artifacts;
        } catch {
            continue;
        }
        if (!Array.isArray(artifacts)) continue;
        const newest = artifacts.filter((a) => isObject(a) && Number.isInteger(a.id) && Number.isInteger(a.workflow_run?.id))
            .sort((a, b) => time(b.created_at) - time(a.created_at))[0];
        if (!newest) continue;
        next.push(`repos/${ctx.repo}/actions/artifacts/${newest.id}/zip`, `repos/${ctx.repo}/actions/runs/${newest.workflow_run.id}`,
            `repos/${ctx.repo}/actions/runs/${newest.workflow_run.id}/jobs?filter=latest&per_page=100`);
    }
    await prefetch(ctx, next);
}

/** the one file of a small artifact ZIP, without extracting anything */
export function zipEntry(buffer, wanted) {
    const fail = (detail) => { throw new Refused('marker_invalid', `the marker's ZIP: ${detail}`); };
    if (buffer.length > MARKER_LIMIT) fail('too large');
    if (buffer.length < 22) fail('too short');
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
    const rule = lane === 'demo-app' ? DEMO_APP_BROWSER : REUSABLE[lane];
    const prefixes = rule.prefixes ?? (rule.prefix !== undefined ? [rule.prefix] : []);
    const names = rule.names ?? (rule.name !== undefined ? [rule.name] : null);
    return jobs.filter((job) => isObject(job) && typeof job.name === 'string'
        && (names ? names.includes(job.name) : prefixes.some((prefix) => job.name.startsWith(prefix))));
}

/** how many jobs a full pass of the lane has */
function expected(lane, chromiumShards, enginesOnly) {
    if (lane === 'demo') return chromiumShards;
    if (lane === 'engines') return ENGINE_BROWSERS.length * (enginesOnly ? ENGINE_DISPATCH_SHARDS : ENGINE_SHARDS);
    return (REUSABLE[lane] ?? DEMO_APP_BROWSER).count;
}

const isEngineDispatch = (run) => run.event === 'workflow_dispatch' && run.display_title === ENGINE_DISPATCH_TITLE;

function completeJobSet(lane, jobs, count) {
    if (jobs.length !== count) return false;
    if (lane !== 'engines') return true;
    const shards = count / ENGINE_BROWSERS.length;
    const names = new Set(jobs.map((job) => job.name));
    return ENGINE_BROWSERS.every((browser) => Array.from({ length: shards }, (_, i) =>
        `${CROSS_BROWSER_JOB} (${browser} ${i + 1}/${shards})`).every((name) => names.has(name)));
}

function chromiumShards(value) {
    const shards = value === undefined ? DEFAULT_CHROMIUM_SHARDS : Number(value);
    if (!Number.isInteger(shards) || shards < 1 || shards > 20) usage('--chromium-shards is a whole number from 1 to 20');
    return shards;
}

/**
 * A browser job that failed before its tests started (its setup: the image, the demo, the browsers) says nothing about
 * the tests: incomplete, not failed. Without the job's steps, it counts as failed.
 */
const TESTS_STEP = 'Playwright (';
export function testsFailed(job) {
    if (!['failure', 'timed_out'].includes(job.conclusion)) return false;
    if (!Array.isArray(job.steps)) return true;
    const tests = job.steps.find((step) => isObject(step) && String(step.name).startsWith(TESTS_STEP));
    return Boolean(tests) && ['success', 'failure', 'timed_out'].includes(tests.conclusion);
}

const markerName = (kind, lane, fp) => `ci-${kind}-v1-${lane}-${fp}`;
const time = (value) => Date.parse(value ?? '');
const ids = (list) => list.map((job) => job?.id).sort((a, b) => a - b).join(',');

function markers(client, repo, kind, lane, fp) {
    const name = markerName(kind, lane, fp);
    const list = client.object(`repos/${repo}/actions/artifacts?name=${name}&per_page=100`);
    if (!Array.isArray(list.artifacts)) throw new Refused('lookup_error', `the ${kind} markers' listing has no artifacts`);
    if (list.artifacts.some((a) => !isObject(a) || !Number.isInteger(a.id) || Number.isNaN(time(a.created_at)))) {
        throw new Refused('lookup_error', `the ${kind} markers' listing holds an artifact without an id or a creation time`);
    }
    return list.artifacts.filter((artifact) => artifact.name === name).map((artifact) => ({ ...artifact, kind }));
}

/** every marker for the lane's fingerprint, newest first (a failure first when two share a time) */
function candidates(client, ctx, lane, fp) {
    return [...markers(client, ctx.repo, 'pass', lane, fp), ...markers(client, ctx.repo, 'fail', lane, fp)]
        .sort((a, b) => time(b.created_at) - time(a.created_at) || (a.kind === 'fail' ? -1 : 1));
}

function checkExpired(artifact) {
    if (artifact.expired) throw new Refused('evidence_expired', `marker ${artifact.id} has expired`);
}

/** when the lane's evidence was made: its oldest job's completion (a re-run's marker is no younger than its jobs) */
export function completedAt(jobs) {
    if (!jobs.length || jobs.some((job) => Number.isNaN(time(job?.completed_at)))) return null;
    return jobs.reduce((oldest, job) => (time(job.completed_at) < time(oldest.completed_at) ? job : oldest)).completed_at;
}

/** the age of a pass is its lane jobs' completion, as the jobs API reports it, not its marker's creation */
function checkAge(ctx, completed, lane, what) {
    const age = ctx.now - time(completed);
    if (Number.isNaN(age) || age > maxAge(lane) * 3600000) {
        throw new Refused('evidence_too_old', `${what}: its ${lane} jobs completed ${Math.floor(age / 3600000)} hours ago (at most ${maxAge(lane)})`);
    }
}

/** the producer run, checked against its marker's artifact: ci.yml, a push or manual run, this repository's */
function producerRun(client, ctx, artifact) {
    const origin = isObject(artifact.workflow_run) ? artifact.workflow_run : {};
    if (!Number.isInteger(origin.id)) throw new Refused('wrong_producer', 'the marker names no run');
    const run = ctx.runs.get(origin.id) ?? client.object(`repos/${ctx.repo}/actions/runs/${origin.id}`);
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

/** the lane's jobs in the run's latest attempt: the full count, all passed */
/** the run's jobs in its latest attempt, fetched once per run */
function runJobs(client, ctx, run) {
    let jobs = ctx.jobs.get(run.id);
    if (!jobs) {
        jobs = client.object(`repos/${ctx.repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`).jobs;
        if (!Array.isArray(jobs) || jobs.some((job) => !isObject(job))) throw new Refused('lookup_error', `run ${run.id}: no job list`);
        ctx.jobs.set(run.id, jobs);
    }
    return jobs;
}

function producerJobs(client, ctx, lane, run) {
    const mine = laneJobs(lane, runJobs(client, ctx, run));
    const count = expected(lane, ctx.chromiumShards, isEngineDispatch(run));
    const complete = completeJobSet(lane, mine, count);
    const bad = mine.filter((job) => job.conclusion !== 'success');
    if (!complete || bad.length) {
        const identities = mine.length === count && !complete ? ', wrong shard identities' : '';
        throw new Refused('jobs_incomplete', `run ${run.id}: ${mine.length} of ${count} ${lane} jobs${identities}${bad.length ? `, ${bad.map((job) => `${job.name} ${job.conclusion}`).join(', ')}` : ''}`);
    }
    return mine;
}

/** one pass marker, verified in full; throws Refused */
function verifyPass(client, ctx, lane, fp, artifact) {
    checkExpired(artifact);
    const run = producerRun(client, ctx, artifact);
    const jobs = producerJobs(client, ctx, lane, run);
    const completed = completedAt(jobs);
    if (!completed) throw new Refused('marker_invalid', `run ${run.id} lists no completion time for its ${lane} jobs`);
    checkAge(ctx, completed, lane, `marker ${artifact.id}`);
    let marker;
    try {
        marker = JSON.parse(zipEntry(client.raw(`repos/${ctx.repo}/actions/artifacts/${artifact.id}/zip`), 'evidence.json').toString('utf8'));
    } catch (error) {
        if (error instanceof Refused) throw error;
        throw new Refused('marker_invalid', 'evidence.json is not JSON');
    }
    const problems = [
        !isObject(marker) && 'shape',
        marker?.schema !== 1 && 'schema',
        marker?.kind !== 'pass' && `kind ${marker?.kind}`,
        marker?.lane !== lane && `lane ${marker?.lane}`,
        marker?.fingerprint !== fp && 'fingerprint',
        marker?.run_id !== run.id && 'run',
        marker?.sha !== run.head_sha && 'commit',
        (!Array.isArray(marker?.jobs) || ids(marker.jobs) !== ids(jobs)) && 'jobs (the run lists others now)',
        time(marker?.completed_at) !== time(completed) && 'completion time (the jobs API says otherwise)',
    ].filter(Boolean);
    if (problems.length) throw new Refused('marker_invalid', `marker ${artifact.id} disagrees on its ${problems.join(', ')}`);
    ensureCommit(ctx.gitDir, run.head_sha);
    if (fingerprints(ctx.gitDir, run.head_sha)[lane] !== fp) {
        throw new Refused('fingerprint_mismatch', `the inputs of ${lane} at ${run.head_sha} differ from this commit's`);
    }
    return {
        artifact_id: artifact.id, artifact_name: artifact.name, run_id: run.id, run_attempt: marker.run_attempt ?? null,
        head_sha: run.head_sha, head_branch: run.head_branch ?? null, created_at: artifact.created_at, completed_at: completed,
        url: run.html_url ?? `https://github.com/${ctx.repo}/actions/runs/${run.id}`,
        jobs: jobs.map(({ id, name, conclusion, run_attempt }) => ({ id, name, conclusion, run_attempt })),
        flaky: Number.isInteger(marker.flaky) ? marker.flaky : null, tests: marker.tests ?? null,
    };
}

/** a failure marker counts only from a verified producer; one that does not verify is no evidence either way */
/**
 * A failure marker vetoes the lane's evidence only when its run really failed that lane on these inputs, as a pass is
 * verified: a producer run of ci.yml in this repository, a lane job of its latest attempt that failed (the tests, for
 * the browser lanes, as the record step decides), the marker's own record agreeing on its kind, lane, fingerprint, run
 * and commit, and the fingerprint recomputed at the producer's commit equal. Any job of a same-repository run can upload
 * an artifact under the predictable name, so a marker that fails these counts for nothing. A lookup that fails throws:
 * the lane then runs, never a reuse past a failure that could not be checked.
 */
function verifiedFailure(client, ctx, lane, fp, artifact) {
    let run;
    try {
        run = producerRun(client, ctx, artifact);
    } catch (error) {
        if (error instanceof Refused && error.reason === 'wrong_producer') return false;
        throw error;
    }
    const mine = laneJobs(lane, runJobs(client, ctx, run));
    const failed = BROWSER_LANES.includes(lane)
        ? mine.some(testsFailed)
        : mine.some((job) => job.conclusion === 'failure' || job.conclusion === 'timed_out');
    if (!failed) return false;
    let marker;
    try {
        marker = JSON.parse(zipEntry(client.raw(`repos/${ctx.repo}/actions/artifacts/${artifact.id}/zip`), 'evidence.json').toString('utf8'));
    } catch (error) {
        if (error instanceof Refused && error.reason === 'lookup_error') throw error;
        return false;
    }
    if (!isObject(marker) || marker.kind !== 'fail' || marker.lane !== lane || marker.fingerprint !== fp
        || marker.run_id !== run.id || marker.sha !== run.head_sha) return false;
    ensureCommit(ctx.gitDir, run.head_sha);
    return fingerprints(ctx.gitDir, run.head_sha)[lane] === fp;
}

/** newest first: a verified failure stops the search, the first pass that verifies is the evidence */
function qualify(client, ctx, lane, fp) {
    let last = null;
    for (const artifact of candidates(client, ctx, lane, fp)) {
        if (artifact.kind === 'fail') {
            if (verifiedFailure(client, ctx, lane, fp, artifact)) {
                throw new Refused('later_failure', `run ${artifact.workflow_run?.id} failed the lane with these inputs at ${artifact.created_at}${last ? '' : ', after any pass'}`);
            }
            continue;
        }
        try {
            return verifyPass(client, ctx, lane, fp, artifact);
        } catch (error) {
            if (!(error instanceof Refused) || error.reason === 'lookup_error') throw error;
            last = error;
        }
    }
    throw last ?? new Refused('no_evidence', `no marker ${markerName('pass', lane, fp)}`);
}

/** the plan's evidence, checked again at the verdict */
function requalify(client, ctx, lane, fp, evidence) {
    if (!isObject(evidence)) throw new Refused('marker_invalid', 'the plan holds no evidence');
    const artifact = client.object(`repos/${ctx.repo}/actions/artifacts/${evidence.artifact_id}`);
    if (artifact.name !== evidence.artifact_name) throw new Refused('marker_invalid', `artifact ${evidence.artifact_id} is now ${artifact.name}`);
    // age is decided once, by the plan: a pass planned at the edge of its age is not refused minutes later. Expiry,
    // disappearance, a later failure and the producer's jobs are integrity, and are checked again
    checkExpired(artifact);
    for (const failure of markers(client, ctx.repo, 'fail', lane, fp)) {
        if (time(failure.created_at) >= time(artifact.created_at) && verifiedFailure(client, ctx, lane, fp, failure)) {
            throw new Refused('later_failure', `run ${failure.workflow_run?.id} failed the lane with these inputs at ${failure.created_at}, after the pass the plan reuses`);
        }
    }
    const run = producerRun(client, ctx, artifact);
    if (run.id !== evidence.run_id) throw new Refused('wrong_producer', 'another run');
    const jobs = producerJobs(client, ctx, lane, run);
    if (!Array.isArray(evidence.jobs) || ids(jobs) !== ids(evidence.jobs)) throw new Refused('jobs_incomplete', `run ${run.id} lists other ${lane} jobs than the plan reused`);
}

function context(opts, retries) {
    const now = opts.now ? Date.parse(opts.now) : Date.now();
    if (Number.isNaN(now)) usage('--now is not a time');
    return {
        repo: opts.repo, gh: opts.gh ?? 'gh', gitDir: opts['git-dir'] ?? '.', now, calls: 0, runs: new Map(), jobs: new Map(), cache: new Map(),
        deadline: Date.now() + Number(opts['budget-ms'] ?? 60000), retries, retryDelay: Number(opts['retry-delay-ms'] ?? 1000),
        chromiumShards: chromiumShards(opts['chromium-shards']),
    };
}

function writeOutputs(file, values) {
    if (file) appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return undefined;
    }
}

// commands ----------------------------------------------------------------------------------------------------------------

function fingerprintCommand(opts) {
    need(opts, 'sha');
    const dir = opts['git-dir'] ?? '.';
    const sha = git(dir, ['rev-parse', '--verify', `${opts.sha}^{commit}`]).stdout.toString().trim();
    if (!sha) usage(`no commit ${opts.sha}`);
    console.log(JSON.stringify({ schema: 1, sha, excluded: Object.fromEntries(Object.keys(REUSABLE).map((lane) => [lane, excludedFor(lane)])), lanes: fingerprints(dir, sha) }));
}

async function planCommand(opts) {
    need(opts, 'repo', 'sha', 'selection', 'out');
    const started = Date.now();
    const ctx = context(opts, 0);
    const client = api(ctx);
    const event = opts.event ?? 'push';
    if (!['push', 'pull_request', 'daily', 'dispatch', 'engines'].includes(event)) usage('--event is push, pull_request, daily, dispatch or engines');
    const enginesOn = opts['engines-on'] ?? 'daily';
    if (!['daily', 'every-push'].includes(enginesOn)) usage('--engines-on is daily or every-push');
    const selected = Object.fromEntries(readFileSync(opts.selection, 'utf8').split('\n').filter(Boolean).map((line) => {
        const [lane, value] = line.split('=');
        return [lane, value === 'true'];
    }));
    // Toolkit input changes select cross-engine verification. Daily and release runs can select it explicitly.
    selected.engines ??= selected.demo ?? true;
    const reuseOff = opts.ref === 'refs/heads/main' ? 'main' : opts.reuse === 'off' ? 'switch' : null;
    // when the engines run rather than wait: on main, with ENGINES_ON=every-push, when a manual run asks, on the daily run
    const enginesNow = opts.ref === 'refs/heads/main' || enginesOn === 'every-push' || opts.engines === 'true' || event === 'daily' || event === 'engines';
    // every reusable lane's fingerprint, whatever the switch: the run records what it ran under it
    let own = null;
    let ownError = null;
    try {
        own = fingerprints(ctx.gitDir, opts.sha);
    } catch (error) {
        ownError = refusal(error);
    }
    // the lanes that will look evidence up, all fetched at once before the checks below
    if (!reuseOff && own) {
        await prefetchLookups(ctx, LANES.filter((lane) => REUSABLE[lane] && (selected[lane] ?? true)).map((lane) => ({ lane, fp: own[lane] })));
    }
    const lanes = {};
    for (const lane of LANES) {
        const entry = { selected: selected[lane] ?? true, decision: 'run', fingerprint: own?.[lane] ?? null, reason: '', detail: '', evidence: null };
        if (REUSABLE[lane] || lane === 'demo-app') entry.jobs_expected = expected(lane, ctx.chromiumShards, event === 'engines');
        lanes[lane] = entry;
        if (!entry.selected) Object.assign(entry, { decision: 'skip', reason: 'not_selected', detail: 'the change cannot affect it' });
        else if (!REUSABLE[lane]) Object.assign(entry, { reason: 'not_reusable', detail: 'it always runs when selected' });
        else if (reuseOff) Object.assign(entry, { reason: 'reuse_off', detail: reuseOff === 'main' ? 'main always runs fresh' : 'reuse is switched off' });
        else if (event === 'daily' && maxAge(lane) < MAX_AGE_HOURS.default) {
            Object.assign(entry, { reason: 'daily_fresh', detail: "dev's daily run checks today's dependency resolution: it never reuses this lane" });
        }
        else if (ownError) Object.assign(entry, { reason: ownError.reason, detail: ownError.message });
        else {
            try {
                entry.evidence = qualify(client, ctx, lane, entry.fingerprint);
                Object.assign(entry, { decision: 'reuse', reason: 'reused', detail: `run ${entry.evidence.run_id} passed it on ${entry.evidence.head_sha}` });
            } catch (error) {
                const refused = refusal(error);
                Object.assign(entry, { decision: 'run', reason: refused.reason, detail: refused.message, evidence: null });
            }
        }
        if (lane === 'engines' && entry.decision === 'run' && !enginesNow) {
            Object.assign(entry, { decision: 'defer', reason: 'deferred', detail: DEFERRED });
        }
    }
    // A fresh Package job already validates the manifest, command reference and package tests.
    // Only a fresh run covers this checkout's documentation job. A reused consumer result does not.
    if (lanes.package.decision === 'run' && lanes['package-docs'].decision === 'run') {
        Object.assign(lanes['package-docs'], { decision: 'skip', reason: 'covered_by_package', detail: 'the fresh Package job runs these checks' });
    }
    const include = [];
    if (lanes.demo.decision === 'run') {
        for (let shard = 1; shard <= ctx.chromiumShards; shard++) {
            include.push({
                suite: TOOLKIT_BROWSER_JOB, browser: 'chromium', 'artifact-browser': 'chromium', shard, shards: ctx.chromiumShards,
                projects: '--project=smoke --project=examples',
            });
        }
    }
    if (lanes['demo-app'].decision === 'run') {
        include.push({
            suite: DEMO_APP_BROWSER_JOB, browser: 'chromium', 'artifact-browser': 'demo-app-chromium', shard: 1, shards: 1,
            projects: '--project=demo-app',
        });
    }
    if (lanes.engines.decision === 'run') {
        const shards = event === 'engines' ? ENGINE_DISPATCH_SHARDS : ENGINE_SHARDS;
        for (const browser of ENGINE_BROWSERS) {
            for (let shard = 1; shard <= shards; shard++) {
                include.push({
                    suite: CROSS_BROWSER_JOB, browser, 'artifact-browser': browser, shard, shards,
                    projects: `--project=smoke-${browser} --project=examples-${browser} --project=demo-app-${browser}`,
                });
            }
        }
    }
    const plan = {
        schema: 1, repo: opts.repo, sha: opts.sha, ref: opts.ref ?? null, event, engines_on: enginesOn, chromium_shards: ctx.chromiumShards,
        reuse: !reuseOff, reuse_off: reuseOff, elapsed_ms: Date.now() - started, api_calls: ctx.calls, lanes,
    };
    writeFileSync(opts.out, `${JSON.stringify(plan, null, 2)}\n`);
    for (const [lane, entry] of Object.entries(lanes)) {
        const producer = entry.evidence ? ` run ${entry.evidence.run_id} attempt ${entry.evidence.run_attempt} on ${entry.evidence.head_sha} ${entry.evidence.url}` : '';
        console.log(`${lane}: ${entry.decision} (${entry.reason})${producer}${['run', 'defer'].includes(entry.decision) && entry.detail ? `: ${entry.detail}` : ''}`);
    }
    const count = (decision) => Object.values(lanes).filter((e) => e.decision === decision).length;
    const summary = `${count('reuse')} reused, ${count('run')} run, ${count('defer')} deferred, ${count('skip')} skipped; ${plan.elapsed_ms} ms, ${plan.api_calls} API calls`;
    console.log(summary);
    writeOutputs(opts['github-output'], {
        ...Object.fromEntries(Object.entries(lanes).map(([lane, entry]) => [lane, entry.decision])),
        importmap: IMPORTMAP_USERS.some((lane) => lanes[lane].decision === 'run') ? 'run' : 'skip',
        browsers: include.length ? 'run' : 'skip',
        'browser-matrix': JSON.stringify({ include }),
        'plan-summary': summary,
    });
}

/**
 * Release checks' requirement. With --sha: exit 0 when the lane has a pass at this commit that verifies, 1 otherwise.
 * With --merge (a pull request's merge commit) and --github-output: the head is the merge's second parent; a merge that
 * tests another tree than its head gets `<lane>=tree: …` (no pass on the head can stand for it), else `<lane>=pass` or
 * `<lane>=missing: …`, and the exit status is 0. The release verdict can wait for an engines-only dispatch on the
 * event's head. A workflow run can report why the wait failed, but only the verified marker can supply a pass.
 */
function requireCommand(opts) {
    need(opts, 'lane', 'repo');
    if (!REUSABLE[opts.lane]) usage(`${opts.lane} is not a lane whose pass is recorded`);
    if (opts.merge !== undefined) return requireMerge(opts);
    need(opts, 'sha');
    const ctx = context(opts, 2);
    const client = api(ctx);
    try {
        const evidence = qualify(client, ctx, opts.lane, fingerprints(ctx.gitDir, opts.sha)[opts.lane]);
        console.log(`${opts.lane}: passed by run ${evidence.run_id} attempt ${evidence.run_attempt} on ${evidence.head_sha} ${evidence.url}`);
    } catch (error) {
        const refused = refusal(error);
        console.log(`${opts.lane}: ${refused.reason}: ${refused.message}`);
        process.exitCode = 1;
    }
}

function requireMerge(opts) {
    need(opts, 'github-output');
    const dir = opts['git-dir'] ?? '.';
    const out = (value) => writeOutputs(opts['github-output'], { [opts.lane]: value.replace(/[\r\n]+/g, ' ') });
    const parents = git(dir, ['rev-list', '--parents', '-n', '1', opts.merge]).stdout.toString().trim().split(' ').slice(1);
    const head = parents.length === 2 ? parents[1] : null;
    const tree = (rev) => git(dir, ['rev-parse', '--verify', `${rev}^{tree}`]).stdout.toString().trim();
    if (opts.head !== undefined && head !== opts.head) {
        const line = `the merge's head ${head ?? 'unknown'} differs from the pull request event's head ${opts.head}`;
        console.log(`${opts.lane}: ${line}`);
        out(`tree: ${line}`);
        return;
    }
    const mergeTree = tree(opts.merge);
    if (!head || !mergeTree || mergeTree !== tree(head)) {
        const line = `the merge tests another tree than the head ${head ?? 'unknown'} (main has commits the branch lacks)`;
        console.log(`${opts.lane}: ${line}`);
        out(`tree: ${line}`);
        return;
    }
    if (opts['wait-seconds'] !== undefined) return waitForEngines(opts, head, out);
    const ctx = context(opts, 2);
    const client = api(ctx);
    try {
        const evidence = qualify(client, ctx, opts.lane, fingerprints(dir, head)[opts.lane]);
        console.log(`${opts.lane}: passed by run ${evidence.run_id} attempt ${evidence.run_attempt} on ${evidence.head_sha} ${evidence.url}`);
        out('pass');
    } catch (error) {
        const refused = refusal(error);
        const line = `${opts.lane}: ${refused.reason}: ${refused.message}`;
        console.log(line);
        out(`missing: ${line}`);
    }
}

function engineDispatch(client, ctx, opts, head) {
    const root = `repos/${ctx.repo}/actions`;
    const requested = Number(opts['run-id']);
    const matches = (run) => isObject(run) && Number.isSafeInteger(run.id) && (!requested || run.id === requested)
        && run.head_sha === head && run.head_branch === opts.branch && run.path === WORKFLOW
        && isEngineDispatch(run)
        && run.repository?.full_name === ctx.repo && run.head_repository?.full_name === ctx.repo;
    if (requested) {
        const run = client.object(`${root}/runs/${requested}`);
        if (!matches(run)) return { detail: `run ${requested} does not belong to the release's engine dispatch` };
        return { run };
    }
    const listing = client.object(`${root}/workflows/ci.yml/runs?branch=${encodeURIComponent(opts.branch)}&event=workflow_dispatch&head_sha=${head}&per_page=20`);
    if (!Array.isArray(listing.workflow_runs)) throw new Refused('lookup_error', 'the dispatch listing has no workflow runs');
    const since = time(opts.since);
    const run = listing.workflow_runs.filter((item) => matches(item) && time(item.created_at) >= since)
        .sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id)[0];
    return { run };
}

function waitForEngines(opts, head, out) {
    const seconds = Number(opts['wait-seconds']);
    const poll = Number(opts['wait-poll-ms'] ?? 10000);
    if (opts.lane !== 'engines' || opts.head !== head || !opts.branch
        || !Number.isInteger(seconds) || seconds < 1 || seconds > 1200
        || !Number.isInteger(poll) || poll < 1 || poll > 30000
        || (opts['run-id'] === undefined ? Number.isNaN(time(opts.since)) : opts.since !== undefined || !/^[1-9]\d*$/.test(opts['run-id']) || !Number.isSafeInteger(Number(opts['run-id'])))) {
        usage('waiting requires --lane engines, the PR --head, --branch, --wait-seconds 1..1200 and a --run-id or --since');
    }
    const deadline = Date.now() + seconds * 1000;
    const fp = fingerprints(opts['git-dir'] ?? '.', head).engines;
    let detail = 'the engine dispatch is not visible yet';
    let observed = '';
    while (Date.now() < deadline) {
        const ctx = context(opts, 0);
        ctx.deadline = Math.min(ctx.deadline, deadline);
        const client = api(ctx);
        try {
            const evidence = qualify(client, ctx, 'engines', fp);
            console.log(`engines: passed by run ${evidence.run_id} attempt ${evidence.run_attempt} on ${evidence.head_sha} ${evidence.url}`);
            out('pass');
            return;
        } catch (error) {
            const refused = refusal(error);
            detail = `${refused.reason}: ${refused.message}`;
        }
        try {
            const dispatch = engineDispatch(client, ctx, opts, head);
            if (dispatch.detail) {
                out(`incomplete: ${dispatch.detail}`);
                return;
            }
            const run = dispatch.run;
            if (run?.status === 'completed' && run.conclusion && run.conclusion !== 'success') {
                const jobs = laneJobs('engines', runJobs(client, ctx, run));
                // Another lane can fail the workflow even when engines passed and recorded a marker that is not visible yet.
                if (!completeJobSet('engines', jobs, expected('engines', ctx.chromiumShards, true)) || jobs.some((job) => job.conclusion !== 'success')) {
                    const failed = jobs.some((job) => Array.isArray(job.steps) && job.steps.some((step) => String(step?.name).startsWith(TESTS_STEP)
                        && ['failure', 'timed_out'].includes(step.conclusion)));
                    const url = `https://github.com/${opts.repo}/actions/runs/${run.id}`;
                    out(failed ? `failed: Firefox or WebKit tests failed in ${url}` : `incomplete: ${url} ended with ${run.conclusion} before producing a verified engine pass`);
                    return;
                }
            }
            const status = run ? `engine dispatch ${run.id}: ${run.conclusion ?? run.status}` : 'the engine dispatch is not visible yet';
            if (observed !== status) console.log(`engines: ${status}`);
            observed = status;
        } catch (error) {
            detail = refusal(error).message;
        }
        sleep(Math.max(0, Math.min(poll, deadline - Date.now())));
    }
    out(`timed_out: after waiting ${seconds} seconds for verified engine evidence (${observed || 'dispatch not observed'}; ${detail})`);
}

/** the browser shards' counts, from the results.json of each shard artifact of those browsers (playwright-results-<browser>-<n>) */
function testCounts(dir, browsers) {
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
    for (const name of readdirSync(dir)) {
        const child = join(dir, name);
        if (browsers.some((browser) => name.startsWith(`playwright-results-${browser}-`)) && statSync(child).isDirectory()) walk(child);
    }
    return found ? counts : null;
}

/**
 * The markers of the lanes that ran. A failure marker is never best effort: when one is due (a lane that ran ended
 * with a failure, by `needs`) and cannot be written, the command fails, so the step shows it. A pass marker that cannot
 * be written only warns.
 */
function recordCommand(opts) {
    need(opts, 'plan', 'jobs', 'needs', 'run-id', 'run-attempt', 'out');
    const plan = readJson(opts.plan);
    const needs = readJson(opts.needs) ?? {};
    const raw = readJson(opts.jobs);
    const jobs = Array.isArray(raw) && raw.length > 0 && raw.every(isObject) ? raw : null;
    const outputs = {};
    const lost = [];
    for (const lane of Object.keys(REUSABLE)) {
        outputs[`${lane}-marker`] = '';
        outputs[`${lane}-kind`] = '';
        const entry = plan?.lanes?.[lane];
        if (entry?.decision !== 'run') continue;
        // the browser lanes share one job: its result says one of them failed, not which
        const failedByNeeds = (NEEDS[lane] ?? [lane]).some((job) => ['failure', 'timed_out'].includes(needs[job]?.result));
        const fp = /^[0-9a-f]{64}$/.test(entry.fingerprint ?? '') ? entry.fingerprint : null;
        if (!jobs || !fp) {
            const why = !jobs ? "the run's job list could not be read" : 'the plan holds no fingerprint';
            if (failedByNeeds) lost.push(`${lane}: its failure marker cannot be recorded (${why}), so a later run could reuse an older pass of these inputs`);
            else console.log(`::warning::${lane}: no marker recorded (${why}); a later run with these inputs runs it again`);
            continue;
        }
        const mine = laneJobs(lane, jobs);
        // a lane whose jobs all ran in an earlier attempt was recorded by that attempt's CI result: never again, or a
        // re-run would make an old pass look young
        const attempt = Number(opts['run-attempt']);
        if (mine.length && mine.every((job) => Number.isInteger(job.run_attempt) && job.run_attempt < attempt)) {
            console.log(`${lane}: its jobs ran in an earlier attempt, which recorded them`);
            continue;
        }
        const count = expected(lane, plan.chromium_shards ?? DEFAULT_CHROMIUM_SHARDS, plan.event === 'engines');
        const passed = completeJobSet(lane, mine, count) && mine.every((job) => job.conclusion === 'success');
        // a browser shard that failed before its tests is incomplete, not a failure of these inputs
        const failed = BROWSER_LANES.includes(lane)
            ? mine.some(testsFailed)
            : failedByNeeds || mine.some((job) => job.conclusion === 'failure' || job.conclusion === 'timed_out');
        if (!passed && !failed) continue;
        const kind = failed ? 'fail' : 'pass';
        const completed = completedAt(mine);
        if (kind === 'pass' && !completed) {
            console.log(`::warning::${lane}: no pass recorded (its jobs carry no completion time, so its age could not be told)`);
            continue;
        }
        const tests = BROWSER_LANES.includes(lane) ? testCounts(opts.shards, lane === 'demo' ? ['chromium'] : ENGINE_BROWSERS) : null;
        const name = markerName(kind, lane, fp);
        try {
            mkdirSync(join(opts.out, name), { recursive: true });
            writeFileSync(join(opts.out, name, 'evidence.json'), `${JSON.stringify({
                schema: 1, kind, lane, fingerprint: fp, repo: plan.repo, sha: plan.sha,
                run_id: Number(opts['run-id']), run_attempt: Number(opts['run-attempt']),
                jobs: mine.map(({ id, name: job, conclusion, run_attempt }) => ({ id, name: job, conclusion, run_attempt })),
                completed_at: completed, flaky: tests ? tests.flaky : null, tests,
                runner: { image_os: process.env.ImageOS ?? null, image_version: process.env.ImageVersion ?? null },
                recorded_at: new Date(opts.now ? Date.parse(opts.now) : Date.now()).toISOString(),
            }, null, 2)}\n`);
        } catch (error) {
            if (kind === 'fail') lost.push(`${lane}: its failure marker cannot be written (${error.message})`);
            else console.log(`::warning::${lane}: its pass marker cannot be written (${error.message})`);
            continue;
        }
        outputs[`${lane}-marker`] = name;
        outputs[`${lane}-kind`] = kind;
        console.log(`${lane}: recorded ${name}`);
    }
    writeOutputs(opts['github-output'], outputs);
    for (const line of lost) console.error(`::error::${line}`);
    process.exitCode = lost.length ? 1 : 0;
}

const NO_ENGINES_MARKER = "no engines pass marker exists for a commit in dev's history: expected right after the switch to Chromium first, since runs before it recorded no engines markers, and a marker expires after 15 days";

/**
 * The last all-browser pass before `head`: the newest engines pass marker (any run of ci.yml in this repository that
 * passed the engines, whatever else it did, on any branch) whose commit is in head's history, and the commits since,
 * by short SHA only: a commit subject never reaches an issue (an at-sign name would ping, a number cross-reference).
 */
function sinceLastAllBrowserPass(client, ctx, head) {
    try {
        const candidates = [];
        for (let page = 1; page <= 5; page++) {
            const list = client.object(`repos/${ctx.repo}/actions/artifacts?per_page=100&page=${page}`);
            if (!Array.isArray(list.artifacts)) throw new Refused('lookup_error', 'the artifact listing has no artifacts');
            candidates.push(...list.artifacts.filter((a) => isObject(a) && String(a.name).startsWith('ci-pass-v1-engines-')));
            if (list.artifacts.length < 100) break;
        }
        candidates.sort((a, b) => time(b.created_at) - time(a.created_at));
        for (const artifact of candidates.slice(0, 10)) {
            let run;
            try {
                run = producerRun(client, ctx, artifact);
            } catch (error) {
                if (error instanceof Refused && error.reason === 'wrong_producer') continue;
                throw error;
            }
            const compare = client.object(`repos/${ctx.repo}/compare/${run.head_sha}...${head}`);
            if (!['ahead', 'identical'].includes(compare.status)) continue;
            const shas = (Array.isArray(compare.commits) ? compare.commits : []).filter(isObject).map((c) => String(c.sha).slice(0, 7));
            const count = Number.isInteger(compare.ahead_by) ? compare.ahead_by : shas.length;
            const url = run.html_url ?? `https://github.com/${ctx.repo}/actions/runs/${run.id}`;
            const compareUrl = compare.html_url ?? `https://github.com/${ctx.repo}/compare/${run.head_sha}...${head}`;
            const listed = shas.slice(0, 20).join(', ') + (shas.length > 20 ? ', …' : '');
            return `commits since the last all-browser pass ${run.head_sha.slice(0, 12)} (run ${url}): ${count} commit${count === 1 ? '' : 's'}${count ? `: ${listed}` : ''}; compare ${compareUrl}`;
        }
        return NO_ENGINES_MARKER;
    } catch (error) {
        return `the last all-browser pass could not be looked up (${refusal(error).message})`;
    }
}

function verdictCommand(opts) {
    need(opts, 'plan', 'needs', 'repo');
    const plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
    const needs = JSON.parse(readFileSync(opts.needs, 'utf8'));
    const ctx = context({ ...opts, 'chromium-shards': opts['chromium-shards'] ?? String(plan.chromium_shards ?? DEFAULT_CHROMIUM_SHARDS) }, 2);
    const client = api(ctx);
    // the run's jobs: the browser lanes share one job, so their results are read from its matrix jobs
    let jobs = readJson(opts.jobs ?? '');
    if (!(Array.isArray(jobs) && jobs.every(isObject)) && opts['run-id']) {
        try {
            jobs = client.object(`repos/${ctx.repo}/actions/runs/${opts['run-id']}/jobs?filter=latest&per_page=100`).jobs;
        } catch {
            jobs = null;
        }
    }
    if (!(Array.isArray(jobs) && jobs.every(isObject))) jobs = null;
    const result = (job) => {
        if (QUICK_CHECKS.includes(job) && needs.quick) {
            const outcome = needs.quick.outputs?.[job];
            // no output: the job was skipped, or ended before its summary (cancelled, failed in setup)
            if (!outcome) return needs.quick.result === 'skipped' ? 'skipped' : needs.quick.result ?? 'missing';
            // the job itself must have passed too: a red or cancelled job whose checks all say success left something
            // unexplained (a setup step, the summary), and no selected check of it passes
            const outcomes = QUICK_CHECKS.map((name) => needs.quick.outputs?.[name]);
            const explained = outcomes.some((value) => value && !['success', 'skipped'].includes(value));
            if (needs.quick.result !== 'success' && !explained && outcome === 'success') return needs.quick.result ?? 'missing';
            return outcome;
        }
        return needs[job]?.result ?? 'missing';
    };
    const lanes = {};
    for (const lane of LANES) {
        const entry = plan.lanes?.[lane];
        const status = (value, reason = '', producer = null, flaky = null) => { lanes[lane] = { status: value, reason, producer, flaky }; };
        // what ran of the lane: a browser lane's own matrix jobs, any other lane's jobs by `needs`
        let ran;
        let passed;
        let results;
        if (BROWSER_MATRIX_LANES.includes(lane) && !jobs && result('demo') === 'skipped') {
            // the browser job was skipped: none of its lanes ran, and no job list is needed to say so
            ran = false;
            passed = false;
            results = ['skipped'];
        } else if (BROWSER_MATRIX_LANES.includes(lane)) {
            if (!jobs) {
                status('incomplete', "the run's jobs could not be read, so the browser lanes cannot be told apart");
                continue;
            }
            const mine = laneJobs(lane, jobs).filter((job) => job.conclusion !== 'skipped');
            const count = expected(lane, ctx.chromiumShards, plan.event === 'engines');
            ran = mine.length > 0;
            passed = ran && completeJobSet(lane, mine, count) && mine.every((job) => job.conclusion === 'success');
            results = mine.length ? [...new Set(mine.map((job) => job.conclusion ?? job.status))] : ['skipped'];
            if (ran && !passed && mine.every((job) => job.conclusion === 'success')) {
                results = [mine.length === count ? 'wrong shard identities' : `${mine.length} of ${count} jobs`];
            }
        } else {
            results = (NEEDS[lane] ?? [lane]).map(result);
            ran = !results.every((value) => value === 'skipped');
            passed = results.every((value) => value === 'success');
        }
        if (!entry) status('incomplete', 'not in the plan');
        else if (entry.decision === 'run') {
            if (passed) status('fresh');
            else status('incomplete', `ended with ${results.join(', ')}`);
        } else if (entry.decision === 'skip') {
            if (!ran) status('not_applicable', entry.reason === 'covered_by_package' ? entry.detail : '');
            else status('incomplete', `planned to skip, ended with ${results.join(', ')}`);
        } else if (entry.decision === 'defer') {
            if (!ran) status('not_run_at_this_stage', DEFERRED);
            else status('incomplete', `planned to wait for a later stage, ended with ${results.join(', ')}`);
        } else if (entry.decision === 'reuse') {
            const evidence = isObject(entry.evidence) ? entry.evidence : null;
            const producer = evidence && { run_id: evidence.run_id, run_attempt: evidence.run_attempt, head_sha: evidence.head_sha, url: evidence.url };
            if (ran) status('incomplete', `planned for reuse, ended with ${results.join(', ')}`, producer);
            else {
                try {
                    requalify(client, ctx, lane, entry.fingerprint, evidence);
                    status('reused', '', producer, evidence.flaky ?? null);
                } catch (error) {
                    const refused = refusal(error);
                    status('incomplete', `the reused pass no longer qualifies, ${refused.reason}: ${refused.message}; ${RERUN_NOTE}`, producer);
                }
            }
        } else status('incomplete', `unknown decision ${entry.decision}`);
    }
    const setup = SETUP_NEEDS.map((job) => [job, result(job)]).filter(([, value]) => value !== 'success' && value !== 'skipped');
    const ok = setup.length === 0 && Object.values(lanes).every((lane) => lane.status !== 'incomplete');
    // the daily run's engines, for the Engines issue: passed (ran and passed, or a pass on these inputs still qualifies),
    // failed (a shard failed), or incomplete (cancelled, short, unreadable: nothing said about the engines)
    const outputs = { 'engines-status': '', 'engines-report': '' };
    let daily = null;
    const engines = plan.lanes?.engines;
    if (plan.event === 'daily' && ['run', 'reuse'].includes(engines?.decision)) {
        const at = String(plan.sha).slice(0, 12);
        const failedShard = laneJobs('engines', jobs ?? []).some(testsFailed);
        if (lanes.engines.status === 'fresh' || lanes.engines.status === 'reused') {
            outputs['engines-status'] = 'passed';
            outputs['engines-report'] = lanes.engines.status === 'reused'
                ? `Firefox and WebKit already passed on these inputs (dev at ${at}): run ${lanes.engines.producer?.url}`
                : `Firefox and WebKit passed on dev at ${at}`;
        } else if (engines.decision === 'run' && failedShard) {
            daily = sinceLastAllBrowserPass(client, ctx, plan.sha);
            outputs['engines-status'] = 'failed';
            outputs['engines-report'] = `Firefox/WebKit failed on dev at ${at}; ${daily}`;
        } else {
            outputs['engines-status'] = 'incomplete';
            outputs['engines-report'] = `The Firefox/WebKit run on dev did not complete (${lanes.engines.reason.replace(/[\r\n]+/g, ' ')}); it says nothing about the engines`;
        }
    }
    const label = (value) => (value.status === 'not_run_at_this_stage' ? 'NOT RUN AT THIS STAGE' : value.status);
    const why = (value) => (value.status === 'not_run_at_this_stage' ? DEFERRED.replace('NOT RUN AT THIS STAGE: ', '') : value.reason);
    const rows = Object.entries(lanes).map(([lane, value]) => `| ${BROWSER_LANE_NAMES[lane] ?? lane} | ${label(value)} | ${value.producer ? `[run ${value.producer.run_id}](${value.producer.url}) attempt ${value.producer.run_attempt}, ${String(value.producer.head_sha).slice(0, 12)}` : ''} | ${value.flaky ?? ''} | ${why(value)} |`);
    const summary = [
        '### Lanes', '',
        '| Lane | Result | Producer | Flaky | Why |', '|---|---|---|---|---|', ...rows, '',
        ...setup.map(([job, value]) => `- ${job} ended with ${value}`),
        ...(outputs['engines-report'] ? [`**Daily engines:** ${outputs['engines-report']}`, ''] : []),
        `Qualification: plan ${plan.elapsed_ms ?? '?'} ms, ${plan.api_calls ?? '?'} API calls; verdict ${ctx.calls} API calls.`, '',
    ].join('\n');
    if (opts.summary) appendFileSync(opts.summary, summary);
    writeOutputs(opts['github-output'], outputs);
    for (const [lane, value] of Object.entries(lanes)) {
        if (value.status === 'incomplete') console.error(`::error::${lane}: ${value.reason}`);
        if (value.status === 'not_run_at_this_stage') console.log(`::notice::${lane}: ${DEFERRED}`);
    }
    if (['failed', 'incomplete'].includes(outputs['engines-status'])) console.error(`::error::engines: ${outputs['engines-report']}`);
    for (const [job, value] of setup) console.error(`::error::${job} ended with ${value}`);
    console.log(JSON.stringify({ schema: 1, ok, lanes }));
    process.exitCode = ok ? 0 : 1;
}

/** CI result's one step: the markers, then the verdict; fails when either does (a lost failure marker, or no pass) */
function finishCommand(opts) {
    recordCommand(opts);
    const recorded = process.exitCode ?? 0;
    process.exitCode = 0;
    verdictCommand(opts);
    process.exitCode = Math.max(recorded, process.exitCode ?? 0);
}

/** the tool runs on the runner image's own Node in CI result: null when this one will do, else why not */
export function nodeProblem(version) {
    const major = Number(String(version).split('.')[0]);
    return major >= 20 ? null : `lane-evidence needs Node 20 or later, not ${version}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const problem = nodeProblem(process.versions.node);
    if (problem) usage(problem);
    const opts = options(process.argv.slice(2));
    const commands = { fingerprint: fingerprintCommand, plan: planCommand, record: recordCommand, verdict: verdictCommand, require: requireCommand, finish: finishCommand };
    if (!commands[opts.command]) usage('the command is fingerprint, plan, record, verdict, finish or require');
    await commands[opts.command](opts);
}
