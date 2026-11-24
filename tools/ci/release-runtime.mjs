import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const TOOL_INPUTS = new Set(['tools/llms-txt.mjs', 'tools/tests/llms-txt.test.mjs']);
const ROOT_DOCS = new Set([
    'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'FOR-AGENTS.md', 'INSTALL.md', 'README.md', 'SECURITY.md', 'llms.txt',
]);
const CONTROL_FILES = new Set(['.gitattributes', '.gitignore', '.gitmodules', '.ignore']);
const DOC_SCRIPTS = ['docs:check', 'docs:generate'];
const DAY_MS = 24 * 60 * 60 * 1000;

function git(args, dir) {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
    return result.stdout;
}

function regularTree(dir, sha) {
    return new Map(git(['ls-tree', '-r', '-z', '--full-tree', sha], dir).split('\0').filter(Boolean).map((entry) => {
        const [, mode, blob, path] = /^(\d+) (?:blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry) ?? [];
        if (!['100644', '100755'].includes(mode) || path.includes('\uFFFD')) throw new Error('a release tree has a non-regular or unreadable entry');
        return [path, `${mode} ${blob}`];
    }));
}

function documentationPath(path) {
    if (CONTROL_FILES.has(path.split('/').at(-1))) return false;
    if (ROOT_DOCS.has(path) || TOOL_INPUTS.has(path)) return true;
    // A top-level manifest changes recipe discovery even under a directory that normally only holds documentation.
    if (path === 'website/manifest.json' || path === 'docs/manifest.json') return false;
    if (path.startsWith('website/') || path.startsWith('docs/')) return true;
    // The browser fixtures import the recorder from this otherwise independent package.
    return path.startsWith('packages/uxor/')
        && path !== 'packages/uxor/resources/browser'
        && !path.startsWith('packages/uxor/resources/browser/');
}

function withoutDocScripts(dir, sha) {
    const json = JSON.parse(git(['show', `${sha}:composer.json`], dir));
    if (!json || Array.isArray(json) || typeof json !== 'object') throw new Error('invalid root Composer manifest');
    if (json.scripts === undefined) return JSON.stringify(json);
    if (!json.scripts || Array.isArray(json.scripts) || typeof json.scripts !== 'object') throw new Error('invalid Composer scripts');
    for (const script of DOC_SCRIPTS) delete json.scripts[script];
    if (Object.keys(json.scripts).length === 0) delete json.scripts;
    return JSON.stringify(json);
}

// Compare trusted immutable trees. Unknown new inputs and lookup failures require a fresh run.
export function runtimeChanges(dir, prior, current) {
    if (!SHA.test(prior) || !SHA.test(current)) throw new Error('a release tree ID is malformed');
    const before = regularTree(dir, prior);
    if (prior === current) return [];
    const after = regularTree(dir, current);
    return [...new Set([...before.keys(), ...after.keys()])].filter((path) => {
        if (before.get(path) === after.get(path)) return false;
        if (before.has(path) && after.has(path) && before.get(path).slice(0, 6) !== after.get(path).slice(0, 6)) return true;
        if (path === 'composer.json') return withoutDocScripts(dir, prior) !== withoutDocScripts(dir, current);
        return !documentationPath(path);
    });
}

const ACTIVE = new Set(['queued', 'in_progress', 'requested', 'pending', 'waiting']);
const IMAGE_STEPS = ['Build the production image', 'Run the production image'];
// These are the audited workflow preambles and production jobs. When either contract changes, run the
// release fallback until both implementations have been checked for equivalence and the expectations renewed.
const PRODUCTION_CONTRACTS = {
    ci: '1b7591a2c29f646ad4345fbafb81f1d58fbf68a02210a34db6d592140d35b4b0',
    release: '104819955bcafaa355e918399f4fa54e5dbe1cff833a1a5aef2276e878fe5605',
};

export function productionContract(workflow) {
    const [preamble, jobs, extra] = workflow.split(/^jobs:\s*$/m);
    if (!jobs || extra !== undefined) return null;
    const lines = jobs.split('\n');
    const keys = [];
    for (const [index, line] of lines.entries()) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        if (!line.startsWith('    ')) return null;
        if (line.startsWith('     ')) continue;
        const key = /^ {4}([a-zA-Z_][\w-]*):(?:\s*#.*)?\s*$/.exec(line)?.[1];
        if (!key || keys.some((entry) => entry.key === key)) return null;
        keys.push({ key, index });
    }
    const production = keys.findIndex(({ key }) => key === 'prod-image');
    if (production < 0) return null;
    // Sibling jobs do not affect the production job. Their top-level comments are outside its block.
    const body = lines.slice(keys[production].index, keys[production + 1]?.index)
        .filter((line) => !/^ {4}#/.test(line)).join('\n').trimEnd();
    return createHash('sha256').update(preamble).update('\0').update(body).digest('hex');
}

export function productionContractsMatch(ci, release) {
    return productionContract(ci) === PRODUCTION_CONTRACTS.ci
        && productionContract(release) === PRODUCTION_CONTRACTS.release;
}

function samePush(run, { repo, head, branch }) {
    return Number.isSafeInteger(run?.id) && run.id > 0
        && Number.isSafeInteger(run?.run_attempt) && run.run_attempt > 0
        && run.path === '.github/workflows/ci.yml' && run.event === 'push'
        && run.repository?.full_name === repo && run.head_repository?.full_name === repo
        && run.head_sha === head && run.head_branch === branch;
}

function imageState(run, jobs, now) {
    if (!Array.isArray(jobs) || jobs.some((job) => !job || typeof job !== 'object')) return 'missing';
    const image = jobs.filter((job) => job.name === 'Production image');
    if (image.length === 0 && ACTIVE.has(run.status)) return 'planning';
    if (image.length !== 1) return 'missing';
    const [job] = image;
    if (job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha) return 'missing';
    if (ACTIVE.has(job.status) && ACTIVE.has(run.status)) return 'running';
    if (job.status !== 'completed' || job.conclusion !== 'success') return 'missing';
    const age = now - Date.parse(job.completed_at);
    if (!(age >= 0 && age <= DAY_MS)) return 'missing';
    return Array.isArray(job.steps) && IMAGE_STEPS.every((name) => {
        const steps = job.steps.filter((step) => step?.name === name);
        return steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success';
    }) ? 'pass' : 'missing';
}

// Run only on a same-repository release PR. A short wait allows its normal CI push to finish the equivalent job,
// independently of the other CI lanes. After any unverified result this release job performs its own build.
export async function productionPass({
    repo, head, branch, read, now = Date.now, wait = sleep, waitMs = 150_000, planningMs = 20_000,
}) {
    const start = now();
    const deadline = start + waitMs;
    const target = { repo, head, branch };
    const path = `repos/${repo}/actions/workflows/ci.yml/runs?event=push&per_page=5&head_sha=${head}&branch=${encodeURIComponent(branch)}`;
    while (now() < deadline) {
        const list = read(path, deadline).workflow_runs;
        const run = Array.isArray(list) && list.find((candidate) => samePush(candidate, target));
        if (!run || (run.status === 'completed' && ['cancelled', 'stale'].includes(run.conclusion))) return null;
        const runPath = `repos/${repo}/actions/runs/${run.id}`;
        const { jobs, total_count: count } = read(`${runPath}/attempts/${run.run_attempt}/jobs?per_page=100`, deadline);
        if (!Array.isArray(jobs) || jobs.length !== count) return null;
        const state = imageState(run, jobs, now());
        if (state === 'pass') {
            const latest = read(runPath, deadline);
            return samePush(latest, target) && latest.id === run.id && latest.run_attempt === run.run_attempt
                && !['cancelled', 'stale'].includes(latest.conclusion) ? latest : null;
        }
        if (state === 'missing' || (state === 'planning' && now() - start >= planningMs)) return null;
        const remaining = deadline - now();
        if (remaining > 0) await wait(Math.min(10_000, remaining));
    }
    return null;
}

function api(path, deadline) {
    const timeout = Math.min(5000, deadline - Date.now());
    if (timeout <= 0) throw new Error('production evidence lookup timed out');
    const result = spawnSync('gh', ['api', path], { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('production evidence API lookup was unavailable');
    return JSON.parse(result.stdout);
}

export function sameHeadTree(dir, merge, head) {
    if (!SHA.test(merge) || !SHA.test(head)) return false;
    const parents = git(['rev-list', '--parents', '-n', '1', merge], dir).trim().split(' ');
    return parents.length === 3 && parents[0] === merge && parents[2] === head
        && git(['rev-parse', `${merge}^{tree}`], dir) === git(['rev-parse', `${head}^{tree}`], dir);
}

async function main([command, ...args]) {
    if (command === 'changed' && args.length === 2) {
        for (const path of runtimeChanges('.', ...args)) console.log(JSON.stringify(path));
        return;
    }
    if (command === 'production' && args.length === 4) {
        const [repo, merge, head, branch] = args;
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !branch || !sameHeadTree('.', merge, head)) {
            console.log('The release merge and CI push do not prove the same tree.');
            process.exitCode = 1;
            return;
        }
        const ciWorkflow = git(['show', `${head}:.github/workflows/ci.yml`], '.');
        const releaseWorkflow = readFileSync(new URL('../../.github/workflows/release-checks.yml', import.meta.url), 'utf8');
        if (!productionContractsMatch(ciWorkflow, releaseWorkflow)) {
            console.log('CI and release production image workflow definitions need an equivalence check.');
            process.exitCode = 1;
            return;
        }
        const run = await productionPass({ repo, head, branch, read: api });
        if (run) {
            console.log(`Production image passed in CI push https://github.com/${repo}/actions/runs/${run.id} (attempt ${run.run_attempt}).`);
            return;
        }
        console.log('No qualifying CI production image pass.');
        process.exitCode = 1;
        return;
    }
    throw new Error('usage: release-runtime.mjs changed <prior-tree> <current-tree> | production <repo> <merge> <head> <branch>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        console.log(error.message);
        process.exitCode = 1;
    });
}
