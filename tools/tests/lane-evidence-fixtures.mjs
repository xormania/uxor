// Shared by the lane-evidence test files (tools/tests/lane-evidence.*.test.mjs): the scratch repository, the stub
// GitHub API, the markers, plans and workflow readers. Not a test file itself.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, existsSync, openSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { stepIn } from '../ci/step-attempts.mjs';


export { assert, spawnSync, appendFileSync, chmodSync, closeSync, existsSync, openSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, tmpdir, join, fileURLToPath, crc32, deflateRawSync, stepIn };

export const tool = fileURLToPath(new URL('../ci/lane-evidence.mjs', import.meta.url));

export const REPO = 'example/project';

export const NOW = '2026-11-16T12:00:00Z';

export const LANES = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows', 'package', 'prod-image'];

export const REUSABLE = ['demo', 'engines', 'php', 'prod-image', 'fresh-install', 'lint-kit', 'package'];

export const LANES_ALL = [...LANES, 'engines'];

export const EXCLUDED = ['CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', '.github/pull_request_template.md'];

export function gitIn(cwd, ...args) {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
}

export function scratch(t) {
    const dir = mkdtempSync(join(tmpdir(), 'lane-evidence-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = (...args) => gitIn(repo, ...args);
    git('init', '-q');
    const write = (path, content) => {
        mkdirSync(join(repo, path, '..'), { recursive: true });
        writeFileSync(join(repo, path), content);
    };
    for (const [path, content] of Object.entries({ '.github/workflows/ci.yml': 'name: CI\n', 'CHANGELOG.md': '# Changelog\n', 'AGENTS.md': 'agents\n', 'button/README.md': '# Button\n', 'kit.css': '' })) {
        write(path, content);
    }
    git('add', '-A');
    git('commit', '-qm', 'base');
    // the stub gh: `gh api <path>` answers the route's JSON, text or file; `fail: 'HTTP 502'` fails `failTimes` times
    // first (default: always); any other path is GitHub's 404, an unknown artifact name an empty list
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = process.argv[3];
fs.appendFileSync(process.env.FAKE_GH_LOG, path + '\\n');
// FAKE_GH_DELAY_MS: each answer takes that long, its start and end logged to FAKE_GH_TIMES (to see calls overlap)
if (process.env.FAKE_GH_DELAY_MS) {
    const start = Date.now();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_GH_DELAY_MS));
    fs.appendFileSync(process.env.FAKE_GH_TIMES, start + ' ' + Date.now() + ' ' + path + '\\n');
}
const routes = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, 'utf8'));
const route = routes[path] ?? (path.includes('/actions/artifacts?name=') ? { json: { total_count: 0, artifacts: [] } } : undefined);
if (!route) { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
if (route.fail) {
    const counter = process.env.FAKE_GH_LOG + '.' + Buffer.from(path).toString('hex').slice(0, 100);
    const seen = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
    fs.writeFileSync(counter, String(seen + 1));
    if (route.failTimes === undefined || seen < route.failTimes) { process.stderr.write('gh: Server Error (' + route.fail + ')\\n'); process.exit(1); }
}
process.stdout.write(route.file ? fs.readFileSync(route.file) : route.text !== undefined ? route.text : JSON.stringify(route.json));
`);
    chmodSync(join(bin, 'gh'), 0o755);
    const commit = (path, content) => {
        if (content === null) rmSync(join(repo, path));
        else write(path, content);
        git('add', '-A');
        git('commit', '-qm', `change ${path}`);
        return git('rev-parse', 'HEAD');
    };
    return { dir, repo, bin, git, commit, head: () => git('rev-parse', 'HEAD') };
}

export function run(fx, args, routes = {}, { gitDir = fx.repo, env = {} } = {}) {
    const routesFile = join(fx.dir, 'routes.json');
    const log = join(fx.dir, `gh-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(routesFile, JSON.stringify(routes));
    writeFileSync(log, '');
    const result = spawnSync(process.execPath, [tool, ...args, '--git-dir', gitDir, '--gh', join(fx.bin, 'gh'), '--now', NOW, '--retry-delay-ms', '1'], {
        encoding: 'utf8', env: { PATH: process.env.PATH, FAKE_GH_ROUTES: routesFile, FAKE_GH_LOG: log, ...env },
    });
    return { ...result, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

export function fingerprints(fx, sha) {
    const out = run(fx, ['fingerprint', '--sha', sha]);
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout);
}

// a zip holding one file, as an artifact's download: stored, or deflated as upload-artifact writes it
export function zip(name, data, { deflate = false } = {}) {
    const raw = Buffer.from(data);
    const body = deflate ? deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const file = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(file.length, 28);
    const end = Buffer.alloc(22);
    const centralOffset = local.length + file.length + body.length;
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(centralOffset, 16);
    return Buffer.concat([local, file, body, central, file, end]);
}

export const selection = (fx, lanes) => {
    const file = join(fx.dir, 'selection');
    writeFileSync(file, LANES.map((lane) => `${lane}=${lanes.includes(lane)}`).join('\n') + '\n');
    return file;
};

// the browser job's matrix: CHROMIUM_SHARDS (6) Chromium shards are the demo lane, three each of Firefox and WebKit the
// engines lane
export const demoJobs = (base = 500, attempt = 1, shards = 6) => Array.from({ length: shards }, (_, i) => `chromium ${i + 1}/${shards}`)
    .map((label, i) => ({ id: base + i, name: `Demo + Playwright (${label})`, conclusion: 'success', status: 'completed', run_attempt: attempt, completed_at: '2026-11-15T12:00:00Z' }));

export const engineJobs = (base = 700, attempt = 1) => [...[1, 2, 3].map((s) => `firefox ${s}/3`), ...[1, 2, 3].map((s) => `webkit ${s}/3`)]
    .map((label, i) => ({ id: base + i, name: `Demo + Playwright (${label})`, conclusion: 'success', status: 'completed', run_attempt: attempt, completed_at: '2026-11-15T12:00:00Z' }));

export const DEMO_JOBS = demoJobs();

export const SKIPPED_DEMO = { id: 499, name: 'Demo + Playwright (${{ matrix.browser }} ${{ matrix.shard }}/${{ matrix.shards }})', conclusion: 'skipped', status: 'completed', run_attempt: 1 };

export const brief = (jobs) => jobs.map(({ id, name, conclusion, run_attempt }) => ({ id, name, conclusion, run_attempt }));

/**
 * One marker artifact and the producer run behind it, as API routes: the artifact, its ZIP, its run and the run's
 * latest jobs. `evidence`, `run`, `artifact` and `jobs` override the defaults; `latestJobs` is what the run lists now.
 */
export function marker(fx, { lane = 'demo', fp, sha, kind = 'pass', runId = 71, artifactId = 9001, attempt = 1, jobs: given = DEMO_JOBS, latestJobs: givenLatest, created = '2026-11-15T12:00:00Z', completedAt, evidence = {}, run = {}, artifact = {}, zipBytes, deflate = false } = {}) {
    const name = `ci-${kind}-v1-${lane}-${fp}`;
    // the lane's jobs completed when the test says, else when the marker was made
    const stamp = (list) => list.map((job) => ({ ...job, completed_at: completedAt ?? created }));
    const jobs = stamp(given);
    const latestJobs = givenLatest && stamp(givenLatest);
    const content = { schema: 1, kind, lane, fingerprint: fp, repo: REPO, sha, run_id: runId, run_attempt: attempt, jobs: brief(jobs), completed_at: completedAt ?? created, flaky: 2, tests: { passed: 600, failed: 0, flaky: 2, skipped: 3 }, runner: { image_os: 'ubuntu24', image_version: '20261110.1' }, recorded_at: created, ...evidence };
    const zipFile = join(fx.dir, `${name}-${artifactId}.zip`);
    writeFileSync(zipFile, zipBytes ?? zip('evidence.json', JSON.stringify(content), { deflate }));
    const a = { id: artifactId, name, expired: false, created_at: created, workflow_run: { id: runId, repository_id: 10, head_repository_id: 10, head_sha: sha, head_branch: 'feature' }, ...artifact };
    return {
        artifact: a,
        routes: {
            [`repos/${REPO}/actions/artifacts/${artifactId}`]: { json: a },
            [`repos/${REPO}/actions/artifacts/${artifactId}/zip`]: { file: zipFile },
            [`repos/${REPO}/actions/runs/${runId}`]: { json: { id: runId, path: '.github/workflows/ci.yml', event: 'push', head_sha: sha, head_branch: 'feature', run_attempt: attempt, html_url: `https://github.com/example/project/actions/runs/${runId}`, repository: { id: 10, full_name: REPO }, head_repository: { id: 10, full_name: REPO }, ...run } },
            [`repos/${REPO}/actions/runs/${runId}/jobs?filter=latest&per_page=100`]: { json: { total_count: (latestJobs ?? jobs).length, jobs: latestJobs ?? jobs } },
        },
    };
}

/** the listings of the lane's pass and fail markers, and every marker's own routes */
export function routesFor(lane, fp, markers) {
    const routes = {};
    for (const m of markers) Object.assign(routes, m.routes);
    for (const kind of ['pass', 'fail']) {
        const list = markers.map((m) => m.artifact).filter((a) => a.name === `ci-${kind}-v1-${lane}-${fp}`);
        routes[`repos/${REPO}/actions/artifacts?name=ci-${kind}-v1-${lane}-${fp}&per_page=100`] = { json: { total_count: list.length, artifacts: list } };
    }
    return routes;
}

export const producer = (fx, sha, fp, options = {}) => routesFor(options.lane ?? 'demo', fp, [marker(fx, { sha, fp, ...options })]);

export function plan(fx, routes, lanes = ['demo'], extra = [], ref = 'refs/heads/feature') {
    const out = join(fx.dir, 'plan.json');
    const github = join(fx.dir, 'github-output');
    writeFileSync(github, '');
    const result = run(fx, ['plan', '--repo', REPO, '--sha', fx.head(), '--ref', ref, '--selection', selection(fx, lanes), '--out', out, '--github-output', github, ...extra], routes);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(readFileSync(github, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    return { plan: JSON.parse(readFileSync(out, 'utf8')), outputs, log: result.stdout, calls: result.calls };
}

export function enginesPlan(fx, routes = {}, { event = 'push', ref = 'refs/heads/feature', enginesOn = 'daily', engines = 'false', lanes = ['demo'], extra = '', shards = '6' } = {}) {
    const out = join(fx.dir, 'plan.json');
    const github = join(fx.dir, 'github-output');
    writeFileSync(github, '');
    const file = selection(fx, lanes);
    if (extra) appendFileSync(file, extra);
    const result = run(fx, ['plan', '--repo', REPO, '--sha', fx.head(), '--ref', ref, '--event', event, '--engines-on', enginesOn, '--engines', engines,
        '--chromium-shards', shards, '--selection', file, '--out', out, '--github-output', github], routes);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(readFileSync(github, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    return { plan: JSON.parse(readFileSync(out, 'utf8')), outputs, matrix: JSON.parse(outputs['browser-matrix']), log: result.stdout };
}

export const engineRoutes = (fx, sha, fp, options = {}) => routesFor('engines', fp, [marker(fx, { lane: 'engines', sha, fp, jobs: engineJobs(), artifactId: 9501, runId: 75, ...options })]);

export function recorded(fx, planLanes, jobs, { needs, reuse = true, attempt = '1' } = {}) {
    const planFile = join(fx.dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ schema: 1, repo: REPO, sha: 'a'.repeat(40), ref: 'refs/heads/feature', reuse, reuse_off: reuse ? null : 'switch', lanes: planLanes }));
    const jobsFile = join(fx.dir, 'jobs.json');
    rmSync(jobsFile, { force: true });
    if (jobs !== undefined) writeFileSync(jobsFile, typeof jobs === 'string' ? jobs : JSON.stringify(jobs));
    const needsFile = join(fx.dir, 'record-needs.json');
    writeFileSync(needsFile, JSON.stringify(needs ?? {}));
    const out = join(fx.dir, 'markers');
    rmSync(out, { recursive: true, force: true });
    const github = join(fx.dir, 'record-output');
    writeFileSync(github, '');
    const result = run(fx, ['record', '--plan', planFile, '--jobs', jobsFile, '--needs', needsFile, '--run-id', '88', '--run-attempt', attempt, '--out', out, '--github-output', github]);
    const markers = existsSync(out) ? readdirSync(out).sort() : [];
    const read = (name) => JSON.parse(readFileSync(join(out, name, 'evidence.json'), 'utf8'));
    return { result, markers, read, output: readFileSync(github, 'utf8') };
}

export const lane = (decision, fingerprint = 'c'.repeat(64), reason) => ({ selected: decision !== 'skip', decision, fingerprint, reason: reason ?? (decision === 'reuse' ? 'reused' : decision === 'skip' ? 'not_selected' : decision === 'defer' ? 'deferred' : 'no_evidence'), detail: '', evidence: null });

export function verdictFixture(t, { engines = lane('defer', 'f'.repeat(64)), event = 'push' } = {}) {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    const routes = producer(fx, fx.head(), fp);
    const evidence = { artifact_id: 9001, artifact_name: `ci-pass-v1-demo-${fp}`, run_id: 71, run_attempt: 1, head_sha: fx.head(), head_branch: 'feature', created_at: '2026-11-15T12:00:00Z', url: 'https://github.com/example/project/actions/runs/71', jobs: brief(DEMO_JOBS), flaky: 2, tests: null };
    const lanes = Object.fromEntries(LANES.map((name) => [name, lane('skip', null)]));
    lanes.demo = { ...lane('reuse', fp), evidence };
    lanes.php = lane('run');
    lanes.contrast = lane('run', null, 'not_reusable');
    lanes.engines = engines;
    const planFile = join(fx.dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ schema: 1, repo: REPO, sha: fx.head(), ref: event === 'daily' ? 'refs/heads/dev' : 'refs/heads/feature', event, reuse: true, reuse_off: null, chromium_shards: 6, elapsed_ms: 1234, api_calls: 7, lanes }));
    const needs = (overrides) => {
        const results = { changes: 'success', tools: 'success', importmap: 'success', 'lint-kit': 'skipped', php: 'success', 'static-site': 'skipped', 'fresh-install': 'skipped', 'docker-install': 'skipped', package: 'skipped', contrast: 'success', workflows: 'skipped', demo: 'skipped', 'prod-image': 'skipped', ...overrides };
        const file = join(fx.dir, 'needs.json');
        writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]))));
        return file;
    };
    const verdict = (overrides = {}, r = routes, extra = [], jobs = []) => {
        const summary = join(fx.dir, 'summary.md');
        const github = join(fx.dir, 'verdict-output');
        const jobsFile = join(fx.dir, 'verdict-jobs.json');
        writeFileSync(summary, '');
        writeFileSync(github, '');
        const jobsArgs = jobs === null ? [] : ['--jobs', jobsFile];
        if (jobs !== null) writeFileSync(jobsFile, JSON.stringify(jobs));
        const out = run(fx, ['verdict', '--plan', planFile, '--needs', needs(overrides), ...jobsArgs, '--repo', REPO, '--summary', summary, '--github-output', github, ...extra], r);
        return { ...out, json: JSON.parse(out.stdout.split('\n').filter((line) => line.startsWith('{')).pop()), summary: readFileSync(summary, 'utf8'), outputs: readFileSync(github, 'utf8') };
    };
    return { fx, fp, routes, verdict };
}

export function workflowJobs(file) {
    const workflow = readFileSync(fileURLToPath(new URL(`../../.github/workflows/${file}`, import.meta.url)), 'utf8');
    const jobs = workflow.split(/\n(?= {4}[a-z0-9-]+:\n)/).slice(1).map((text) => ({
        id: text.match(/^ {4}([a-z0-9-]+):/)[1],
        text,
        name: text.match(/^ {8}name: (.+)$/m)?.[1] ?? '',
        if: text.match(/^ {8}if: (.+)$/m)?.[1] ?? '',
        needs: text.match(/^ {8}needs: (.+)$/m)?.[1] ?? '',
    }));
    return { workflow, jobs, job: (id) => jobs.find((j) => j.id === id) };
}

// the scalar/boolean subset of GitHub expressions these workflows use; unknown syntax fails closed
export function evaluate(expression, context) {
    const body = expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
        .replace(/\b(github|inputs|needs|vars)\.[A-Za-z0-9_.-]+/g, (path) => JSON.stringify(path.split('.').reduce((value, part) => value?.[part], context) ?? ''))
        .replace(/\bstartsWith\(([^,]+),\s*('[^']*')\)/g, '(String($1).startsWith($2))')
        .replace(/\bformat\('([^']*)',\s*([^)]+)\)/g, (_, template, arg) => `(${JSON.stringify(template)}.replace('{0}', ${arg}))`);
    const operators = body.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\b(?:true|false|[0-9]+|String|startsWith|replace)\b/g, '');
    assert.match(operators, /^[\s!<>=&|().,-]*$/, `unsupported expression ${expression}`);
    return Function(`return (${body});`)();
}

export const key = (text, name) => text.match(new RegExp(`^ *${name}: (.+)$`, 'm'))?.[1].replace(/^"(.*)"$/, '$1');

export const push = { github: { event_name: 'push', ref: 'refs/heads/feature' }, inputs: {} };

export const daily = { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/dev' }, inputs: { daily: true } };

export const enginesOnly = { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }, inputs: { engines_only: true } };

export const manual = { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }, inputs: {} };

export function dailyRoutes(fx, routes, { found = true, apiDown = false } = {}) {
    const head = fx.head();
    const last = 'a'.repeat(40);
    const other = 'b'.repeat(40);
    const r = { ...routes };
    if (apiDown) return { ...r, [`repos/${REPO}/actions/artifacts?per_page=100&page=1`]: { fail: 'HTTP 502' } };
    const art = (id, run, sha, name = `ci-pass-v1-engines-${'e'.repeat(64)}`) => ({ id, name, expired: false, created_at: '2026-11-15T00:00:00Z', workflow_run: { id: run, head_sha: sha, repository_id: 10, head_repository_id: 10 } });
    r[`repos/${REPO}/actions/artifacts?per_page=100&page=1`] = { json: { total_count: found ? 3 : 1, artifacts: found
        ? [art(9601, 61, other), art(9602, 62, 'c'.repeat(40), `ci-pass-v1-demo-${'d'.repeat(64)}`), art(9600, 60, last)]
        : [art(9602, 62, 'c'.repeat(40), `ci-pass-v1-demo-${'d'.repeat(64)}`)] } };
    const runRoute = (id, sha, event = 'push') => ({ json: { id, path: '.github/workflows/ci.yml', event, head_sha: sha, html_url: `https://github.com/example/project/actions/runs/${id}`, repository: { id: 10, full_name: REPO }, head_repository: { id: 10, full_name: REPO } } });
    r[`repos/${REPO}/actions/runs/61`] = runRoute(61, other);
    r[`repos/${REPO}/actions/runs/60`] = runRoute(60, last, 'workflow_dispatch');
    // run 61 passed on a branch that never reached dev; run 60's commit is in dev's history
    r[`repos/${REPO}/compare/${other}...${head}`] = { json: { status: 'diverged', ahead_by: 3, behind_by: 1, commits: [] } };
    r[`repos/${REPO}/compare/${last}...${head}`] = { json: { status: 'ahead', ahead_by: 2, html_url: `https://github.com/example/project/compare/${last}...${head}`, commits: [
        { sha: '1234567890'.repeat(4), commit: { message: 'feat(tabs): keyboard wrap, thanks @someone, see #12' } },
        { sha: 'abcdef0123'.repeat(4), commit: { message: 'fix(modal): focus return' } }] } };
    return r;
}

// the workflows' shell steps, run with a stub gh that logs its calls

export function stubGh(fx, script) {
    const bin = join(fx.dir, 'shbin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> "${join(fx.dir, 'gh-calls')}"\n${script}\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    writeFileSync(join(fx.dir, 'gh-calls'), '');
    return bin;
}

export const ghCalls = (fx) => readFileSync(join(fx.dir, 'gh-calls'), 'utf8');

export const installJobs = (base = 1100) => [
    { id: base, name: 'Fresh install', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' },
    { id: base + 1, name: 'Fresh install (Symfony Docker, from GitHub)', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' },
];

export const lintJobs = (base = 1200) => ['locked', 'minimum'].map((t, i) => ({ id: base + i, name: `Lint kit (${t} toolkit)`, conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' }));

export const packageJobs = (base = 1300) => [{ id: base, name: 'Package', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' }];
