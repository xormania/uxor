// tools/ci/lane-evidence.mjs: the lanes' fingerprints, the plan that reuses a lane's earlier pass, the markers CI result
// records and its verdict. GitHub's API is a stub `gh` serving fixtures by path; git is real, on a scratch repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const tool = fileURLToPath(new URL('../ci/lane-evidence.mjs', import.meta.url));
const REPO = 'example/project';
const NOW = '2026-11-16T12:00:00Z';
const LANES = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows', 'package', 'prod-image'];

function scratch(t) {
    const dir = mkdtempSync(join(tmpdir(), 'lane-evidence-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const git = (...args) => {
        const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: join(dir, 'repo'), encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        return run.stdout.trim();
    };
    mkdirSync(join(dir, 'repo', '.github', 'workflows'), { recursive: true });
    git('init', '-q');
    const files = { '.github/workflows/ci.yml': 'name: CI\n', 'CHANGELOG.md': '# Changelog\n', 'button/README.md': '# Button\n', 'kit.css': '' };
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(dir, 'repo', path, '..'), { recursive: true });
        writeFileSync(join(dir, 'repo', path), content);
    }
    git('add', '-A');
    git('commit', '-qm', 'base');
    // the stub gh: `gh api <path>` answers the route's JSON or file, any other path is GitHub's 404
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = process.argv[3];
fs.appendFileSync(process.env.FAKE_GH_LOG, path + '\\n');
const routes = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, 'utf8'));
// GitHub lists no artifacts, rather than a 404, for a name nothing uploaded
const route = routes[path] ?? (path.includes('/actions/artifacts?name=') ? { json: { total_count: 0, artifacts: [] } } : undefined);
if (!route) { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
process.stdout.write(route.file ? fs.readFileSync(route.file) : JSON.stringify(route.json));
`);
    chmodSync(join(bin, 'gh'), 0o755);
    const commit = (path, content) => {
        mkdirSync(join(dir, 'repo', path, '..'), { recursive: true });
        if (content === null) rmSync(join(dir, 'repo', path));
        else writeFileSync(join(dir, 'repo', path), content);
        git('add', '-A');
        git('commit', '-qm', `change ${path}`);
        return git('rev-parse', 'HEAD');
    };
    return { dir, repo: join(dir, 'repo'), bin, git, commit, head: () => git('rev-parse', 'HEAD') };
}

function run(fx, args, routes = {}) {
    const routesFile = join(fx.dir, 'routes.json');
    const log = join(fx.dir, 'gh.log');
    writeFileSync(routesFile, JSON.stringify(routes));
    writeFileSync(log, '');
    const result = spawnSync(process.execPath, [tool, ...args, '--git-dir', fx.repo, '--gh', join(fx.bin, 'gh'), '--now', NOW], {
        encoding: 'utf8', env: { PATH: process.env.PATH, FAKE_GH_ROUTES: routesFile, FAKE_GH_LOG: log },
    });
    return { ...result, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

function fingerprints(fx, sha) {
    const out = run(fx, ['fingerprint', '--sha', sha]);
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout);
}

// a zip holding one file, as an artifact's download: stored, or deflated as upload-artifact writes it
function zip(name, data, { deflate = false } = {}) {
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

const selection = (fx, lanes) => {
    const file = join(fx.dir, 'selection');
    writeFileSync(file, LANES.map((lane) => `${lane}=${lanes.includes(lane)}`).join('\n') + '\n');
    return file;
};

const DEMO_JOBS = [...[1, 2, 3, 4].map((s) => `chromium ${s}/4`), ...[1, 2, 3].map((s) => `firefox ${s}/3`), ...[1, 2, 3].map((s) => `webkit ${s}/3`)]
    .map((label, i) => ({ id: 500 + i, name: `Demo + Playwright (${label})`, conclusion: 'success', status: 'completed', run_attempt: 1 }));

// a producer run 71 of ci.yml on `sha` that passed the demo lane, with its pass marker
function producer(fx, sha, fp, { lane = 'demo', jobs = DEMO_JOBS, created = '2026-11-15T12:00:00Z', fails = [], marker = {}, run = {}, deflate = false } = {}) {
    const name = `ci-pass-v1-${lane}-${fp}`;
    const evidence = { schema: 1, kind: 'pass', lane, fingerprint: fp, repo: REPO, sha, run_id: 71, run_attempt: 1, jobs: jobs.map(({ id, name, conclusion, run_attempt }) => ({ id, name, conclusion, run_attempt })), flaky: 2, tests: { passed: 600, failed: 0, flaky: 2, skipped: 3 }, runner: { image_os: 'ubuntu24', image_version: '20261110.1' }, recorded_at: created, ...marker };
    const zipFile = join(fx.dir, `${name}.zip`);
    writeFileSync(zipFile, zip('evidence.json', JSON.stringify(evidence), { deflate }));
    const artifact = { id: 9001, name, expired: false, created_at: created, workflow_run: { id: 71, repository_id: 10, head_repository_id: 10, head_sha: sha, head_branch: 'feature' } };
    return {
        [`repos/${REPO}/actions/artifacts?name=${name}&per_page=100`]: { json: { total_count: 1, artifacts: [artifact] } },
        [`repos/${REPO}/actions/artifacts?name=ci-fail-v1-${lane}-${fp}&per_page=100`]: { json: { total_count: fails.length, artifacts: fails } },
        [`repos/${REPO}/actions/artifacts/9001`]: { json: artifact },
        [`repos/${REPO}/actions/artifacts/9001/zip`]: { file: zipFile },
        [`repos/${REPO}/actions/runs/71`]: { json: { id: 71, path: '.github/workflows/ci.yml', event: 'push', head_sha: sha, head_branch: 'feature', run_attempt: 1, html_url: 'https://github.com/example/project/actions/runs/71', repository: { id: 10, full_name: REPO }, head_repository: { id: 10, full_name: REPO }, ...run } },
        [`repos/${REPO}/actions/runs/71/jobs?filter=latest&per_page=100`]: { json: { total_count: jobs.length, jobs } },
    };
}

function plan(fx, routes, lanes = ['demo'], extra = []) {
    const out = join(fx.dir, 'plan.json');
    const github = join(fx.dir, 'github-output');
    writeFileSync(github, '');
    const result = run(fx, ['plan', '--repo', REPO, '--sha', fx.head(), '--ref', 'refs/heads/feature', '--selection', selection(fx, lanes), '--out', out, '--github-output', github, ...extra], routes);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(readFileSync(github, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    return { plan: JSON.parse(readFileSync(out, 'utf8')), outputs, log: result.stdout, calls: result.calls };
}

test('a fingerprint ignores the administrative files and changes with anything else', (t) => {
    const fx = scratch(t);
    const base = fingerprints(fx, fx.head());
    assert.deepEqual(Object.keys(base.lanes).sort(), ['demo', 'lint-kit', 'php', 'prod-image', 'static-site']);
    assert.deepEqual(base.excluded, ['CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', '.github/pull_request_template.md']);
    for (const fp of Object.values(base.lanes)) assert.match(fp, /^[0-9a-f]{64}$/);
    assert.equal(new Set(Object.values(base.lanes)).size, 5, 'each lane has its own fingerprint');

    for (const path of ['CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', '.github/pull_request_template.md']) {
        assert.deepEqual(fingerprints(fx, fx.commit(path, `edited ${path}\n`)).lanes, base.lanes, `${path} is administrative`);
    }
    let previous = base.lanes;
    for (const [path, content] of [['button/README.md', '# Button!\n'], ['.github/workflows/ci.yml', 'name: CI 2\n'], ['docs/GUIDE.md', 'guide\n'], ['new/file.txt', 'x\n'], ['kit.css', null]]) {
        const now = fingerprints(fx, fx.commit(path, content)).lanes;
        for (const lane of Object.keys(now)) assert.notEqual(now[lane], previous[lane], `${path} changes ${lane}`);
        previous = now;
    }
    fx.git('mv', 'button/README.md', 'button/READ.md');
    fx.git('commit', '-qm', 'rename');
    assert.notEqual(fingerprints(fx, fx.head()).lanes.demo, previous.demo, 'a rename changes it');
});

test('a selected lane with a verified pass on the same inputs is reused, naming its producer', (t) => {
    const fx = scratch(t);
    const producerSha = fx.head();
    const fp = fingerprints(fx, producerSha).lanes.demo;
    fx.commit('CHANGELOG.md', '# Changelog\n\n- prose\n');
    const { plan: p, outputs, log } = plan(fx, producer(fx, producerSha, fp), ['demo', 'php', 'contrast']);
    assert.equal(p.lanes.demo.decision, 'reuse', JSON.stringify(p.lanes.demo));
    assert.equal(p.lanes.demo.reason, 'reused');
    assert.equal(p.lanes.demo.evidence.run_id, 71);
    assert.equal(p.lanes.demo.evidence.head_sha, producerSha);
    assert.equal(p.lanes.demo.evidence.flaky, 2);
    assert.equal(p.lanes.demo.evidence.jobs.length, 10);
    assert.equal(outputs.demo, 'reuse');
    assert.equal(outputs.php, 'run', 'php has no evidence');
    assert.equal(p.lanes.php.reason, 'no_evidence');
    assert.equal(outputs.contrast, 'run');
    assert.equal(p.lanes.contrast.reason, 'not_reusable');
    assert.equal(outputs['static-site'], 'skip');
    assert.equal(p.lanes['static-site'].reason, 'not_selected');
    assert.equal(outputs.importmap, 'run', 'php still runs, so its packages are needed');
    assert.match(log, /demo: reuse \(reused\).*actions\/runs\/71/);
    assert.ok(Number.isInteger(p.api_calls) && p.api_calls > 0);
    assert.ok(Number.isInteger(p.elapsed_ms));
});

test('a deflated marker, as upload-artifact writes it, is read too', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    assert.equal(plan(fx, producer(fx, fx.head(), fp, { deflate: true })).outputs.demo, 'reuse');
});

test('the importmap job is skipped when every lane that needs it is reused or skipped', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    const { outputs } = plan(fx, producer(fx, fx.head(), fp));
    assert.equal(outputs.demo, 'reuse');
    assert.equal(outputs.importmap, 'skip');
});

test('reuse is refused, and the lane runs, unless every check of the evidence holds', (t) => {
    const fx = scratch(t);
    const producerSha = fx.head();
    const fp = fingerprints(fx, producerSha).lanes.demo;
    const failed = (jobs) => jobs.map((job, i) => (i === 3 ? { ...job, conclusion: 'failure' } : job));
    for (const [name, options, reason, routesEdit] of [
        ['no marker', {}, 'no_evidence', (r) => { r[`repos/${REPO}/actions/artifacts?name=ci-pass-v1-demo-${fp}&per_page=100`].json = { total_count: 0, artifacts: [] }; }],
        ['a later failure', { fails: [{ id: 9002, name: `ci-fail-v1-demo-${fp}`, expired: false, created_at: '2026-11-16T01:00:00Z', workflow_run: { id: 72 } }] }, 'later_failure'],
        ['an expired marker', {}, 'evidence_expired', (r) => { r[`repos/${REPO}/actions/artifacts?name=ci-pass-v1-demo-${fp}&per_page=100`].json.artifacts[0].expired = true; }],
        ['older than 14 days', { created: '2026-11-01T11:00:00Z' }, 'evidence_too_old'],
        ['another workflow', { run: { path: '.github/workflows/release-checks.yml' } }, 'wrong_producer'],
        ['a pull request run', { run: { event: 'pull_request' } }, 'wrong_producer'],
        ['a fork', { run: { head_repository: { id: 11, full_name: 'fork/project' } } }, 'wrong_producer'],
        ['a failed shard', { jobs: failed(DEMO_JOBS) }, 'jobs_incomplete'],
        ['a missing shard', { jobs: DEMO_JOBS.slice(1), marker: { jobs: DEMO_JOBS.slice(1) } }, 'jobs_incomplete'],
        ['a marker for another fingerprint', { marker: { fingerprint: 'f'.repeat(64) } }, 'marker_invalid'],
        ['a fail marker named as a pass', { marker: { kind: 'fail' } }, 'marker_invalid'],
        ['a lookup error', {}, 'lookup_error', (r) => { delete r[`repos/${REPO}/actions/runs/71`]; }],
    ]) {
        const routes = producer(fx, producerSha, fp, options);
        routesEdit?.(routes);
        const { plan: p, outputs } = plan(fx, routes);
        assert.equal(outputs.demo, 'run', name);
        assert.equal(p.lanes.demo.reason, reason, `${name}: ${p.lanes.demo.detail}`);
    }
});

test('a producer whose own tree has other inputs is refused, whatever its marker claims', (t) => {
    const fx = scratch(t);
    const producerSha = fx.commit('.github/workflows/ci.yml', 'name: CI that skips its tests\n');
    const current = fx.commit('.github/workflows/ci.yml', 'name: CI\n');
    const fp = fingerprints(fx, current).lanes.demo;
    const { plan: p } = plan(fx, producer(fx, producerSha, fp));
    assert.equal(p.lanes.demo.decision, 'run');
    assert.equal(p.lanes.demo.reason, 'fingerprint_mismatch');
});

test('reuse is off on main and with the switch: every selected lane runs', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    const routes = producer(fx, fx.head(), fp);
    const off = plan(fx, routes, ['demo'], ['--reuse', 'off']);
    assert.equal(off.outputs.demo, 'run');
    assert.equal(off.plan.reuse_off, 'switch');
    assert.equal(off.plan.lanes.demo.reason, 'reuse_off');
    assert.equal(off.calls.length, 0, 'no lookup');
    const out = join(fx.dir, 'plan.json');
    const main = run(fx, ['plan', '--repo', REPO, '--sha', fx.head(), '--ref', 'refs/heads/main', '--selection', selection(fx, ['demo']), '--out', out], routes);
    assert.equal(main.status, 0, main.stderr);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).reuse_off, 'main');
});

function recorded(fx, planLanes, jobs, extra = []) {
    const planFile = join(fx.dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ schema: 1, repo: REPO, sha: 'a'.repeat(40), ref: 'refs/heads/feature', reuse: true, reuse_off: null, lanes: planLanes }));
    const jobsFile = join(fx.dir, 'jobs.json');
    writeFileSync(jobsFile, JSON.stringify(jobs));
    const out = join(fx.dir, 'markers');
    const github = join(fx.dir, 'record-output');
    writeFileSync(github, '');
    const result = run(fx, ['record', '--plan', planFile, '--jobs', jobsFile, '--run-id', '88', '--run-attempt', '2', '--out', out, '--github-output', github, ...extra]);
    assert.equal(result.status, 0, result.stderr);
    const markers = existsSync(out) ? readdirSync(out).sort() : [];
    const read = (name) => JSON.parse(readFileSync(join(out, name, 'evidence.json'), 'utf8'));
    return { markers, read, output: readFileSync(github, 'utf8') };
}

const lane = (decision, fingerprint = 'c'.repeat(64)) => ({ selected: decision !== 'skip', decision, fingerprint, reason: decision === 'reuse' ? 'reused' : 'no_evidence', detail: '', evidence: null });

test('CI result records a pass only for a lane that ran fresh and passed in full, a failure for one that failed', (t) => {
    const fx = scratch(t);
    const php = { id: 600, name: 'Kit PHP', conclusion: 'failure', status: 'completed', run_attempt: 2 };
    const site = { id: 601, name: 'Static site', conclusion: 'cancelled', status: 'completed', run_attempt: 2 };
    const lint = [{ id: 602, name: 'Lint kit (locked toolkit)', conclusion: 'success', status: 'completed', run_attempt: 1 }];
    const { markers, read, output } = recorded(fx, {
        demo: lane('run', 'd'.repeat(64)), php: lane('run', 'e'.repeat(64)), 'static-site': lane('run'), 'lint-kit': lane('run'), 'prod-image': lane('reuse'),
    }, [...DEMO_JOBS, php, site, ...lint]);
    assert.deepEqual(markers, [`ci-fail-v1-php-${'e'.repeat(64)}`, `ci-pass-v1-demo-${'d'.repeat(64)}`]);
    const pass = read(`ci-pass-v1-demo-${'d'.repeat(64)}`);
    assert.equal(pass.kind, 'pass');
    assert.equal(pass.run_id, 88);
    assert.equal(pass.run_attempt, 2);
    assert.deepEqual(pass.jobs.map((job) => job.id), DEMO_JOBS.map((job) => job.id));
    assert.match(output, new RegExp(`^demo-marker=ci-pass-v1-demo-${'d'.repeat(64)}$`, 'm'));
    assert.match(output, /^static-site-marker=$/m, 'a cancelled lane records nothing');
    assert.match(output, /^lint-kit-marker=$/m, 'one of two lint jobs is no full pass');
    assert.match(output, /^prod-image-marker=$/m, 'a reused lane records nothing');
});

test('the verdict tells fresh, reused, not applicable and incomplete apart, and fails on incomplete', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    const routes = producer(fx, fx.head(), fp);
    const evidence = { artifact_id: 9001, artifact_name: `ci-pass-v1-demo-${fp}`, run_id: 71, run_attempt: 1, head_sha: fx.head(), head_branch: 'feature', created_at: '2026-11-15T12:00:00Z', url: 'https://github.com/example/project/actions/runs/71', jobs: DEMO_JOBS, flaky: 2, tests: null };
    const lanes = Object.fromEntries(LANES.map((name) => [name, lane('skip', null)]));
    lanes.demo = { ...lane('reuse', fp), evidence };
    lanes.php = lane('run');
    lanes.contrast = { ...lane('run', null), reason: 'not_reusable' };
    const planFile = join(fx.dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ schema: 1, repo: REPO, sha: fx.head(), ref: 'refs/heads/feature', reuse: true, reuse_off: null, elapsed_ms: 1234, api_calls: 7, lanes }));
    const needs = (overrides) => {
        const results = { changes: 'success', tools: 'success', importmap: 'success', 'lint-kit': 'skipped', php: 'success', 'static-site': 'skipped', 'fresh-install': 'skipped', 'docker-install': 'skipped', package: 'skipped', contrast: 'success', workflows: 'skipped', demo: 'skipped', 'prod-image': 'skipped', ...overrides };
        const file = join(fx.dir, 'needs.json');
        writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]))));
        return file;
    };
    const verdict = (overrides, r = routes) => {
        const summary = join(fx.dir, 'summary.md');
        writeFileSync(summary, '');
        const out = run(fx, ['verdict', '--plan', planFile, '--needs', needs(overrides), '--repo', REPO, '--summary', summary], r);
        return { ...out, json: JSON.parse(out.stdout), summary: readFileSync(summary, 'utf8') };
    };
    const good = verdict({});
    assert.equal(good.status, 0, good.stderr + good.stdout);
    assert.equal(good.json.ok, true);
    assert.equal(good.json.lanes.demo.status, 'reused');
    assert.equal(good.json.lanes.demo.producer.run_id, 71);
    assert.equal(good.json.lanes.demo.flaky, 2);
    assert.equal(good.json.lanes.php.status, 'fresh');
    assert.equal(good.json.lanes.contrast.status, 'fresh');
    assert.equal(good.json.lanes.package.status, 'not_applicable');
    assert.match(good.summary, /demo.*reused.*actions\/runs\/71/);
    assert.match(good.summary, /1234 ms/);
    assert.match(good.summary, /7 API calls/);

    const failed = verdict({ php: 'failure' });
    assert.equal(failed.status, 1);
    assert.equal(failed.json.lanes.php.status, 'incomplete');
    assert.equal(verdict({ php: 'cancelled' }).status, 1, 'a cancelled job is not a pass');
    assert.equal(verdict({ tools: 'failure' }).status, 1, 'Tool tests still decides');
    assert.equal(verdict({ demo: 'success' }).json.lanes.demo.status, 'incomplete', 'a lane planned for reuse that ran is not what was planned');

    const gone = structuredClone(routes);
    delete gone[`repos/${REPO}/actions/artifacts/9001`];
    const requalified = verdict({}, gone);
    assert.equal(requalified.status, 1, 'evidence that disappeared after the plan does not pass');
    assert.equal(requalified.json.lanes.demo.status, 'incomplete');
    const contradicted = producer(fx, fx.head(), fp, { fails: [{ id: 9003, name: `ci-fail-v1-demo-${fp}`, expired: false, created_at: '2026-11-16T02:00:00Z', workflow_run: { id: 73 } }] });
    assert.equal(verdict({}, contradicted).json.lanes.demo.status, 'incomplete', 'a failure recorded after the plan does not pass');

    const summary = join(fx.dir, 'summary.md');
    const draft = run(fx, ['verdict', '--plan', planFile, '--needs', needs({}), '--repo', REPO, '--wo-draft', 'true', '--summary', summary], routes);
    assert.equal(draft.status, 1, 'a work order draft still fails');
});

test("ci.yml runs each lane on the plan's decision, under the job names the tool counts", async () => {
    const { REUSABLE, LANES } = await import('../ci/lane-evidence.mjs');
    const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
    const jobs = workflow.split(/\n(?= {4}[a-z0-9-]+:\n)/).slice(1).map((text) => ({
        id: text.match(/^ {4}([a-z0-9-]+):/)[1],
        name: text.match(/^ {8}name: (.+)$/m)?.[1] ?? '',
        if: text.match(/^ {8}if: (.+)$/m)?.[1] ?? '',
    }));
    const lane = (id) => jobs.find((job) => job.id === id);
    for (const [id, rule] of Object.entries(REUSABLE)) {
        const job = lane(id);
        assert.ok(rule.name !== undefined ? job.name === rule.name : job.name.startsWith(rule.prefix), `${id}: ${job.name}`);
        assert.ok(job.if.includes(`needs.changes.outputs.${id} == 'run'`), `${id}: ${job.if}`);
    }
    for (const id of LANES) assert.match(workflow, new RegExp(`^ {12}${id}: \\$\\{\\{ steps\\.plan\\.outputs\\.${id} \\}\\}$`, 'm'), `Changes outputs ${id} from the plan`);
    assert.doesNotMatch(workflow, /needs\.changes\.outputs\.[a-z-]+ == 'true'/, 'no job runs on the old true/false outputs');
    assert.ok(lane('importmap').if.includes("needs.changes.outputs.importmap == 'run'"));
    assert.ok(lane('docker-install').if.includes("needs.changes.outputs.fresh-install == 'run'"));
    // the matrices: Lint kit's two toolkits, the browser's 4 + 3 + 3 shards
    assert.match(workflow, /toolkit: \[locked, minimum\]/);
    assert.equal(REUSABLE['lint-kit'].count, 2);
    assert.match(workflow, /browser: \[chromium, firefox, webkit\]\n {16}shard: \[1, 2, 3, 4\]/);
    assert.equal(REUSABLE.demo.count, 4 + 3 + 3);
    assert.match(workflow, /lane-evidence\.mjs" verdict/, 'CI result decides with the tool');
});
