// tools/ci/lane-evidence.mjs: the lanes' fingerprints, the plan that reuses a lane's earlier pass, the markers CI result
// records and its verdict. GitHub's API is a stub `gh` serving fixtures by path; git is real, on a scratch repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const tool = fileURLToPath(new URL('../ci/lane-evidence.mjs', import.meta.url));
const REPO = 'example/project';
const NOW = '2026-11-16T12:00:00Z';
const LANES = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows', 'package', 'prod-image'];
const REUSABLE = ['demo', 'php', 'prod-image'];
const EXCLUDED = ['CHANGELOG.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', '.github/pull_request_template.md'];

function gitIn(cwd, ...args) {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
}

function scratch(t) {
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

function run(fx, args, routes = {}, { gitDir = fx.repo, env = {} } = {}) {
    const routesFile = join(fx.dir, 'routes.json');
    const log = join(fx.dir, `gh-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(routesFile, JSON.stringify(routes));
    writeFileSync(log, '');
    const result = spawnSync(process.execPath, [tool, ...args, '--git-dir', gitDir, '--gh', join(fx.bin, 'gh'), '--now', NOW, '--retry-delay-ms', '1'], {
        encoding: 'utf8', env: { PATH: process.env.PATH, FAKE_GH_ROUTES: routesFile, FAKE_GH_LOG: log, ...env },
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

const demoJobs = (base = 500, attempt = 1) => [...[1, 2, 3, 4].map((s) => `chromium ${s}/4`), ...[1, 2, 3].map((s) => `firefox ${s}/3`), ...[1, 2, 3].map((s) => `webkit ${s}/3`)]
    .map((label, i) => ({ id: base + i, name: `Demo + Playwright (${label})`, conclusion: 'success', status: 'completed', run_attempt: attempt, completed_at: '2026-11-15T12:00:00Z' }));
const DEMO_JOBS = demoJobs();
const SKIPPED_DEMO = { id: 499, name: 'Demo + Playwright (${{ matrix.browser }} ${{ matrix.shard }}/${{ matrix.shards }})', conclusion: 'skipped', status: 'completed', run_attempt: 1 };
const brief = (jobs) => jobs.map(({ id, name, conclusion, run_attempt }) => ({ id, name, conclusion, run_attempt }));

/**
 * One marker artifact and the producer run behind it, as API routes: the artifact, its ZIP, its run and the run's
 * latest jobs. `evidence`, `run`, `artifact` and `jobs` override the defaults; `latestJobs` is what the run lists now.
 */
function marker(fx, { lane = 'demo', fp, sha, kind = 'pass', runId = 71, artifactId = 9001, attempt = 1, jobs: given = DEMO_JOBS, latestJobs: givenLatest, created = '2026-11-15T12:00:00Z', completedAt, evidence = {}, run = {}, artifact = {}, zipBytes, deflate = false } = {}) {
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
function routesFor(lane, fp, markers) {
    const routes = {};
    for (const m of markers) Object.assign(routes, m.routes);
    for (const kind of ['pass', 'fail']) {
        const list = markers.map((m) => m.artifact).filter((a) => a.name === `ci-${kind}-v1-${lane}-${fp}`);
        routes[`repos/${REPO}/actions/artifacts?name=ci-${kind}-v1-${lane}-${fp}&per_page=100`] = { json: { total_count: list.length, artifacts: list } };
    }
    return routes;
}

const producer = (fx, sha, fp, options = {}) => routesFor(options.lane ?? 'demo', fp, [marker(fx, { sha, fp, ...options })]);

function plan(fx, routes, lanes = ['demo'], extra = [], ref = 'refs/heads/feature') {
    const out = join(fx.dir, 'plan.json');
    const github = join(fx.dir, 'github-output');
    writeFileSync(github, '');
    const result = run(fx, ['plan', '--repo', REPO, '--sha', fx.head(), '--ref', ref, '--selection', selection(fx, lanes), '--out', out, '--github-output', github, ...extra], routes);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(readFileSync(github, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    return { plan: JSON.parse(readFileSync(out, 'utf8')), outputs, log: result.stdout, calls: result.calls };
}

// fingerprints -------------------------------------------------------------------------------------------------------------

test('a fingerprint ignores the excluded files\' content, not their path or mode, and changes with anything else', (t) => {
    const fx = scratch(t);
    const base = fingerprints(fx, fx.head());
    assert.deepEqual(Object.keys(base.lanes).sort(), [...REUSABLE].sort());
    assert.deepEqual(base.excluded, EXCLUDED);
    for (const fp of Object.values(base.lanes)) assert.match(fp, /^[0-9a-f]{64}$/);
    assert.equal(new Set(Object.values(base.lanes)).size, REUSABLE.length, 'each lane has its own fingerprint');

    for (const path of ['CHANGELOG.md', 'AGENTS.md']) {
        assert.deepEqual(fingerprints(fx, fx.commit(path, `edited ${path}\n`)).lanes, base.lanes, `${path}'s content is not an input`);
    }
    let previous = base.lanes;
    const changed = (what) => {
        const now = fingerprints(fx, fx.head()).lanes;
        for (const lane of Object.keys(now)) assert.notEqual(now[lane], previous[lane], `${what} changes ${lane}`);
        previous = now;
    };
    fx.commit('CONTRIBUTING.md', 'added\n');
    changed('adding an excluded file');
    fx.commit('AGENTS.md', null);
    changed('deleting an excluded file');
    rmSync(join(fx.repo, 'CHANGELOG.md'));
    symlinkSync('kit.css', join(fx.repo, 'CHANGELOG.md'));
    fx.git('add', '-A');
    fx.git('commit', '-qm', 'symlink');
    changed('an excluded file turned into a symlink');
    for (const [path, content] of [['button/README.md', '# Button!\n'], ['.github/workflows/ci.yml', 'name: CI 2\n'], ['docs/GUIDE.md', 'guide\n'], ['new/file.txt', 'x\n'], ['kit.css', null]]) {
        fx.commit(path, content);
        changed(path);
    }
    fx.git('mv', 'button/README.md', 'button/READ.md');
    fx.git('commit', '-qm', 'rename');
    changed('a rename');
});

// plan ---------------------------------------------------------------------------------------------------------------------

test('a selected lane with a verified pass on the same inputs is reused, naming its producer', (t) => {
    const fx = scratch(t);
    const producerSha = fx.head();
    const fp = fingerprints(fx, producerSha).lanes.demo;
    fx.commit('CHANGELOG.md', '# Changelog\n\n- prose\n');
    const { plan: p, outputs, log } = plan(fx, producer(fx, producerSha, fp), ['demo', 'php', 'contrast', 'static-site', 'lint-kit']);
    assert.equal(p.lanes.demo.decision, 'reuse', JSON.stringify(p.lanes.demo));
    assert.equal(p.lanes.demo.reason, 'reused');
    assert.equal(p.lanes.demo.evidence.run_id, 71);
    assert.equal(p.lanes.demo.evidence.head_sha, producerSha);
    assert.equal(p.lanes.demo.evidence.flaky, 2);
    assert.equal(p.lanes.demo.evidence.jobs.length, 10);
    assert.equal(outputs.demo, 'reuse');
    assert.equal(outputs.php, 'run', 'php has no evidence');
    assert.equal(p.lanes.php.reason, 'no_evidence');
    for (const lane of ['contrast', 'static-site', 'lint-kit']) {
        assert.equal(outputs[lane], 'run', lane);
        assert.equal(p.lanes[lane].reason, 'not_reusable', `${lane} always runs when selected`);
    }
    assert.equal(outputs['prod-image'], 'skip');
    assert.equal(p.lanes['prod-image'].reason, 'not_selected');
    assert.equal(outputs.importmap, 'run', 'php and the static site still run, so their packages are needed');
    assert.match(log, /demo: reuse \(reused\).*actions\/runs\/71/);
    assert.ok(Number.isInteger(p.api_calls) && p.api_calls > 0);
    assert.ok(Number.isInteger(p.elapsed_ms));
});

test('a deflated marker, as upload-artifact writes it, is read too; so is a manual run\'s', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    assert.equal(plan(fx, producer(fx, fx.head(), fp, { deflate: true })).outputs.demo, 'reuse');
    assert.equal(plan(fx, producer(fx, fx.head(), fp, { run: { event: 'workflow_dispatch' } })).outputs.demo, 'reuse');
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
    const failed = DEMO_JOBS.map((job, i) => (i === 3 ? { ...job, conclusion: 'failure' } : job));
    const listing = `repos/${REPO}/actions/artifacts?name=ci-pass-v1-demo-${fp}&per_page=100`;
    for (const [name, options, reason, edit] of [
        ['no marker', {}, 'no_evidence', (r) => { r[listing].json = { total_count: 0, artifacts: [] }; }],
        ['an expired marker', { artifact: { expired: true } }, 'evidence_expired'],
        ['older than 14 days', { created: '2026-11-01T11:00:00Z' }, 'evidence_too_old'],
        ['another workflow', { run: { path: '.github/workflows/release-checks.yml' } }, 'wrong_producer'],
        ['a pull request run', { run: { event: 'pull_request' } }, 'wrong_producer'],
        ['a fork', { run: { head_repository: { id: 11, full_name: 'fork/project' } } }, 'wrong_producer'],
        ['another commit than the artifact names', { run: { head_sha: 'b'.repeat(40) } }, 'wrong_producer'],
        ['an artifact of another repository', { artifact: { workflow_run: { id: 71, repository_id: 12, head_repository_id: 12, head_sha: producerSha } } }, 'wrong_producer'],
        ['a failed shard', { jobs: failed }, 'jobs_incomplete'],
        ['a missing shard', { jobs: DEMO_JOBS.slice(1) }, 'jobs_incomplete'],
        ['a producer whose browser jobs were skipped', { jobs: [SKIPPED_DEMO] }, 'jobs_incomplete'],
        ['a marker for another fingerprint', { evidence: { fingerprint: 'f'.repeat(64) } }, 'marker_invalid'],
        ['a fail marker named as a pass', { evidence: { kind: 'fail' } }, 'marker_invalid'],
        ['other job ids than the run lists', { latestJobs: demoJobs(800, 2) }, 'marker_invalid'],
        ['a malformed ZIP', { zipBytes: Buffer.from('PK not a zip') }, 'marker_invalid'],
        ['a ZIP of another file', { zipBytes: zip('other.json', '{}') }, 'marker_invalid'],
        ['evidence that is not JSON', { zipBytes: zip('evidence.json', 'not json') }, 'marker_invalid'],
        ['a lookup error', {}, 'lookup_error', (r) => { delete r[`repos/${REPO}/actions/runs/71`]; }],
        ['a listing that is null', {}, 'lookup_error', (r) => { r[listing] = { text: 'null' }; }],
        ['a listing without artifacts', {}, 'lookup_error', (r) => { r[listing] = { json: { artifacts: 'none' } }; }],
        ['an artifact that is null', {}, 'lookup_error', (r) => { r[listing].json.artifacts = [null]; }],
        ['a run that is null', {}, 'lookup_error', (r) => { r[`repos/${REPO}/actions/runs/71`] = { text: 'null' }; }],
        ['a job list that is null', {}, 'lookup_error', (r) => { r[`repos/${REPO}/actions/runs/71/jobs?filter=latest&per_page=100`] = { json: { jobs: null } }; }],
        ['jobs that are null', {}, 'lookup_error', (r) => { r[`repos/${REPO}/actions/runs/71/jobs?filter=latest&per_page=100`] = { json: { jobs: [null] } }; }],
    ]) {
        const routes = producer(fx, producerSha, fp, options);
        edit?.(routes);
        const { plan: p, outputs } = plan(fx, routes);
        assert.equal(outputs.demo, 'run', name);
        assert.equal(p.lanes.demo.reason, reason, `${name}: ${p.lanes.demo.detail}`);
    }
});

test('the newest pass that verifies is reused; a verified failure newer than it stops the search', (t) => {
    const fx = scratch(t);
    const sha = fx.head();
    const fp = fingerprints(fx, sha).lanes.demo;
    // run 71's demo jobs ran again (Re-run all jobs): its marker names jobs the run no longer lists; run 70 still holds
    const rerun = marker(fx, { sha, fp, runId: 71, artifactId: 9001, created: '2026-11-15T12:00:00Z', latestJobs: demoJobs(800, 2) });
    const older = marker(fx, { sha, fp, runId: 70, artifactId: 8001, created: '2026-11-14T12:00:00Z', jobs: demoJobs(300) });
    const reused = plan(fx, routesFor('demo', fp, [rerun, older]));
    assert.equal(reused.outputs.demo, 'reuse', reused.plan.lanes.demo.detail);
    assert.equal(reused.plan.lanes.demo.evidence.run_id, 70);
    // a verified failure between them stops the search before the older pass
    const failure = marker(fx, { sha, fp, kind: 'fail', runId: 72, artifactId: 8501, created: '2026-11-15T00:00:00Z', jobs: demoJobs(400) });
    const stopped = plan(fx, routesFor('demo', fp, [rerun, failure, older]));
    assert.equal(stopped.outputs.demo, 'run');
    assert.equal(stopped.plan.lanes.demo.reason, 'later_failure');
});

test('a partial re-run of the producer keeps its pass: the lane\'s jobs from the first attempt are still the latest', (t) => {
    const fx = scratch(t);
    const sha = fx.head();
    const fp = fingerprints(fx, sha).lanes.demo;
    const latest = [...DEMO_JOBS, { id: 900, name: 'Kit PHP', conclusion: 'success', status: 'completed', run_attempt: 2 }];
    const { outputs, plan: p } = plan(fx, producer(fx, sha, fp, { attempt: 1, latestJobs: latest, run: { run_attempt: 2 } }));
    assert.equal(outputs.demo, 'reuse', p.lanes.demo.detail);
});

test('a failure marker counts only from a verified producer, newest first across attempts', (t) => {
    const fx = scratch(t);
    const sha = fx.head();
    const fp = fingerprints(fx, sha).lanes.demo;
    const fail = (options) => marker(fx, { sha, fp, kind: 'fail', runId: 72, artifactId: 9002, created: '2026-11-16T01:00:00Z', jobs: demoJobs(400), ...options });
    const pass = marker(fx, { sha, fp });
    assert.equal(plan(fx, routesFor('demo', fp, [pass, fail()])).plan.lanes.demo.reason, 'later_failure');
    assert.equal(plan(fx, routesFor('demo', fp, [pass, fail({ run: { path: '.github/workflows/other.yml' } })])).outputs.demo, 'reuse', 'a failure from another workflow is no evidence');
    assert.equal(plan(fx, routesFor('demo', fp, [pass, fail({ run: { head_repository: { id: 11, full_name: 'fork/project' } } })])).outputs.demo, 'reuse', 'nor one from a fork');
    // one run's attempts: upload-artifact's overwrite keeps the newest attempt's marker of each kind
    // pass (1), fail (2), pass (3): the pass of attempt 3 is newest
    const pfp = [marker(fx, { sha, fp, runId: 73, artifactId: 9103, attempt: 3, created: '2026-11-15T15:00:00Z', jobs: demoJobs(600, 3) }),
        marker(fx, { sha, fp, kind: 'fail', runId: 73, artifactId: 9102, attempt: 2, created: '2026-11-15T14:00:00Z', completedAt: '2026-11-15T15:00:00Z', jobs: demoJobs(550, 2), latestJobs: demoJobs(600, 3) })];
    assert.equal(plan(fx, routesFor('demo', fp, pfp)).outputs.demo, 'reuse', 'pass, fail, pass: reused');
    // fail (1), pass (2), fail (3): the failure of attempt 3 is newest
    const fpf = [marker(fx, { sha, fp, kind: 'fail', runId: 74, artifactId: 9203, attempt: 3, created: '2026-11-15T15:00:00Z', jobs: demoJobs(700, 3) }),
        marker(fx, { sha, fp, runId: 74, artifactId: 9202, attempt: 2, created: '2026-11-15T14:00:00Z', jobs: demoJobs(650, 2), latestJobs: demoJobs(700, 3) })];
    assert.equal(plan(fx, routesFor('demo', fp, fpf)).plan.lanes.demo.reason, 'later_failure', 'fail, pass, fail: refused');
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

test('a producer commit missing locally is fetched without making the clone shallow', (t) => {
    const fx = scratch(t);
    const origin = join(fx.dir, 'origin.git');
    gitIn(fx.dir, 'clone', '-q', '--bare', fx.repo, origin);
    gitIn(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    const clone = join(fx.dir, 'clone');
    gitIn(fx.dir, 'clone', '-q', origin, clone);
    // the producer: a commit on another branch of origin, with the same inputs (only the changelog differs)
    const producerSha = fx.commit('CHANGELOG.md', '# Changelog\n\n- elsewhere\n');
    gitIn(fx.repo, 'push', '-q', origin, 'HEAD:refs/heads/elsewhere');
    const fp = fingerprints(fx, producerSha).lanes.demo;
    const out = join(fx.dir, 'clone-plan.json');
    const result = run(fx, ['plan', '--repo', REPO, '--sha', gitIn(clone, 'rev-parse', 'HEAD'), '--ref', 'refs/heads/feature', '--selection', selection(fx, ['demo']), '--out', out], producer(fx, producerSha, fp), { gitDir: clone });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).lanes.demo.decision, 'reuse', readFileSync(out, 'utf8'));
    assert.equal(existsSync(join(clone, '.git', 'shallow')), false, 'the clone stays complete');
});

test('reuse off, or main, looks nothing up but still fingerprints every lane, so its run records markers', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const routes = producer(fx, fx.head(), fp.demo);
    const off = plan(fx, routes, ['demo', 'php'], ['--reuse', 'off']);
    assert.equal(off.outputs.demo, 'run');
    assert.equal(off.plan.reuse_off, 'switch');
    assert.equal(off.plan.lanes.demo.reason, 'reuse_off');
    assert.equal(off.plan.lanes.demo.fingerprint, fp.demo);
    assert.equal(off.plan.lanes.php.fingerprint, fp.php);
    assert.equal(off.plan.lanes['prod-image'].fingerprint, fp['prod-image'], 'a skipped lane is fingerprinted too');
    assert.equal(off.calls.length, 0, 'no lookup');
    const main = plan(fx, routes, ['demo'], [], 'refs/heads/main');
    assert.equal(main.plan.reuse_off, 'main');
    assert.equal(main.outputs.demo, 'run');
    assert.equal(main.plan.lanes.demo.fingerprint, fp.demo);
    assert.equal(main.calls.length, 0);
});

// record -------------------------------------------------------------------------------------------------------------------

function recorded(fx, planLanes, jobs, { needs, reuse = true, attempt = '1' } = {}) {
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

const lane = (decision, fingerprint = 'c'.repeat(64), reason) => ({ selected: decision !== 'skip', decision, fingerprint, reason: reason ?? (decision === 'reuse' ? 'reused' : decision === 'skip' ? 'not_selected' : 'no_evidence'), detail: '', evidence: null });

test('CI result records a pass only for a lane that ran fresh and passed in full, a failure for one that failed', (t) => {
    const fx = scratch(t);
    const php = { id: 600, name: 'Kit PHP', conclusion: 'failure', status: 'completed', run_attempt: 2 };
    const image = { id: 601, name: 'Production image', conclusion: 'cancelled', status: 'completed', run_attempt: 2 };
    const { result, markers, read, output } = recorded(fx, { demo: lane('run', 'd'.repeat(64)), php: lane('run', 'e'.repeat(64)), 'prod-image': lane('run') }, [...DEMO_JOBS, php, image]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(markers, [`ci-fail-v1-php-${'e'.repeat(64)}`, `ci-pass-v1-demo-${'d'.repeat(64)}`]);
    const pass = read(`ci-pass-v1-demo-${'d'.repeat(64)}`);
    assert.equal(pass.kind, 'pass');
    assert.equal(pass.run_id, 88);
    assert.equal(pass.run_attempt, 1);
    assert.equal(pass.completed_at, '2026-11-15T12:00:00Z', 'the age of the evidence is its jobs\' completion');
    assert.deepEqual(pass.jobs.map((job) => job.id), DEMO_JOBS.map((job) => job.id));
    assert.match(output, new RegExp(`^demo-marker=ci-pass-v1-demo-${'d'.repeat(64)}$`, 'm'));
    assert.match(output, /^demo-kind=pass$/m);
    assert.match(output, /^php-kind=fail$/m);
    assert.match(output, /^prod-image-marker=$/m, 'a cancelled lane records nothing');
    assert.match(output, /^prod-image-kind=$/m);
});

test('CI result records nothing for a reused or skipped lane, or a lane whose only job is the skipped matrix', (t) => {
    const fx = scratch(t);
    const { markers } = recorded(fx, { demo: lane('run'), php: lane('reuse'), 'prod-image': lane('skip') }, [SKIPPED_DEMO, { id: 600, name: 'Kit PHP', conclusion: 'skipped', status: 'completed', run_attempt: 1 }]);
    assert.deepEqual(markers, []);
});

test('CI result records markers with reuse off too: a fresh failure there blocks an older pass', (t) => {
    const fx = scratch(t);
    const failedDemo = DEMO_JOBS.map((job, i) => (i === 0 ? { ...job, conclusion: 'failure' } : job));
    const { markers } = recorded(fx, { demo: lane('run', 'd'.repeat(64), 'reuse_off'), php: lane('run', 'e'.repeat(64), 'reuse_off'), 'prod-image': lane('skip') },
        [...failedDemo, { id: 600, name: 'Kit PHP', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-16T11:00:00Z' }], { reuse: false });
    assert.deepEqual(markers, [`ci-fail-v1-demo-${'d'.repeat(64)}`, `ci-pass-v1-php-${'e'.repeat(64)}`]);
});

test('a failure that cannot be recorded fails the step loudly; a pass that cannot only warns', (t) => {
    const fx = scratch(t);
    const lanes = { demo: lane('run', 'd'.repeat(64)), php: lane('run', 'e'.repeat(64)), 'prod-image': lane('skip') };
    const failedNeeds = { demo: { result: 'failure' }, php: { result: 'success' }, 'prod-image': { result: 'skipped' } };
    for (const jobs of [undefined, 'not json', 'null', '{"jobs":[]}']) {
        const lost = recorded(fx, lanes, jobs, { needs: failedNeeds });
        assert.equal(lost.result.status, 1, `jobs ${jobs}: a failure marker lost is an error`);
        assert.match(lost.result.stderr, /::error::.*demo/);
        const passOnly = recorded(fx, lanes, jobs, { needs: { demo: { result: 'success' }, php: { result: 'success' }, 'prod-image': { result: 'skipped' } } });
        assert.equal(passOnly.result.status, 0, `jobs ${jobs}: a pass marker lost only warns`);
        assert.match(passOnly.result.stdout + passOnly.result.stderr, /::warning::/);
        assert.deepEqual(passOnly.markers, []);
    }
});

// verdict ------------------------------------------------------------------------------------------------------------------

function verdictFixture(t) {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    const routes = producer(fx, fx.head(), fp);
    const evidence = { artifact_id: 9001, artifact_name: `ci-pass-v1-demo-${fp}`, run_id: 71, run_attempt: 1, head_sha: fx.head(), head_branch: 'feature', created_at: '2026-11-15T12:00:00Z', url: 'https://github.com/example/project/actions/runs/71', jobs: brief(DEMO_JOBS), flaky: 2, tests: null };
    const lanes = Object.fromEntries(LANES.map((name) => [name, lane('skip', null)]));
    lanes.demo = { ...lane('reuse', fp), evidence };
    lanes.php = lane('run');
    lanes.contrast = lane('run', null, 'not_reusable');
    const planFile = join(fx.dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ schema: 1, repo: REPO, sha: fx.head(), ref: 'refs/heads/feature', reuse: true, reuse_off: null, elapsed_ms: 1234, api_calls: 7, lanes }));
    const needs = (overrides) => {
        const results = { changes: 'success', tools: 'success', importmap: 'success', 'lint-kit': 'skipped', php: 'success', 'static-site': 'skipped', 'fresh-install': 'skipped', 'docker-install': 'skipped', package: 'skipped', contrast: 'success', workflows: 'skipped', demo: 'skipped', 'prod-image': 'skipped', ...overrides };
        const file = join(fx.dir, 'needs.json');
        writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]))));
        return file;
    };
    const verdict = (overrides = {}, r = routes, extra = []) => {
        const summary = join(fx.dir, 'summary.md');
        writeFileSync(summary, '');
        const out = run(fx, ['verdict', '--plan', planFile, '--needs', needs(overrides), '--repo', REPO, '--summary', summary, ...extra], r);
        return { ...out, json: JSON.parse(out.stdout), summary: readFileSync(summary, 'utf8') };
    };
    return { fx, fp, routes, verdict };
}

test('the verdict tells fresh, reused, not applicable and incomplete apart, and fails on incomplete', (t) => {
    const { verdict } = verdictFixture(t);
    const good = verdict();
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

    assert.equal(verdict({ php: 'failure' }).status, 1);
    assert.equal(verdict({ php: 'failure' }).json.lanes.php.status, 'incomplete');
    assert.equal(verdict({ php: 'cancelled' }).status, 1, 'a cancelled job is not a pass');
    assert.equal(verdict({ tools: 'failure' }).status, 1, 'Tool tests still decides');
    assert.equal(verdict({ demo: 'success' }).json.lanes.demo.status, 'incomplete', 'a lane planned for reuse that ran is not what was planned');
    assert.equal(verdict({}, undefined, ['--wo-draft', 'true']).status, 1, 'a work order draft still fails');
});

test('the verdict checks reused evidence again, and says that only Re-run all jobs plans again', (t) => {
    const { fx, fp, routes, verdict } = verdictFixture(t);
    const refused = (name, r) => {
        const out = verdict({}, r);
        assert.equal(out.status, 1, `${name}: ${out.stdout}`);
        assert.equal(out.json.lanes.demo.status, 'incomplete', name);
        assert.match(out.stderr, /Re-run all jobs/, `${name}: the message says how to plan again`);
        return out;
    };
    const gone = structuredClone(routes);
    delete gone[`repos/${REPO}/actions/artifacts/9001`];
    refused('evidence gone', gone);
    refused('a failure recorded since', routesFor('demo', fp, [marker(fx, { sha: fx.head(), fp }), marker(fx, { sha: fx.head(), fp, kind: 'fail', runId: 73, artifactId: 9003, created: '2026-11-16T02:00:00Z', jobs: demoJobs(400) })]));
    refused('the producer\'s jobs ran again', producer(fx, fx.head(), fp, { latestJobs: demoJobs(800, 2) }));
    refused('the marker expired', producer(fx, fx.head(), fp, { artifact: { expired: true } }));
    // age is decided once, by the plan: an older pass it accepted is not refused here for its age
    assert.equal(verdict({}, producer(fx, fx.head(), fp, { created: '2026-11-01T00:00:00Z' })).json.lanes.demo.status, 'reused');
    refused('an artifact that is null', { ...routes, [`repos/${REPO}/actions/artifacts/9001`]: { text: 'null' } });
    const down = structuredClone(routes);
    down[`repos/${REPO}/actions/runs/71`] = { ...down[`repos/${REPO}/actions/runs/71`], fail: 'HTTP 502' };
    const error = refused('an API that keeps failing', down);
    assert.ok(error.calls.filter((call) => call === `repos/${REPO}/actions/runs/71`).length >= 3, 'retried before giving up');
    // a failure from a producer that does not verify is no contradiction
    const foreign = routesFor('demo', fp, [marker(fx, { sha: fx.head(), fp }), marker(fx, { sha: fx.head(), fp, kind: 'fail', runId: 73, artifactId: 9003, created: '2026-11-16T02:00:00Z', jobs: demoJobs(400), run: { event: 'pull_request' } })]);
    assert.equal(verdict({}, foreign).json.lanes.demo.status, 'reused');
});

test('the verdict retries a transient API error before deciding', (t) => {
    const { routes, verdict } = verdictFixture(t);
    const flaky = structuredClone(routes);
    flaky[`repos/${REPO}/actions/runs/71`] = { ...flaky[`repos/${REPO}/actions/runs/71`], fail: 'HTTP 502', failTimes: 2 };
    const out = verdict({}, flaky);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.json.lanes.demo.status, 'reused');
    const notFound = structuredClone(routes);
    delete notFound[`repos/${REPO}/actions/artifacts/9001`];
    const missing = verdict({}, notFound);
    assert.equal(missing.calls.filter((call) => call === `repos/${REPO}/actions/artifacts/9001`).length, 1, 'a 404 is not retried');
});

// ci.yml -------------------------------------------------------------------------------------------------------------------

test("ci.yml runs each lane on the plan's decision, under the job names the tool counts, and records every reusable lane", async () => {
    const { REUSABLE: rules, LANES: lanes } = await import('../ci/lane-evidence.mjs');
    assert.deepEqual(Object.keys(rules).sort(), [...REUSABLE].sort());
    const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
    const jobs = workflow.split(/\n(?= {4}[a-z0-9-]+:\n)/).slice(1).map((text) => ({
        id: text.match(/^ {4}([a-z0-9-]+):/)[1],
        text,
        name: text.match(/^ {8}name: (.+)$/m)?.[1] ?? '',
        if: text.match(/^ {8}if: (.+)$/m)?.[1] ?? '',
        needs: text.match(/^ {8}needs: (.+)$/m)?.[1] ?? '',
    }));
    const job = (id) => jobs.find((j) => j.id === id);
    for (const [id, rule] of Object.entries(rules)) {
        const j = job(id);
        assert.ok(rule.name !== undefined ? j.name === rule.name : j.name.startsWith(rule.prefix), `${id}: ${j.name}`);
        assert.ok(j.if.includes(`needs.changes.outputs.${id} == 'run'`), `${id}: ${j.if}`);
    }
    for (const id of ['lint-kit', 'static-site', 'fresh-install', 'contrast', 'workflows', 'package']) {
        assert.ok(job(id).if.includes(`needs.changes.outputs.${id} == 'run'`), id);
    }
    for (const id of lanes) assert.match(workflow, new RegExp(`^ {12}${id}: \\$\\{\\{ steps\\.plan\\.outputs\\.${id} \\}\\}$`, 'm'), `Changes outputs ${id} from the plan`);
    assert.doesNotMatch(workflow, /needs\.changes\.outputs\.[a-z-]+ == 'true'/, 'no job runs on the old true/false outputs');
    assert.ok(job('importmap').if.includes("needs.changes.outputs.importmap == 'run'"));
    assert.ok(job('docker-install').if.includes("needs.changes.outputs.fresh-install == 'run'"));
    assert.match(job('cache').if, /needs\.changes\.outputs\.demo == 'run' \|\| needs\.changes\.outputs\.demo == 'reuse'/, 'the build cache stays fresh when the browser lane is reused');

    // the browser matrix: browsers x shards, less the exclusions
    const matrix = job('demo').text;
    const browsers = matrix.match(/browser: \[([^\]]+)\]/)[1].split(',').length;
    const shards = matrix.match(/shard: \[([^\]]+)\]/)[1].split(',').length;
    const excluded = (matrix.match(/exclude:\n((?: +- browser: .+\n +shard: .+\n)+)/)?.[1].match(/- browser:/g) ?? []).length;
    assert.ok(excluded > 0, 'the exclusions are read');
    assert.equal(rules.demo.count, browsers * shards - excluded);

    // CI result: every lane job among its needs, the plan read by name from Changes, record and verdict by the tool
    const result = job('result');
    for (const id of [...lanes, 'docker-install', 'importmap', 'tools', 'changes']) assert.ok(result.needs.includes(id), `CI result needs ${id}`);
    assert.match(result.text, /artifact-ids: \$\{\{ needs\.changes\.outputs\.lane-plan-id \}\}/, 'the plan artifact by the id Changes gave it, whatever the attempt');
    assert.match(job('changes').text, /lane-plan: \$\{\{ steps\.plan\.outputs\.artifact \}\}/);
    assert.match(result.text, /set -o pipefail[\s\S]*lane-evidence\.mjs record/, 'the record sees a failed job listing');
    assert.match(result.text, /node tools\/ci\/lane-evidence\.mjs verdict/, 'CI result decides with the tool');
    const steps = result.text.split(/\n(?= {12}- )/);
    for (const id of Object.keys(rules)) {
        for (const kind of ['pass', 'fail']) {
            const step = steps.find((s) => s.includes(`steps.record.outputs.${id}-kind == '${kind}'`));
            assert.ok(step, `${id}: an upload step for its ${kind} marker`);
            assert.match(step, /upload-artifact@/);
            assert.match(step, /overwrite: true/, `${id} ${kind}: the newest attempt's marker wins`);
            assert.match(step, new RegExp(`name: \\$\\{\\{ steps\\.record\\.outputs\\.${id}-marker \\}\\}`));
            if (kind === 'fail') assert.doesNotMatch(step, /continue-on-error/, `${id}: a failure marker is never best effort`);
        }
    }
    assert.doesNotMatch(steps.find((s) => s.includes('name: Record the lanes that ran')), /continue-on-error/, 'the record fails loudly');
});

// the stack's review, and the plan's speed ------------------------------------------------------------------------------------

test("the age of a pass is its lane jobs' completion, not its marker's creation, checked against the API", (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes.demo;
    // a marker made an hour ago (a re-run's CI result) for jobs that completed more than 14 days ago: too old
    const stale = plan(fx, producer(fx, fx.head(), fp, { created: '2026-11-16T11:00:00Z', completedAt: '2026-11-01T00:00:00Z' }));
    assert.equal(stale.outputs.demo, 'run');
    assert.equal(stale.plan.lanes.demo.reason, 'evidence_too_old');
    // a marker whose completion time disagrees with the jobs' is not believed
    const lying = plan(fx, producer(fx, fx.head(), fp, { evidence: { completed_at: '2026-11-16T10:00:00Z' } }));
    assert.equal(lying.plan.lanes.demo.reason, 'marker_invalid');
    const fresh = plan(fx, producer(fx, fx.head(), fp, { created: '2026-11-16T11:00:00Z', completedAt: '2026-11-16T10:00:00Z' }));
    assert.equal(fresh.outputs.demo, 'reuse');
});

test('a later attempt does not record again a lane whose jobs all ran in an earlier one', (t) => {
    const fx = scratch(t);
    const lanes = { php: lane('run', 'e'.repeat(64)), demo: lane('run', 'd'.repeat(64)), 'prod-image': lane('skip') };
    const php = { id: 600, name: 'Kit PHP', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T06:00:00Z' };
    // attempt 2 re-ran one browser shard: the demo lane records again, its age the oldest shard's; Kit PHP does not
    const shards = demoJobs().map((job, i) => (i === 0 ? { ...job, run_attempt: 2, completed_at: '2026-11-16T11:00:00Z' } : job));
    const { markers, read } = recorded(fx, lanes, [php, ...shards], { attempt: '2' });
    assert.deepEqual(markers, [`ci-pass-v1-demo-${'d'.repeat(64)}`]);
    assert.equal(read(markers[0]).completed_at, '2026-11-15T12:00:00Z', 'as old as its oldest job');
    // a pass whose jobs carry no completion time records nothing (its age could not be told)
    const { completed_at: _, ...undated } = php;
    const unknown = recorded(fx, lanes, [{ ...undated, run_attempt: 2 }, ...demoJobs(500, 2)], { attempt: '2' });
    assert.ok(!unknown.markers.some((m) => m.includes('-php-')));
});

test('a browser shard that ended before its tests started is incomplete, not failed: no failure marker', (t) => {
    const fx = scratch(t);
    const steps = (tests) => [{ name: 'Install the browsers', conclusion: tests === 'skipped' ? 'failure' : 'success' }, { name: 'Playwright (smoke + every README example + UXor recipe specs)', conclusion: tests }];
    const lanes = { demo: lane('run', 'd'.repeat(64)), php: lane('skip'), 'prod-image': lane('skip') };
    const setupFailed = DEMO_JOBS.map((job, i) => (i === 0 ? { ...job, conclusion: 'failure', steps: steps('skipped') } : job));
    assert.deepEqual(recorded(fx, lanes, setupFailed, { needs: { demo: { result: 'failure' } } }).markers, [], 'no failure marker for tests that never ran');
    const testsFailed = DEMO_JOBS.map((job, i) => (i === 0 ? { ...job, conclusion: 'failure', steps: steps('failure') } : job));
    assert.deepEqual(recorded(fx, lanes, testsFailed, { needs: { demo: { result: 'failure' } } }).markers, [`ci-fail-v1-demo-${'d'.repeat(64)}`]);
    const stepless = DEMO_JOBS.map((job, i) => (i === 0 ? { ...job, conclusion: 'failure' } : job));
    assert.deepEqual(recorded(fx, lanes, stepless, { needs: { demo: { result: 'failure' } } }).markers, [`ci-fail-v1-demo-${'d'.repeat(64)}`], 'without its steps, a failed job counts as failed');
});

test("the plan's lookups for several lanes overlap, and decide as before", (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const sha = fx.head();
    const lanes = { demo: demoJobs(), php: [{ id: 600, name: 'Kit PHP', conclusion: 'success', status: 'completed', run_attempt: 1 }], 'prod-image': [{ id: 601, name: 'Production image', conclusion: 'success', status: 'completed', run_attempt: 1 }] };
    // one producer run passed all three lanes
    const all = Object.values(lanes).flat();
    const routes = {};
    Object.entries(lanes).forEach(([lane, jobs], i) => Object.assign(routes, routesFor(lane, fp[lane], [marker(fx, { lane, sha, fp: fp[lane], jobs, latestJobs: all, artifactId: 9900 + i, runId: 90 })])));
    const times = join(fx.dir, 'times');
    writeFileSync(times, '');
    const out = join(fx.dir, 'plan.json');
    const result = run(fx, ['plan', '--repo', REPO, '--sha', sha, '--ref', 'refs/heads/feature', '--selection', selection(fx, ['demo', 'php', 'prod-image']), '--out', out], routes, { env: { FAKE_GH_DELAY_MS: '200', FAKE_GH_TIMES: times } });
    assert.equal(result.status, 0, result.stderr);
    const planned = JSON.parse(readFileSync(out, 'utf8'));
    for (const lane of Object.keys(lanes)) assert.equal(planned.lanes[lane].decision, 'reuse', `${lane}: ${planned.lanes[lane].detail}`);
    const spans = readFileSync(times, 'utf8').trim().split('\n').map((line) => line.split(' ').slice(0, 2).map(Number));
    const overlapping = spans.some(([start, end], i) => spans.some(([s2], j) => j !== i && s2 > start && s2 < end));
    assert.ok(overlapping, 'some calls run at the same time');
    const serial = spans.reduce((sum, [start, end]) => sum + (end - start), 0);
    assert.ok(planned.elapsed_ms < serial * 0.6, `the plan (${planned.elapsed_ms} ms) is well under its calls one after another (${serial} ms)`);
    const listings = result.calls.filter((c) => c.includes('/actions/artifacts?name='));
    assert.equal(new Set(listings).size, listings.length, 'each listing fetched once');
    assert.equal(result.calls.filter((c) => /\/runs\/90$/.test(c)).length, 1, 'the producer run once, shared by the lanes');
});

test("CI result runs the tool of the run's own commit, and takes only plan.json from the artifact, bound by id and digest", async (t) => {
    const { stepIn } = await import('../ci/step-attempts.mjs');
    const fx = scratch(t);
    const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
    const jobText = (id) => workflow.split(/\n(?= {4}[a-z0-9-]+:\n)/).find((text) => text.startsWith(`    ${id}:\n`));
    const changes = jobText('changes');
    assert.match(changes, /^ {12}lane-plan-id: \$\{\{ steps\.plan-upload\.outputs\.artifact-id \}\}$/m);
    assert.match(changes, /^ {12}lane-plan-sha256: \$\{\{ steps\.plan\.outputs\.sha256 \}\}$/m);
    assert.doesNotMatch(changes, /cp tools\/ci\/lane-evidence\.mjs/, 'no copy of the tool goes into the artifact');
    const upload = changes.split(/\n(?= {12}- )/).find((s) => s.includes('id: plan-upload'));
    assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/lane-plan\/plan\.json/);
    assert.doesNotMatch(workflow, /RUNNER_TEMP\/lane-plan\/lane-evidence\.mjs/, 'nothing is executed from the artifact');
    const steps = jobText('result').split(/\n(?= {12}- )/);
    const download = steps.find((s) => s.includes('download-artifact@') && s.includes('lane-plan'));
    assert.match(download, /artifact-ids: \$\{\{ needs\.changes\.outputs\.lane-plan-id \}\}/);
    const checkout = steps.find((s) => s.includes('actions/checkout@'));
    assert.match(checkout, /persist-credentials: false/);
    assert.match(checkout, /sparse-checkout: \|\n\s+tools\/ci/);
    assert.ok(steps.indexOf(checkout) < steps.findIndex((s) => s.includes('id: lane-plan')), 'the checkout comes before the tool runs');
    for (const id of ['record', 'verdict']) assert.match(steps.find((s) => s.includes(`id: ${id}\n`)), /if: \$\{\{ always\(\) && steps\.lane-plan\.outcome == 'success' \}\}/, `${id} runs only on the checked plan`);
    // the check itself: Changes must have succeeded, and plan.json must be the one Changes wrote
    const check = stepIn(workflow, 'result', 'lane-plan');
    mkdirSync(join(fx.dir, 'temp', 'lane-plan'), { recursive: true });
    const planFile = join(fx.dir, 'temp', 'lane-plan', 'plan.json');
    writeFileSync(planFile, '{"schema":1}\n');
    const digest = spawnSync('sha256sum', [planFile], { encoding: 'utf8' }).stdout.split(' ')[0];
    const go = (env) => spawnSync('bash', ['-eo', 'pipefail', '-c', check.run], { encoding: 'utf8',
        env: { PATH: process.env.PATH, RUNNER_TEMP: join(fx.dir, 'temp'), CHANGES: 'success', PLAN_SHA256: digest, ...env } });
    const failedChanges = go({ CHANGES: 'failure' });
    assert.equal(failedChanges.status, 1);
    assert.match(failedChanges.stdout, /::error::the Changes job ended with failure/);
    const forged = go({ PLAN_SHA256: 'f'.repeat(64) });
    assert.equal(forged.status, 1);
    assert.match(forged.stdout, /::error::plan\.json is not the one the Changes job wrote/);
    assert.equal(go({ PLAN_SHA256: '' }).status, 1, 'no digest from Changes: no verdict');
    assert.equal(go({}).status, 0);
    writeFileSync(planFile, '{"schema":1,"lanes":{}}\n');
    assert.equal(go({}).status, 1, 'a replaced plan.json is refused');
});
