// tools/ci/lane-evidence.mjs: the lanes' fingerprints, the plan that reuses a lane's earlier pass, the markers CI result
// records and its verdict. GitHub's API is a stub `gh` serving fixtures by path; git is real, on a scratch repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, existsSync, openSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { stepIn } from '../ci/step-attempts.mjs';

const tool = fileURLToPath(new URL('../ci/lane-evidence.mjs', import.meta.url));
const REPO = 'example/project';
const NOW = '2026-11-16T12:00:00Z';
const LANES = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows', 'package', 'prod-image'];
const REUSABLE = ['demo', 'engines', 'php', 'prod-image', 'fresh-install', 'lint-kit', 'package'];
const LANES_ALL = [...LANES, 'engines'];
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

// the browser job's matrix: CHROMIUM_SHARDS (6) Chromium shards are the demo lane, three each of Firefox and WebKit the
// engines lane
const demoJobs = (base = 500, attempt = 1, shards = 6) => Array.from({ length: shards }, (_, i) => `chromium ${i + 1}/${shards}`)
    .map((label, i) => ({ id: base + i, name: `Demo + Playwright (${label})`, conclusion: 'success', status: 'completed', run_attempt: attempt, completed_at: '2026-11-15T12:00:00Z' }));
const engineJobs = (base = 700, attempt = 1) => [...[1, 2, 3].map((s) => `firefox ${s}/3`), ...[1, 2, 3].map((s) => `webkit ${s}/3`)]
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
    // each lane names what it ignores the content of; Package reads CHANGELOG.md's latest version for its references
    for (const lane of REUSABLE) {
        assert.deepEqual(base.excluded[lane], lane === 'package' ? EXCLUDED.filter((f) => f !== 'CHANGELOG.md') : EXCLUDED, lane);
    }
    for (const fp of Object.values(base.lanes)) assert.match(fp, /^[0-9a-f]{64}$/);
    assert.equal(new Set(Object.values(base.lanes)).size, REUSABLE.length, 'each lane has its own fingerprint');

    assert.deepEqual(fingerprints(fx, fx.commit('AGENTS.md', 'edited AGENTS.md\n')).lanes, base.lanes, "AGENTS.md's content is no lane's input");
    const changelog = fingerprints(fx, fx.commit('CHANGELOG.md', 'edited CHANGELOG.md\n')).lanes;
    for (const lane of REUSABLE) {
        if (lane === 'package') assert.notEqual(changelog.package, base.lanes.package, "CHANGELOG.md's content is Package's input");
        else assert.equal(changelog[lane], base.lanes[lane], `CHANGELOG.md's content is not ${lane}'s input`);
    }
    let previous = changelog;
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
    assert.equal(p.lanes.demo.evidence.jobs.length, 6);
    assert.equal(outputs.demo, 'reuse');
    assert.equal(outputs.php, 'run', 'php has no evidence');
    assert.equal(p.lanes.php.reason, 'no_evidence');
    for (const lane of ['contrast', 'static-site']) {
        assert.equal(outputs[lane], 'run', lane);
        assert.equal(p.lanes[lane].reason, 'not_reusable', `${lane} always runs when selected`);
    }
    assert.equal(p.lanes['lint-kit'].reason, 'no_evidence', 'Lint kit is reusable for a day, and has no pass here');
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

// the engines lane (Firefox, WebKit) ---------------------------------------------------------------------------------------

function enginesPlan(fx, routes = {}, { event = 'push', ref = 'refs/heads/feature', enginesOn = 'daily', engines = 'false', lanes = ['demo'], extra = '', shards = '6' } = {}) {
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

const engineRoutes = (fx, sha, fp, options = {}) => routesFor('engines', fp, [marker(fx, { lane: 'engines', sha, fp, jobs: engineJobs(), artifactId: 9501, runId: 75, ...options })]);

test('on a branch push the engines lane is deferred, never reported as not applicable, unless a pass on its inputs exists', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const deferred = enginesPlan(fx);
    assert.equal(deferred.plan.lanes.engines.decision, 'defer');
    assert.equal(deferred.plan.lanes.engines.reason, 'deferred');
    assert.notEqual(deferred.plan.lanes.engines.reason, 'not_selected');
    assert.equal(deferred.outputs.engines, 'defer');
    assert.match(deferred.log, /engines: defer \(deferred\).*NOT RUN AT THIS STAGE/);
    assert.equal(deferred.outputs.browsers, 'run');
    assert.deepEqual(deferred.matrix.include.map((e) => `${e.browser} ${e.shard}/${e.shards}`), [1, 2, 3, 4, 5, 6].map((n) => `chromium ${n}/6`));
    assert.equal(deferred.matrix.include[0].projects, '--project=smoke --project=examples');
    const reused = enginesPlan(fx, engineRoutes(fx, fx.head(), fp.engines));
    assert.equal(reused.outputs.engines, 'reuse', reused.plan.lanes.engines.detail);
    assert.equal(enginesPlan(fx, {}, { lanes: ['php'] }).outputs.engines, 'skip', 'no browser lane selected: neither');
});

test('the engines lane runs when asked, on main, with every push, and on the daily run without a pass on its inputs', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const browsers = (p) => p.matrix.include.map((e) => e.browser);
    const asked = enginesPlan(fx, {}, { event: 'dispatch', engines: 'true' });
    assert.equal(asked.outputs.engines, 'run');
    assert.equal(asked.plan.lanes.engines.reason, 'no_evidence');
    assert.equal(browsers(asked).length, 12);
    assert.deepEqual(asked.matrix.include.filter((e) => e.browser === 'webkit').map((e) => [e.shard, e.shards, e.projects]),
        [[1, 3, '--project=smoke-webkit --project=examples-webkit'], [2, 3, '--project=smoke-webkit --project=examples-webkit'], [3, 3, '--project=smoke-webkit --project=examples-webkit']]);
    const main = enginesPlan(fx, engineRoutes(fx, fx.head(), fp.engines), { ref: 'refs/heads/main' });
    assert.equal(main.outputs.engines, 'run', 'main runs fresh, evidence or not');
    assert.equal(main.plan.lanes.engines.reason, 'reuse_off');
    assert.equal(enginesPlan(fx, {}, { enginesOn: 'every-push' }).outputs.engines, 'run', 'the switch back: every push');
    const daily = enginesPlan(fx, {}, { event: 'daily', lanes: ['fresh-install', 'package'], extra: 'engines=true\n' });
    assert.equal(daily.outputs.engines, 'run');
    assert.equal(daily.outputs.demo, 'skip');
    assert.deepEqual([...new Set(browsers(daily))], ['firefox', 'webkit']);
    assert.equal(daily.outputs.importmap, 'run', 'the engines need the importmap packages too');
    const passed = enginesPlan(fx, engineRoutes(fx, fx.head(), fp.engines), { event: 'daily', lanes: ['fresh-install', 'package'], extra: 'engines=true\n' });
    assert.equal(passed.outputs.engines, 'reuse', 'no change since the last all-browser pass: nothing to run');
    assert.equal(passed.outputs.browsers, 'skip');
    assert.deepEqual(passed.matrix.include, []);
    assert.equal(passed.outputs.importmap, 'skip');
});

test('the Chromium shard count is one setting: the matrix and the demo lane\'s expected jobs follow it', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const eight = enginesPlan(fx, producer(fx, fx.head(), fp.demo), { shards: '8' });
    assert.equal(eight.matrix.include.length, 8);
    assert.equal(eight.plan.lanes.demo.jobs_expected, 8);
    assert.equal(eight.plan.lanes.engines.jobs_expected, 6);
    assert.equal(eight.plan.lanes.demo.reason, 'jobs_incomplete', 'a pass with six shards is not a pass with eight');
    for (const bad of ['0', 'x', '21']) {
        const out = run(fx, ['plan', '--repo', REPO, '--sha', fx.head(), '--chromium-shards', bad, '--selection', selection(fx, ['demo']), '--out', join(fx.dir, 'p.json')]);
        assert.equal(out.status, 2, `--chromium-shards ${bad}`);
    }
    for (const bad of [['--engines-on', 'weekly'], ['--event', 'nightly']]) {
        const out = run(fx, ['plan', '--repo', REPO, '--sha', fx.head(), ...bad, '--selection', selection(fx, ['demo']), '--out', join(fx.dir, 'p.json')]);
        assert.equal(out.status, 2, bad.join(' '));
    }
});

test('Release checks can require an engines pass for a commit: the require command', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const ok = run(fx, ['require', '--lane', 'engines', '--repo', REPO, '--sha', fx.head()], engineRoutes(fx, fx.head(), fp.engines));
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /actions\/runs\/75/);
    const none = run(fx, ['require', '--lane', 'engines', '--repo', REPO, '--sha', fx.head()], {});
    assert.equal(none.status, 1);
    assert.match(none.stdout, /no_evidence/);
    const failed = run(fx, ['require', '--lane', 'engines', '--repo', REPO, '--sha', fx.head()], routesFor('engines', fp.engines, [
        marker(fx, { lane: 'engines', sha: fx.head(), fp: fp.engines, jobs: engineJobs(), artifactId: 9501, runId: 75 }),
        marker(fx, { lane: 'engines', kind: 'fail', sha: fx.head(), fp: fp.engines, jobs: engineJobs(800), artifactId: 9502, runId: 76, created: '2026-11-16T01:00:00Z' })]));
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /later_failure/);
    assert.equal(run(fx, ['require', '--lane', 'contrast', '--repo', REPO, '--sha', fx.head()]).status, 2, 'only a reusable lane');
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

const lane = (decision, fingerprint = 'c'.repeat(64), reason) => ({ selected: decision !== 'skip', decision, fingerprint, reason: reason ?? (decision === 'reuse' ? 'reused' : decision === 'skip' ? 'not_selected' : decision === 'defer' ? 'deferred' : 'no_evidence'), detail: '', evidence: null });

test('CI result records a pass only for a lane that ran fresh and passed in full, a failure for one that failed', (t) => {
    const fx = scratch(t);
    const php = { id: 600, name: 'Kit PHP', conclusion: 'failure', status: 'completed', run_attempt: 2 };
    const image = { id: 601, name: 'Production image', conclusion: 'cancelled', status: 'completed', run_attempt: 2 };
    const { result, markers, read, output } = recorded(fx, { demo: lane('run', 'd'.repeat(64)), php: lane('run', 'e'.repeat(64)), 'prod-image': lane('run'), engines: lane('defer') }, [...DEMO_JOBS, php, image]);
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
    assert.match(output, /^engines-kind=$/m, 'a deferred lane records nothing');
});

test('one browser job, two lanes: the Chromium shards and the engines are recorded apart', (t) => {
    const fx = scratch(t);
    const engines = engineJobs().map((job, i) => (i === 4 ? { ...job, conclusion: 'failure' } : job));
    const { result, markers } = recorded(fx, { demo: lane('run', 'd'.repeat(64)), engines: lane('run', 'f'.repeat(64)), php: lane('skip'), 'prod-image': lane('skip') },
        [...DEMO_JOBS, ...engines], { needs: { demo: { result: 'failure' } } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(markers, [`ci-fail-v1-engines-${'f'.repeat(64)}`, `ci-pass-v1-demo-${'d'.repeat(64)}`], 'the shared job failing is the engines\' failure, not Chromium\'s');
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

function verdictFixture(t, { engines = lane('defer', 'f'.repeat(64)), event = 'push' } = {}) {
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
    assert.equal(verdict({ demo: 'success' }, undefined, [], DEMO_JOBS).json.lanes.demo.status, 'incomplete', 'a lane planned for reuse that ran is not what was planned');
});

test('a deferred engines lane is reported as not run at this stage, never as a pass or not applicable, and fails nothing', (t) => {
    const { verdict } = verdictFixture(t);
    const out = verdict();
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.json.lanes.engines.status, 'not_run_at_this_stage');
    assert.match(out.summary, /\| engines \| NOT RUN AT THIS STAGE \|[^\n]*Firefox and WebKit run on dev's daily run, on the release pull request, or by a manual run with engines/);
    assert.doesNotMatch(out.summary, /\| engines \| (fresh|reused|not_applicable)/);
    assert.match(out.stdout + out.stderr, /::notice::.*NOT RUN AT THIS STAGE/);
    assert.equal(verdict({ demo: 'success' }, undefined, [], [...DEMO_JOBS.map((j) => ({ ...j, id: j.id + 1000 })), ...engineJobs()]).json.lanes.engines.status, 'incomplete', 'a deferred lane that ran is not what was planned');
});

test('the verdict judges the Chromium shards and the engines apart, though they share one job', (t) => {
    const { verdict } = verdictFixture(t, { engines: lane('run', 'f'.repeat(64)) });
    const engines = engineJobs().map((job, i) => (i === 2 ? { ...job, conclusion: 'failure' } : job));
    const red = verdict({ demo: 'failure' }, undefined, [], engines);
    assert.equal(red.status, 1);
    assert.equal(red.json.lanes.engines.status, 'incomplete');
    assert.equal(red.json.lanes.demo.status, 'reused', 'the reused Chromium lane is not blamed for an engine\'s failure');
    const green = verdict({ demo: 'success' }, undefined, [], engineJobs());
    assert.equal(green.status, 0, green.stderr);
    assert.equal(green.json.lanes.engines.status, 'fresh');
    assert.equal(green.json.lanes.demo.status, 'reused');
    assert.equal(verdict({ demo: 'success' }, undefined, [], engineJobs().slice(1)).json.lanes.engines.status, 'incomplete', 'a missing engine shard');
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
    // age is decided once, by the plan: an older pass it accepted is not refused here for its age (stack review, item 5)
    assert.equal(verdict({}, producer(fx, fx.head(), fp, { created: '2026-11-01T00:00:00Z' })).json.lanes.demo.status, 'reused');
    refused('an artifact that is null', { ...routes, [`repos/${REPO}/actions/artifacts/9001`]: { text: 'null' } });
    const down = structuredClone(routes);
    down[`repos/${REPO}/actions/runs/71`] = { ...down[`repos/${REPO}/actions/runs/71`], fail: 'HTTP 502' };
    const error = refused('an API that keeps failing', down);
    assert.ok(error.calls.filter((call) => call === `repos/${REPO}/actions/runs/71`).length >= 3, 'retried before giving up');
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

// the workflows ------------------------------------------------------------------------------------------------------------

function workflowJobs(file) {
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

test("ci.yml runs each lane on the plan's decision, from one browser job whose matrix the plan computes", async () => {
    const { REUSABLE: rules, LANES: lanes } = await import('../ci/lane-evidence.mjs');
    assert.deepEqual(Object.keys(rules).sort(), [...REUSABLE].sort());
    const { workflow, job } = workflowJobs('ci.yml');
    // the two settings, each in one place
    assert.equal(workflow.match(/^ {4}CHROMIUM_SHARDS: '6'$/gm)?.length, 1, 'CHROMIUM_SHARDS starts at 6, set once');
    assert.equal(workflow.match(/^ {4}ENGINES_ON: daily$/gm)?.length, 1, 'ENGINES_ON is the one switch back');
    assert.match(workflow, /^ {12}engines:\n {16}description: .+\n {16}type: boolean\n {16}default: false$/m, 'a manual run can ask for the engines');
    for (const id of ['php', 'prod-image', 'lint-kit', 'static-site', 'fresh-install', 'package']) {
        assert.ok(job(id).if.includes(`needs.changes.outputs.${id} == 'run'`), `${id}: ${job(id).if}`);
    }
    // Contrast and Workflows are steps of Quick checks, on the same outputs (its own test)
    assert.equal(job('php').name, rules.php.name);
    assert.equal(job('prod-image').name, rules['prod-image'].name);
    for (const id of [...lanes, 'engines', 'browsers', 'browser-matrix', 'importmap']) {
        assert.match(workflow, new RegExp(`^ {12}${id}: \\$\\{\\{ steps\\.plan\\.outputs\\.${id} \\}\\}$`, 'm'), `Changes outputs ${id} from the plan`);
    }
    assert.doesNotMatch(workflow, /needs\.changes\.outputs\.[a-z-]+ == 'true'/, 'no job runs on the old true/false outputs');
    const plan = job('changes').text;
    assert.match(plan, /--engines-on "\$ENGINES_ON"/);
    assert.match(plan, /--chromium-shards "\$CHROMIUM_SHARDS"/);
    assert.match(plan, /--engines "\$ENGINES"/);
    assert.match(plan, /--event "\$PLAN_EVENT"/);

    // the browser job: one definition, both lanes, the same check names as before
    const demo = job('demo');
    assert.equal(demo.name, 'Demo + Playwright (${{ matrix.browser }} ${{ matrix.shard }}/${{ matrix.shards }})');
    assert.equal(demo.if, "needs.changes.outputs.browsers == 'run'");
    assert.match(demo.text, /^ {12}matrix: \$\{\{ fromJSON\(needs\.changes\.outputs\.browser-matrix\) \}\}$/m);
    assert.doesNotMatch(demo.text, /browser: \[chromium/, 'no fixed browser list');
    assert.equal(rules.demo.prefix, 'Demo + Playwright (chromium ');
    assert.deepEqual(rules.engines.prefixes ?? [rules.engines.prefix], ['Demo + Playwright (firefox ', 'Demo + Playwright (webkit ']);
    assert.equal(rules.engines.count, 6);
    assert.equal(job('demo-engines'), undefined, 'no second copy of the browser job');
    assert.ok(job('importmap').if.includes("needs.changes.outputs.importmap == 'run'"));
    assert.ok(job('docker-install').if.includes("needs.changes.outputs.fresh-install == 'run'"));
    assert.match(job('cache').if, /needs\.changes\.outputs\.demo == 'run' \|\| needs\.changes\.outputs\.demo == 'reuse'/);

    // CI result: the required name, every lane's jobs, the plan by name, record and verdict by the tool
    const result = job('result');
    assert.equal(evaluate(result.name, push), 'CI result', 'the rulesets require this exact name, from the push');
    // the engines run in the browser job (`demo`); Contrast, Workflows and Tool tests in Quick checks (`quick`)
    for (const id of [...lanes.filter((id) => !['engines', 'contrast', 'workflows'].includes(id)), 'docker-install', 'importmap', 'quick', 'changes']) assert.ok(result.needs.includes(id), `CI result needs ${id}`);
    assert.match(result.text, /name: \$\{\{ needs\.changes\.outputs\.lane-plan \}\}/);
    assert.match(job('changes').text, /lane-plan: \$\{\{ steps\.plan\.outputs\.artifact \}\}/);
    assert.match(result.text, /set -o pipefail[\s\S]*lane-evidence\.mjs" finish/);
    assert.match(result.text, /lane-evidence\.mjs" finish[\s\S]{0,400}--jobs "\$RUNNER_TEMP\/run-jobs\.json"/, 'the verdict reads the browser lanes from the jobs');
    const steps = result.text.split(/\n(?= {12}- )/);
    for (const id of Object.keys(rules)) {
        for (const kind of ['pass', 'fail']) {
            const step = steps.find((s) => s.includes(`steps.finish.outputs.${id}-kind == '${kind}'`));
            assert.ok(step, `${id}: an upload step for its ${kind} marker`);
            assert.match(step, /overwrite: true/);
            assert.match(step, new RegExp(`name: \\$\\{\\{ steps\\.finish\\.outputs\\.${id}-marker \\}\\}`));
            if (kind === 'fail') assert.doesNotMatch(step, /continue-on-error/);
        }
    }
    assert.doesNotMatch(steps.find((s) => s.includes('id: finish')), /continue-on-error/);

    // the daily engines issue, after the release checks' pattern
    const issue = job('engines-issue');
    assert.ok(issue, 'an Engines issue job');
    assert.match(issue.if, /inputs\.daily/);
    assert.match(issue.if, /refs\/heads\/dev/);
    assert.match(issue.text, /issues: write/);
    assert.match(issue.text, /--label engines/);
    assert.match(issue.text, /gh issue close/);
    assert.match(issue.text, /gh issue comment/);
    assert.match(issue.text, /gh issue create/);
    assert.match(issue.text, /needs\.result\.outputs\.engines-report/);
});

test('Release checks requires an engines pass for the release head, and starts one when there is none', () => {
    const { workflow, job } = workflowJobs('release-checks.yml');
    assert.match(workflow, /pull_request:\n {8}branches: \[main\]\n {8}types: \[opened, synchronize, reopened, ready_for_review\]/);
    const changed = job('changed');
    assert.doesNotMatch(changed.text, /actions: write/, 'the job that runs the pull request\'s code holds no write token');
    assert.match(changed.text, /lane-evidence\.mjs"? require --lane engines/);
    const start = job('start-engines');
    assert.match(start.text, /actions: write/);
    assert.doesNotMatch(start.text, /actions\/checkout/, 'the token that may start a workflow never runs checked-out code');
    assert.match(start.text, /gh workflow run ci\.yml --repo "\$REPO" --ref "\$BRANCH" -f engines_only=true/);
    assert.match(changed.text, /engines: \$\{\{ steps\.engines\.outputs\.engines \}\}/);
    const verdict = job('verdict');
    assert.match(verdict.text, /ENGINES: \$\{\{ needs\.changed\.outputs\.engines \}\}/);
    assert.match(verdict.needs, /start-engines/);
    assert.match(verdict.text, /no Firefox\/WebKit pass for/);
    assert.match(verdict.text, /re-run Release checks when it passes/);
});

// job 3's review: the release gate, the engines dispatch, the daily report ------------------------------------------------

// the scalar/boolean subset of GitHub expressions these workflows use; unknown syntax fails closed
function evaluate(expression, context) {
    const body = expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
        .replace(/\b(github|inputs|needs|vars)\.[A-Za-z0-9_.-]+/g, (path) => JSON.stringify(path.split('.').reduce((value, part) => value?.[part], context) ?? ''))
        .replace(/\bstartsWith\(([^,]+),\s*('[^']*')\)/g, '(String($1).startsWith($2))')
        .replace(/\bformat\('([^']*)',\s*([^)]+)\)/g, (_, template, arg) => `(${JSON.stringify(template)}.replace('{0}', ${arg}))`);
    const operators = body.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\b(?:true|false|[0-9]+|String|startsWith|replace)\b/g, '');
    assert.match(operators, /^[\s!<>=&|().,-]*$/, `unsupported expression ${expression}`);
    return Function(`return (${body});`)();
}
const key = (text, name) => text.match(new RegExp(`^ *${name}: (.+)$`, 'm'))?.[1].replace(/^"(.*)"$/, '$1');
const push = { github: { event_name: 'push', ref: 'refs/heads/feature' }, inputs: {} };
const daily = { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/dev' }, inputs: { daily: true } };
const enginesOnly = { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }, inputs: { engines_only: true } };
const manual = { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }, inputs: {} };

test("only a push or a full manual run publishes CI result; the daily and an engines-only run publish under their own names", () => {
    const { workflow, job } = workflowJobs('ci.yml');
    const name = job('result').name;
    assert.equal(evaluate(name, push), 'CI result');
    assert.equal(evaluate(name, manual), 'CI result', 'a manual run runs everything: its result is a full one');
    assert.equal(evaluate(name, daily), 'CI result (daily)', 'the daily run checks the installs and engines only');
    assert.equal(evaluate(name, { ...daily, github: { ...daily.github, ref: 'refs/heads/feature' } }), 'CI result', 'daily off dev runs everything');
    assert.equal(evaluate(name, enginesOnly), 'CI result (engines only)');
    // an engines-only run: its own concurrency group, never cancelling (nor cancelled by) a push run, and a name to find it by
    const group = workflow.match(/^concurrency:\n(?: {4}#.*\n)* {4}group: (.+)\n {4}cancel-in-progress: (.+)$/m);
    assert.ok(group, 'the workflow concurrency');
    assert.equal(evaluate(group[1], push), 'ci-refs/heads/feature');
    assert.equal(evaluate(group[1], enginesOnly), 'ci-engines-refs/heads/feature');
    assert.equal(evaluate(group[2], push), true);
    assert.equal(evaluate(group[2], enginesOnly), false);
    assert.equal(evaluate(key(workflow, 'run-name'), enginesOnly), 'CI: Firefox and WebKit only');
    assert.match(workflow, /^ {12}engines_only:\n {16}description: .+\n {16}type: boolean\n {16}default: false$/m);
});

test('an engines-only run selects the engines lane alone', (t) => {
    const fx = scratch(t);
    const { workflow } = workflowJobs('ci.yml');
    const step = stepIn(workflow, 'changes', 'jobs');
    const output = join(fx.dir, 'out');
    writeFileSync(output, '');
    const temp = join(fx.dir, 'temp');
    mkdirSync(temp);
    const out = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], { cwd: fx.repo, encoding: 'utf8',
        env: { PATH: process.env.PATH, RUNNER_TEMP: temp, GITHUB_OUTPUT: output, EVENT: 'workflow_dispatch', REF: 'refs/heads/feature', ENGINES_ONLY: 'true', DAILY: 'false' } });
    assert.equal(out.status, 0, out.stderr);
    const lanes = Object.fromEntries(readFileSync(join(temp, 'jobs'), 'utf8').trim().split('\n').map((line) => line.split('=')));
    assert.equal(lanes.engines, 'true');
    for (const lane of LANES) assert.equal(lanes[lane], 'false', lane);
    const plan = enginesPlan(fx, {}, { event: 'engines', lanes: [], extra: 'engines=true\n' });
    assert.equal(plan.outputs.engines, 'run');
    assert.deepEqual([...new Set(plan.matrix.include.map((e) => e.browser))], ['firefox', 'webkit']);
    assert.equal(plan.outputs.importmap, 'run');
    const fp = fingerprints(fx, fx.head()).lanes;
    assert.equal(enginesPlan(fx, engineRoutes(fx, fx.head(), fp.engines), { event: 'engines', lanes: [], extra: 'engines=true\n' }).outputs.browsers, 'skip', 'already passed: nothing to run');
});

test('with every push the engines reuse a pass on the same inputs', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    assert.equal(enginesPlan(fx, engineRoutes(fx, fx.head(), fp.engines), { enginesOn: 'every-push' }).outputs.engines, 'reuse');
});

test('the verdict needs no job list when the browser job did not run', (t) => {
    const { verdict } = verdictFixture(t);
    const out = verdict({ demo: 'skipped' }, undefined, [], null);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.json.lanes.engines.status, 'not_run_at_this_stage');
    assert.equal(out.json.lanes.demo.status, 'reused');
    const skipped = verdictFixture(t, { engines: lane('skip', null) });
    assert.equal(skipped.verdict({ demo: 'skipped' }, undefined, [], null).json.lanes.engines.status, 'not_applicable');
    assert.equal(verdict({ demo: 'success' }, undefined, [], null).json.lanes.engines.status, 'incomplete', 'it ran: without the list the lanes cannot be told apart');
});

function dailyRoutes(fx, routes, { found = true, apiDown = false } = {}) {
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

test('a red daily run names, without subjects, the commits since the last all-browser pass found by its marker', (t) => {
    const { fx, routes, verdict } = verdictFixture(t, { engines: lane('run', 'f'.repeat(64)), event: 'daily' });
    const failedJobs = engineJobs().map((job, i) => (i === 0 ? { ...job, conclusion: 'failure' } : job));
    const red = verdict({ demo: 'failure' }, dailyRoutes(fx, routes), [], failedJobs);
    assert.equal(red.status, 1);
    assert.match(red.outputs, /^engines-status=failed$/m);
    const report = red.outputs.match(/^engines-report=(.*)$/m)[1];
    assert.match(report, /^Firefox\/WebKit failed on dev at /);
    assert.match(report, new RegExp(`last all-browser pass ${'a'.repeat(12)}`), 'the newest pass in dev\'s history, not the newer one on another branch');
    assert.match(report, /2 commits: 1234567, abcdef0/);
    assert.match(report, /compare\/a{40}\.\.\./);
    for (const text of [report, red.summary, red.stderr]) {
        assert.doesNotMatch(text, /keyboard wrap|focus return|@someone|#12/, 'no commit subject reaches GitHub text');
    }
    const none = verdict({ demo: 'failure' }, dailyRoutes(fx, routes, { found: false }), [], failedJobs);
    assert.match(none.outputs, /^engines-report=.*no engines pass marker exists.*expected right after/m);
    const down = verdict({ demo: 'failure' }, dailyRoutes(fx, routes, { apiDown: true }), [], failedJobs);
    assert.match(down.outputs, /^engines-report=.*could not be looked up/m);
    assert.doesNotMatch(down.outputs, /no engines pass marker exists/, 'an API failure is not reported as no pass');
});

test('the daily run tells a failure from an incomplete run, and reports a reuse too', (t) => {
    const { fx, routes, verdict } = verdictFixture(t, { engines: lane('run', 'f'.repeat(64)), event: 'daily' });
    const cancelled = engineJobs().map((job, i) => (i === 0 ? { ...job, conclusion: 'cancelled' } : job));
    for (const [name, jobs] of [['a cancelled shard', cancelled], ['a short matrix', engineJobs().slice(1)]]) {
        const out = verdict({ demo: 'failure' }, dailyRoutes(fx, routes), [], jobs);
        assert.equal(out.status, 1, name);
        assert.match(out.outputs, /^engines-status=incomplete$/m, name);
        assert.match(out.outputs, /^engines-report=The Firefox\/WebKit run on dev did not complete/m, name);
        assert.doesNotMatch(out.outputs, /engines-report=.*failed on dev/, `${name}: never said to have failed`);
    }
    // a daily that reuses a pass on dev's inputs closes the issue; one whose reused pass no longer qualifies says so
    const fpEngines = fingerprints(fx, fx.head()).lanes.engines;
    const reusedRoutes = engineRoutes(fx, fx.head(), fpEngines);
    const evidence = { artifact_id: 9501, artifact_name: `ci-pass-v1-engines-${fpEngines}`, run_id: 75, run_attempt: 1, head_sha: fx.head(), url: 'https://github.com/example/project/actions/runs/75', jobs: brief(engineJobs()), flaky: 0 };
    const reused = verdictFixture(t, { engines: { ...lane('reuse', fpEngines), evidence }, event: 'daily' });
    const passed = reused.verdict({ demo: 'skipped' }, { ...reused.routes, ...reusedRoutes }, [], null);
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.outputs, /^engines-status=passed$/m);
    assert.match(passed.outputs, /^engines-report=Firefox and WebKit already passed on these inputs.*actions\/runs\/75/m);
    const stale = reused.verdict({ demo: 'skipped' }, reused.routes, [], null);
    assert.equal(stale.status, 1);
    assert.match(stale.outputs, /^engines-status=incomplete$/m);
    assert.match(stale.outputs, /^engines-report=.*no longer qualifies/m);
});

// the workflows' shell steps, run with a stub gh that logs its calls

function stubGh(fx, script) {
    const bin = join(fx.dir, 'shbin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> "${join(fx.dir, 'gh-calls')}"\n${script}\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    writeFileSync(join(fx.dir, 'gh-calls'), '');
    return bin;
}
const ghCalls = (fx) => readFileSync(join(fx.dir, 'gh-calls'), 'utf8');

test('the Engines issue job closes on a pass, comments or opens on a failure or an incomplete run', (t) => {
    const fx = scratch(t);
    const { workflow } = workflowJobs('ci.yml');
    const step = stepIn(workflow, 'engines-issue', 'issue');
    for (const [status, open, expected, unexpected] of [
        ['passed', '7', /^issue close 7 /m, /issue (create|comment)/],
        ['passed', '', /^issue list /m, /issue (close|create|comment)/],
        ['failed', '', /^issue create .*--label engines/m, /issue close/],
        ['incomplete', '7', /^issue comment 7 .*did not complete/m, /issue close/],
    ]) {
        const bin = stubGh(fx, `if [ "$1 $2" = "issue list" ]; then echo "${open}"; fi`);
        const report = status === 'incomplete' ? 'The Firefox/WebKit run on dev did not complete: cancelled' : 'Firefox/WebKit failed on dev at abc';
        const out = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], { encoding: 'utf8',
            env: { PATH: `${bin}:${process.env.PATH}`, REPO, STATUS: status, REPORT: report, RUN_URL: 'https://github.com/example/project/actions/runs/9' } });
        assert.equal(out.status, 0, out.stderr);
        assert.match(ghCalls(fx), expected, `${status}/${open || 'none open'}: ${ghCalls(fx)}`);
        assert.doesNotMatch(ghCalls(fx), unexpected, `${status}/${open || 'none open'}`);
    }
});

test('Start the engines dispatches an engines-only run on the head branch, unless one for that head is queued or running', (t) => {
    const fx = scratch(t);
    const { workflow } = workflowJobs('release-checks.yml');
    const step = stepIn(workflow, 'start-engines', 'start');
    const env = (bin) => ({ PATH: `${bin}:${process.env.PATH}`, REPO, BRANCH: 'release-0.4', HEAD: 'd'.repeat(40), GITHUB_OUTPUT: join(fx.dir, 'start-out') });
    for (const [queued, dispatched] of [['0', true], ['1', false]]) {
        writeFileSync(join(fx.dir, 'start-out'), '');
        const bin = stubGh(fx, `case "$1 $2" in "api "*) echo ${queued} ;; esac`);
        const out = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], { encoding: 'utf8', env: env(bin) });
        assert.equal(out.status, 0, out.stderr);
        const calls = ghCalls(fx);
        assert.match(calls, new RegExp(`head_sha=${'d'.repeat(40)}`), 'it looks for a run on this head');
        assert.equal(/^workflow run ci\.yml --repo example\/project --ref release-0\.4 -f engines_only=true$/m.test(calls), dispatched, calls);
        assert.match(readFileSync(join(fx.dir, 'start-out'), 'utf8'), dispatched ? /^started=dispatched$/m : /^started=running$/m);
    }
    const { job } = workflowJobs('release-checks.yml');
    const condition = job('start-engines').if;
    for (const [engines, runs] of [['pass', false], ['tree: the merge tests another tree', false], ['missing: engines: no_evidence', true]]) {
        assert.equal(Boolean(evaluate(condition, { github: { event_name: 'pull_request' }, needs: { changed: { result: 'success', outputs: { engines } } } })), runs, engines);
    }
    assert.match(job('start-engines').text, /BRANCH: \$\{\{ github\.head_ref \}\}/);
    assert.match(job('start-engines').text, /HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
});

test("What to check's engines step: pass, missing or another tree, from the merge commit's parents", (t) => {
    const fx = scratch(t);
    const { workflow } = workflowJobs('release-checks.yml');
    const step = stepIn(workflow, 'changed', 'engines');
    mkdirSync(join(fx.repo, 'tools', 'ci'), { recursive: true });
    writeFileSync(join(fx.repo, 'tools', 'ci', 'lane-evidence.mjs'), readFileSync(tool));
    fx.git('add', '-A');
    fx.git('commit', '-qm', 'the tool');
    const base = fx.head();
    fx.git('checkout', '-qb', 'release');
    const head = fx.commit('kit.css', 'a {}\n');
    fx.git('checkout', '-q', '-');
    fx.git('merge', '-q', '--no-ff', '--no-edit', 'release');
    const merge = fx.head();
    const fp = fingerprints(fx, head).lanes.engines;
    const runStep = (sha, routes) => {
        writeFileSync(join(fx.dir, 'routes.json'), JSON.stringify(routes));
        writeFileSync(join(fx.dir, 'gh-api.log'), '');
        const output = join(fx.dir, 'changed-out');
        writeFileSync(output, '');
        const out = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], { cwd: fx.repo, encoding: 'utf8',
            env: { PATH: `${fx.bin}:${process.env.PATH}`, REPO, GITHUB_SHA: sha, GITHUB_OUTPUT: output, FAKE_GH_ROUTES: join(fx.dir, 'routes.json'), FAKE_GH_LOG: join(fx.dir, 'gh-api.log') } });
        assert.equal(out.status, 0, out.stderr);
        return readFileSync(output, 'utf8');
    };
    assert.match(runStep(merge, {}), /^engines=missing: engines: no_evidence/m);
    assert.match(runStep(merge, engineRoutes(fx, head, fp)), /^engines=pass$/m);
    assert.doesNotMatch(readFileSync(join(fx.dir, 'gh-api.log'), 'utf8'), /workflow/, 'this step never starts a workflow');
    // main moved on: the merge tests another tree than the head, which no pass on the head can stand for
    fx.git('checkout', '-q', base);
    fx.git('checkout', '-qb', 'main2');
    fx.commit('README.md', 'main moved\n');
    fx.git('merge', '-q', '--no-ff', '--no-edit', 'release');
    assert.match(runStep(fx.head(), engineRoutes(fx, head, fp)), /^engines=tree: /m);
});

test('only the release pull request publishes Release checks, and its verdict says what to do', (t) => {
    const { job } = workflowJobs('release-checks.yml');
    const name = job('verdict').name;
    assert.equal(evaluate(name, { github: { event_name: 'pull_request' }, inputs: {} }), 'Release checks');
    assert.equal(evaluate(name, { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/dev' }, inputs: { daily: true } }), 'Release checks (daily)');
    assert.equal(evaluate(name, { github: { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }, inputs: {} }), 'Release checks (manual)');
    const verdict = stepIn(workflowJobs('release-checks.yml').workflow, 'verdict', 'decide');
    const fx = scratch(t);
    const run = (env) => spawnSync('bash', ['-eo', 'pipefail', '-c', verdict.run], { encoding: 'utf8',
        env: { PATH: process.env.PATH, EVENT: 'pull_request', CHANGED: 'success', RUN: 'false', SUITE: 'skipped', COMPLETE: 'skipped', PROD_IMAGE: 'skipped', START: '', BRANCH: 'release-0.4', ...env } });
    const tree = run({ ENGINES: 'tree: the merge tests another tree than the head abc' });
    assert.equal(tree.status, 1);
    assert.match(tree.stdout + tree.stderr, /[Bb]ring main into release-0\.4/);
    assert.doesNotMatch(tree.stdout + tree.stderr, /re-run Release checks when it passes/, 'no run can satisfy it: no promise of one');
    const running = run({ ENGINES: 'missing: engines: no_evidence', START: 'running' });
    assert.match(running.stdout + running.stderr, /a Firefox\/WebKit run for this head is already queued or running/);
    void fx;
});

test('the browser shards plan from timings that include the engines\' latest run', () => {
    const { job } = workflowJobs('ci.yml');
    const timings = job('changes').text.slice(job('changes').text.indexOf('name: Shard timings'));
    assert.match(timings, /runs\?branch=dev&status=success&per_page=/);
    assert.doesNotMatch(timings.slice(0, timings.indexOf('upload-artifact')), /event=push/, 'not only push runs: the daily and engines-only runs refresh Firefox and WebKit');
});

// job 4: the installs, Lint kit and Package reusable for a day; CI result's own cost ----------------------------------------

const installJobs = (base = 1100) => [
    { id: base, name: 'Fresh install', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' },
    { id: base + 1, name: 'Fresh install (Symfony Docker, from GitHub)', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' },
];
const lintJobs = (base = 1200) => ['locked', 'minimum'].map((t, i) => ({ id: base + i, name: `Lint kit (${t} toolkit)`, conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' }));
const packageJobs = (base = 1300) => [{ id: base, name: 'Package', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T12:00:00Z' }];

test('the lanes that resolve live dependencies are reusable for 24 hours, the others for 14 days: one table', async (t) => {
    const { MAX_AGE_HOURS } = await import('../ci/lane-evidence.mjs');
    assert.deepEqual(MAX_AGE_HOURS, { default: 14 * 24, 'fresh-install': 24, 'lint-kit': 24, package: 24 });
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    for (const [lane, jobs] of [['fresh-install', installJobs()], ['lint-kit', lintJobs()], ['package', packageJobs()]]) {
        const routes = (created) => routesFor(lane, fp[lane], [marker(fx, { lane, sha: fx.head(), fp: fp[lane], jobs, created, artifactId: 9700, runId: 77 })]);
        const fresh = plan(fx, routes('2026-11-15T13:00:00Z'), [lane]);
        assert.equal(fresh.outputs[lane], 'reuse', `${lane}, 23 hours old: ${fresh.plan.lanes[lane].detail}`);
        const stale = plan(fx, routes('2026-11-15T11:00:00Z'), [lane]);
        assert.equal(stale.outputs[lane], 'run', `${lane}, 25 hours old`);
        assert.equal(stale.plan.lanes[lane].reason, 'evidence_too_old');
    }
    // the browser tests keep their 14 days
    assert.equal(plan(fx, producer(fx, fx.head(), fp.demo, { created: '2026-11-10T12:00:00Z' })).outputs.demo, 'reuse');
});

test("dev's daily run never reuses a 24-hour lane: it is the check of today's dependency resolution", (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const routes = { ...routesFor('fresh-install', fp['fresh-install'], [marker(fx, { lane: 'fresh-install', sha: fx.head(), fp: fp['fresh-install'], jobs: installJobs(), artifactId: 9701, runId: 78 })]),
        ...routesFor('package', fp.package, [marker(fx, { lane: 'package', sha: fx.head(), fp: fp.package, jobs: packageJobs(), artifactId: 9702, runId: 79 })]) };
    const daily = enginesPlan(fx, routes, { event: 'daily', ref: 'refs/heads/dev', lanes: ['fresh-install', 'package'] });
    for (const lane of ['fresh-install', 'package']) {
        assert.equal(daily.outputs[lane], 'run', lane);
        assert.equal(daily.plan.lanes[lane].reason, 'daily_fresh', lane);
        assert.equal(daily.plan.lanes[lane].fingerprint, fp[lane], `${lane}: fingerprinted, so the daily's pass serves the day's pushes`);
    }
    assert.equal(enginesPlan(fx, routes, { lanes: ['fresh-install', 'package'] }).outputs['fresh-install'], 'reuse', 'a push the same day reuses it');
});

test('CI result records and judges the installs, Lint kit and Package as lanes of their jobs', (t) => {
    const fx = scratch(t);
    const lanes = { 'fresh-install': lane('run', '1'.repeat(64)), 'lint-kit': lane('run', '2'.repeat(64)), package: lane('run', '3'.repeat(64)), demo: lane('skip'), php: lane('skip'), 'prod-image': lane('skip'), engines: lane('skip') };
    const failedLint = lintJobs().map((job, i) => (i === 1 ? { ...job, conclusion: 'failure' } : job));
    const { markers } = recorded(fx, lanes, [...installJobs(), ...failedLint, ...packageJobs()], { needs: { 'lint-kit': { result: 'failure' } } });
    assert.deepEqual(markers, [`ci-fail-v1-lint-kit-${'2'.repeat(64)}`, `ci-pass-v1-fresh-install-${'1'.repeat(64)}`, `ci-pass-v1-package-${'3'.repeat(64)}`]);
    const half = recorded(fx, lanes, [installJobs()[0], ...lintJobs(), ...packageJobs()]);
    assert.ok(!half.markers.some((m) => m.includes('fresh-install')), 'one of the two installs is no pass');
});

test('the tool refuses a Node older than 20, with a clear message', async () => {
    const { nodeProblem } = await import('../ci/lane-evidence.mjs');
    assert.match(nodeProblem('18.19.1'), /Node 20 or later/);
    assert.equal(nodeProblem('20.0.0'), null);
    assert.equal(nodeProblem('22.11.0'), null);
    const old = spawnSync('/usr/bin/node', ['--version'], { encoding: 'utf8' });
    if (old.status === 0 && Number(old.stdout.slice(1).split('.')[0]) < 20) {
        const out = spawnSync('/usr/bin/node', [tool, 'fingerprint', '--sha', 'HEAD'], { encoding: 'utf8' });
        assert.equal(out.status, 2, out.stderr);
        assert.match(out.stderr, /Node 20 or later/);
    }
});

test('finish records the markers and gives the verdict in one run, failing on either', (t) => {
    const { fx, verdict: _unused } = verdictFixture(t);
    void _unused;
    const planFile = join(fx.dir, 'plan.json');
    const plan = JSON.parse(readFileSync(planFile, 'utf8'));
    plan.lanes.php = lane('run', 'e'.repeat(64));
    writeFileSync(planFile, JSON.stringify(plan));
    const needsFile = join(fx.dir, 'finish-needs.json');
    const jobsFile = join(fx.dir, 'finish-jobs.json');
    const finish = (phpResult, jobs) => {
        const results = { changes: 'success', tools: 'success', importmap: 'success', 'lint-kit': 'skipped', php: phpResult, 'static-site': 'skipped', 'fresh-install': 'skipped', 'docker-install': 'skipped', package: 'skipped', contrast: 'success', workflows: 'skipped', demo: 'skipped', 'prod-image': 'skipped' };
        writeFileSync(needsFile, JSON.stringify(Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result }]))));
        writeFileSync(jobsFile, JSON.stringify(jobs));
        const github = join(fx.dir, 'finish-output');
        writeFileSync(github, '');
        const out = join(fx.dir, 'finish-markers');
        rmSync(out, { recursive: true, force: true });
        const result = run(fx, ['finish', '--plan', planFile, '--needs', needsFile, '--jobs', jobsFile, '--repo', REPO, '--run-id', '88', '--run-attempt', '1', '--out', out, '--github-output', github, '--summary', join(fx.dir, 'finish-summary.md')],
            producer(fx, fx.head(), plan.lanes.demo.fingerprint));
        return { result, output: readFileSync(github, 'utf8'), markers: existsSync(out) ? readdirSync(out) : [] };
    };
    const green = finish('success', [{ id: 600, name: 'Kit PHP', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-16T11:00:00Z' }]);
    assert.equal(green.result.status, 0, green.result.stderr);
    assert.deepEqual(green.markers, [`ci-pass-v1-php-${'e'.repeat(64)}`]);
    assert.match(green.output, /^php-kind=pass$/m);
    assert.match(green.output, /^engines-status=$/m, 'the verdict\'s outputs too');
    const red = finish('failure', [{ id: 600, name: 'Kit PHP', conclusion: 'failure', status: 'completed', run_attempt: 1 }]);
    assert.equal(red.result.status, 1);
    assert.deepEqual(red.markers, [`ci-fail-v1-php-${'e'.repeat(64)}`], 'the failure is recorded before the verdict fails');
    const lost = finish('failure', 'not json');
    assert.equal(lost.result.status, 1);
    assert.match(lost.result.stderr, /failure marker cannot be recorded/);
});

test('CI result runs without setup-node and finishes in one step; the advisory metrics are a job of their own that no ruleset requires', () => {
    const { workflow, job } = workflowJobs('ci.yml');
    const result = job('result');
    assert.doesNotMatch(result.text, /actions\/setup-node@/, 'the tool runs on the runner image\'s Node');
    assert.doesNotMatch(result.text.replace(/^\s*#.*$/gm, ''), /ci-metrics\.mjs|shard-plan\.mjs timings/, 'no advisory work before the required check finishes');
    assert.match(result.text, /lane-evidence\.mjs" finish/);
    assert.doesNotMatch(result.text, /lane-evidence\.mjs" (record|verdict)\b/);
    for (const id of ['php', 'demo', 'engines', 'prod-image', 'fresh-install', 'lint-kit', 'package']) {
        for (const kind of ['pass', 'fail']) {
            const step = result.text.split(/\n(?= {12}- )/).find((s) => s.includes(`steps.finish.outputs.${id}-kind == '${kind}'`));
            assert.ok(step, `${id}: an upload for its ${kind} marker`);
            assert.match(step, /overwrite: true/);
            if (kind === 'fail') assert.doesNotMatch(step, /continue-on-error/);
        }
    }
    const metrics = job('metrics');
    assert.ok(metrics, 'a metrics job');
    assert.equal(metrics.name, 'CI metrics');
    assert.match(metrics.needs, /result/);
    assert.match(metrics.if, /always\(\)/);
    assert.match(metrics.text, /^ {8}continue-on-error: true$/m, 'its failure never fails the run (release.yml and the dev lookups read the run\'s conclusion)');
    assert.match(metrics.text, /ci-metrics\.mjs run/);
    assert.match(metrics.text, /shard-plan\.mjs timings/);
    assert.match(metrics.text, /select\(\.name != "CI metrics"\)/, 'it leaves itself out of the run\'s job list');
    assert.match(metrics.text, /name: ci-metrics-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/, 'the artifact the next run plans its shards from keeps its name');
    assert.doesNotMatch(job('result').needs, /metrics/);
    assert.ok(!['CI result', 'Release checks', 'Mentions', 'CodeQL'].includes(metrics.name));
    void workflow;
});

// job 6: Tool tests, Contrast and Workflows as the steps of one job, Quick checks -------------------------------------------

test('Quick checks is one job for Tool tests, Contrast and Workflows, each check running whatever another did', () => {
    const { job } = workflowJobs('ci.yml');
    for (const id of ['tools', 'contrast', 'workflows']) assert.equal(job(id), undefined, `no ${id} job of its own`);
    const quick = job('quick');
    assert.ok(quick, 'a quick job');
    assert.equal(quick.name, 'Quick checks');
    assert.equal(quick.needs, 'changes');
    assert.match(quick.if, /github\.event_name != 'schedule'/);
    assert.match(quick.text, /fetch-depth: 0/);
    assert.equal(quick.text.match(/actions\/setup-node@/g)?.length, 1, 'one Node setup');
    assert.equal(quick.text.match(/shivammathur\/setup-php@/g)?.length, 1, 'one PHP setup');
    const steps = quick.text.split(/\n(?= {12}- )/).slice(1);
    const checks = steps.filter((s) => /^\s+id: (tools|contrast|workflows)-/m.test(s));
    assert.ok(checks.length >= 17, `every check is a step with a lane-prefixed id (${checks.length})`);
    for (const step of checks) {
        const id = step.match(/id: (\S+)/)[1];
        assert.match(step, /if: \$\{\{ !cancelled\(\)/, `${id}: runs after another check failed`);
        if (id.startsWith('contrast-')) assert.match(step, /needs\.changes\.outputs\.contrast == 'run'/, `${id}: only when Contrast is selected`);
        if (id.startsWith('workflows-')) assert.match(step, /needs\.changes\.outputs\.workflows == 'run'/, `${id}: only when Workflows is selected`);
        if (id.startsWith('tools-')) assert.doesNotMatch(step, /needs\.changes\.outputs/, `${id}: Tool tests runs on every run`);
    }
    for (const lane of ['tools', 'contrast', 'workflows']) assert.match(quick.text, new RegExp(`^ {12}${lane}: \\$\\{\\{ steps\\.summary\\.outputs\\.${lane} \\}\\}$`, 'm'), `the job's ${lane} outcome`);
    const result = job('result');
    assert.match(result.needs, /\bquick\b/);
    assert.doesNotMatch(result.needs, /\b(tools|contrast|workflows)\b/);
});

test("Quick checks' summary names each check's outcome and fails when a selected one did not pass", (t) => {
    const fx = scratch(t);
    const { workflow } = workflowJobs('ci.yml');
    const step = stepIn(workflow, 'quick', 'summary');
    const run = (steps, selected) => {
        const output = join(fx.dir, 'quick-out');
        const summary = join(fx.dir, 'quick-summary');
        writeFileSync(output, '');
        writeFileSync(summary, '');
        const out = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], { encoding: 'utf8',
            env: { PATH: process.env.PATH, STEPS: JSON.stringify(steps), CONTRAST: selected.contrast, WORKFLOWS: selected.workflows, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary } });
        return { ...out, outputs: Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('='))), summary: readFileSync(summary, 'utf8') };
    };
    const s = (outcome) => ({ outcome, conclusion: outcome, outputs: {} });
    const steps = { 'tools-cases': s('success'), 'tools-policy': s('success'), 'contrast-tokens': s('failure'), 'contrast-docs-lint': s('success'), 'workflows-actionlint': s('skipped') };
    const red = run(steps, { contrast: 'run', workflows: 'skip' });
    assert.equal(red.status, 1, 'a failed check fails the job');
    assert.deepEqual(red.outputs, { tools: 'success', contrast: 'failure', workflows: 'skipped' });
    assert.match(red.summary, /Contrast \| failure \| contrast-tokens/);
    assert.match(red.summary, /Tool tests \| success/);
    assert.match(red.stdout + red.stderr, /::error::Contrast: contrast-tokens failed/);
    const green = run({ ...steps, 'contrast-tokens': s('success') }, { contrast: 'run', workflows: 'skip' });
    assert.equal(green.status, 0, green.stderr);
    assert.deepEqual(green.outputs, { tools: 'success', contrast: 'success', workflows: 'skipped' });
    // a selected check that did not run (cancelled, or skipped by an error) is no pass
    const skipped = run({ ...steps, 'contrast-tokens': s('skipped') }, { contrast: 'run', workflows: 'skip' });
    assert.equal(skipped.status, 1);
    assert.equal(skipped.outputs.contrast, 'incomplete');
});

test('the verdict reads Contrast, Workflows and Tool tests from Quick checks\' outputs', (t) => {
    const fx = scratch(t);
    const lanes = Object.fromEntries(LANES.map((name) => [name, lane('skip', null)]));
    lanes.contrast = lane('run', null, 'not_reusable');
    lanes.workflows = lane('skip', null);
    lanes.engines = lane('skip', null);
    const planFile = join(fx.dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ schema: 1, repo: REPO, sha: fx.head(), ref: 'refs/heads/feature', event: 'push', reuse: true, reuse_off: null, chromium_shards: 6, lanes }));
    const verdict = (quick) => {
        const results = { changes: 'success', importmap: 'skipped', 'lint-kit': 'skipped', php: 'skipped', 'static-site': 'skipped', 'fresh-install': 'skipped', 'docker-install': 'skipped', package: 'skipped', demo: 'skipped', 'prod-image': 'skipped' };
        const needs = { ...Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }])), quick };
        writeFileSync(join(fx.dir, 'needs.json'), JSON.stringify(needs));
        const out = run(fx, ['verdict', '--plan', planFile, '--needs', join(fx.dir, 'needs.json'), '--repo', REPO]);
        return { ...out, json: JSON.parse(out.stdout.split('\n').filter((l) => l.startsWith('{')).pop()) };
    };
    const green = verdict({ result: 'success', outputs: { tools: 'success', contrast: 'success', workflows: 'skipped' } });
    assert.equal(green.status, 0, green.stderr);
    assert.equal(green.json.lanes.contrast.status, 'fresh');
    assert.equal(green.json.lanes.workflows.status, 'not_applicable');
    const red = verdict({ result: 'failure', outputs: { tools: 'success', contrast: 'failure', workflows: 'skipped' } });
    assert.equal(red.status, 1);
    assert.equal(red.json.lanes.contrast.status, 'incomplete');
    assert.equal(red.json.lanes.workflows.status, 'not_applicable', 'the other lane is not blamed');
    const tools = verdict({ result: 'failure', outputs: { tools: 'failure', contrast: 'success', workflows: 'skipped' } });
    assert.equal(tools.status, 1);
    assert.match(tools.stderr, /::error::tools ended with failure/);
    const cancelled = verdict({ result: 'cancelled', outputs: {} });
    assert.equal(cancelled.status, 1, 'a cancelled Quick checks is no pass');
    assert.equal(cancelled.json.lanes.contrast.status, 'incomplete');
});

// job 5: no work-order draft gate (the owner's decision) ---------------------------------------------------------------------

test("a push to a work order's root plans its lanes like any branch's, whatever its pull request's state", (t) => {
    const fx = scratch(t);
    const { workflow } = workflowJobs('ci.yml');
    const step = stepIn(workflow, 'changes', 'jobs');
    // dev at the base, with the selector; the branch changes the changelog only
    mkdirSync(join(fx.repo, 'tools'), { recursive: true });
    writeFileSync(join(fx.repo, 'tools', 'ci-changes.sh'), readFileSync(fileURLToPath(new URL('../ci-changes.sh', import.meta.url))));
    fx.git('add', '-A');
    fx.git('commit', '-qm', 'the selector');
    fx.git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
    fx.commit('CHANGELOG.md', '# Changelog\n\n- a line\n');
    const bin = stubGh(fx, `case "$*" in *pulls*) echo draft ;; *) echo '' ;; esac`);
    const plan = (branch) => {
        const temp = join(fx.dir, `temp-${branch.replace(/\W/g, '-')}`);
        mkdirSync(temp, { recursive: true });
        const output = join(temp, 'out');
        writeFileSync(output, '');
        // the step tees to /dev/stderr, which a socket (Node's default child stderr) cannot open: give it a file
        const errFile = join(temp, 'stderr');
        const err = openSync(errFile, 'w');
        const out = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], { cwd: fx.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', err],
            env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, GITHUB_OUTPUT: output, EVENT: 'push', REF: `refs/heads/${branch}`, REPO, GH_TOKEN: 'x', DAILY: '', ENGINES_ONLY: '' } });
        closeSync(err);
        assert.equal(out.status, 0, readFileSync(errFile, 'utf8'));
        return { jobs: readFileSync(join(temp, 'jobs'), 'utf8'), output: readFileSync(output, 'utf8') };
    };
    const root = plan('claude/wo-example');
    const branch = plan('feature/example');
    assert.equal(root.jobs, branch.jobs, 'the same lanes as any branch with the same change');
    assert.match(root.jobs, /^contrast=true$/m);
    assert.doesNotMatch(root.output, /wo-draft/);
    assert.doesNotMatch(ghCalls(fx), /pulls/, 'no question about the pull request');
});

test('CI result has no work-order draft path any more', (t) => {
    const { workflow, job } = workflowJobs('ci.yml');
    assert.doesNotMatch(workflow, /wo-draft|WO_DRAFT|work order draft/i);
    assert.doesNotMatch(job('changes').text, /pull-requests: read/, 'the Changes job no longer reads pull requests');
    const { verdict } = verdictFixture(t);
    const out = verdict({}, undefined, ['--wo-draft', 'true']);
    assert.equal(out.status, 0, 'the option is gone: nothing fails a run for being a draft');
    assert.doesNotMatch(out.summary, /draft/i);
});

// the stack's review (item numbers from it) ----------------------------------------------------------------------------------

test('each excluded file is tied to the lanes it is excluded for (6)', async () => {
    const { EXCLUDED_FOR, REUSABLE: rules } = await import('../ci/lane-evidence.mjs');
    const all = Object.keys(rules).sort();
    assert.deepEqual(Object.keys(EXCLUDED_FOR), EXCLUDED);
    for (const [file, lanes] of Object.entries(EXCLUDED_FOR)) {
        const expected = file === 'CHANGELOG.md' ? all.filter((lane) => lane !== 'package') : all;
        assert.deepEqual([...lanes].sort(), expected, `${file}: the lanes that never read its content`);
    }
});

test('the age of a pass is its lane jobs\' completion, not its marker\'s creation, checked against the API (1)', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes;
    const installs = [
        { id: 1100, name: 'Fresh install', conclusion: 'success', status: 'completed', run_attempt: 1 },
        { id: 1101, name: 'Fresh install (Symfony Docker, from GitHub)', conclusion: 'success', status: 'completed', run_attempt: 1 },
    ];
    // a marker made an hour ago (a re-run's CI result) for jobs that completed 30 hours ago: too old for a 24-hour lane
    const rerun = routesFor('fresh-install', fp['fresh-install'], [marker(fx, { lane: 'fresh-install', sha: fx.head(), fp: fp['fresh-install'], jobs: installs, artifactId: 9800, runId: 80, created: '2026-11-16T11:00:00Z', completedAt: '2026-11-15T06:00:00Z' })]);
    const old = plan(fx, rerun, ['fresh-install']);
    assert.equal(old.outputs['fresh-install'], 'run');
    assert.equal(old.plan.lanes['fresh-install'].reason, 'evidence_too_old');
    // the same for the 14-day lanes
    const stale = plan(fx, producer(fx, fx.head(), fp.demo, { created: '2026-11-16T11:00:00Z', completedAt: '2026-11-01T00:00:00Z' }));
    assert.equal(stale.plan.lanes.demo.reason, 'evidence_too_old');
    // a marker whose completion time disagrees with the jobs' is not believed
    const lying = plan(fx, producer(fx, fx.head(), fp.demo, { evidence: { completed_at: '2026-11-16T10:00:00Z' } }));
    assert.equal(lying.plan.lanes.demo.reason, 'marker_invalid');
    const fresh = plan(fx, producer(fx, fx.head(), fp.demo, { created: '2026-11-16T11:00:00Z', completedAt: '2026-11-16T10:00:00Z' }));
    assert.equal(fresh.outputs.demo, 'reuse');
});

test('a later attempt does not record again a lane whose jobs all ran in an earlier one (1)', (t) => {
    const fx = scratch(t);
    const lanes = { 'fresh-install': lane('run', '1'.repeat(64)), demo: lane('run', 'd'.repeat(64)), php: lane('skip'), 'prod-image': lane('skip'), engines: lane('skip') };
    const installs = [
        { id: 1100, name: 'Fresh install', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T06:00:00Z' },
        { id: 1101, name: 'Fresh install (Symfony Docker, from GitHub)', conclusion: 'success', status: 'completed', run_attempt: 1, completed_at: '2026-11-15T06:05:00Z' },
    ];
    // attempt 2 re-ran one browser shard: Chromium records again, its age the oldest shard's; the installs do not
    const shards = demoJobs().map((job, i) => (i === 0 ? { ...job, run_attempt: 2, completed_at: '2026-11-16T11:00:00Z' } : job));
    const { markers, read } = recorded(fx, lanes, [...installs, ...shards], { attempt: '2' });
    assert.deepEqual(markers, [`ci-pass-v1-demo-${'d'.repeat(64)}`]);
    assert.equal(read(markers[0]).completed_at, '2026-11-15T12:00:00Z', 'as old as its oldest job');
    // a pass whose jobs carry no completion time records nothing (its age could not be told)
    const unknown = recorded(fx, lanes, [...installs.map(({ completed_at, ...job }) => ({ ...job, run_attempt: 2 })), ...demoJobs(500, 2)], { attempt: '2' });
    assert.ok(!unknown.markers.some((m) => m.includes('fresh-install')));
});

test('a shard that ended before its tests started is incomplete, not failed: no marker, and the daily says so (4)', (t) => {
    const fx = scratch(t);
    const steps = (tests) => [{ name: 'Wait for the importmap packages', conclusion: tests === 'skipped' ? 'failure' : 'success' }, { name: 'Playwright (smoke + every README example + UXor recipe specs)', conclusion: tests }];
    const setupFailed = engineJobs().map((job) => ({ ...job, conclusion: 'failure', steps: steps('skipped') }));
    const lanes = { demo: lane('skip'), engines: lane('run', 'f'.repeat(64)), php: lane('skip'), 'prod-image': lane('skip') };
    assert.deepEqual(recorded(fx, lanes, setupFailed, { needs: { demo: { result: 'failure' } } }).markers, [], 'no failure marker for tests that never ran');
    const testsFailed = engineJobs().map((job, i) => (i === 0 ? { ...job, conclusion: 'failure', steps: steps('failure') } : job));
    assert.deepEqual(recorded(fx, lanes, testsFailed, { needs: { demo: { result: 'failure' } } }).markers, [`ci-fail-v1-engines-${'f'.repeat(64)}`]);
    const { verdict } = verdictFixture(t, { engines: lane('run', 'f'.repeat(64)), event: 'daily' });
    const out = verdict({ demo: 'failure' }, undefined, [], setupFailed);
    assert.match(out.outputs, /^engines-status=incomplete$/m);
    assert.doesNotMatch(out.outputs, /engines-report=Firefox\/WebKit failed/);
});

test('the verdict accepts the age the plan accepted, a 24-hour lane included, and still requalifies the rest (5)', (t) => {
    const fx = scratch(t);
    const fp = fingerprints(fx, fx.head()).lanes['fresh-install'];
    const installs = [
        { id: 1100, name: 'Fresh install', conclusion: 'success', status: 'completed', run_attempt: 1 },
        { id: 1101, name: 'Fresh install (Symfony Docker, from GitHub)', conclusion: 'success', status: 'completed', run_attempt: 1 },
    ];
    // planned at 23 h 55 old; the verdict runs at 24 h 05
    const m = marker(fx, { lane: 'fresh-install', sha: fx.head(), fp, jobs: installs, artifactId: 9810, runId: 81, created: '2026-11-15T11:55:00Z' });
    const routes = routesFor('fresh-install', fp, [m]);
    const evidence = { artifact_id: 9810, artifact_name: m.artifact.name, run_id: 81, run_attempt: 1, head_sha: fx.head(), url: 'https://github.com/example/project/actions/runs/81', jobs: brief(installs), completed_at: '2026-11-15T11:55:00Z', flaky: null };
    const lanes = Object.fromEntries([...LANES, 'engines'].map((name) => [name, lane('skip', null)]));
    lanes['fresh-install'] = { ...lane('reuse', fp), evidence };
    const planFile = join(fx.dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ schema: 1, repo: REPO, sha: fx.head(), ref: 'refs/heads/feature', event: 'push', reuse: true, chromium_shards: 6, lanes }));
    const results = { changes: 'success', importmap: 'skipped', 'lint-kit': 'skipped', php: 'skipped', 'static-site': 'skipped', 'fresh-install': 'skipped', 'docker-install': 'skipped', package: 'skipped', demo: 'skipped', 'prod-image': 'skipped', quick: 'success' };
    const needs = { ...Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }])), quick: { result: 'success', outputs: { tools: 'success', contrast: 'skipped', workflows: 'skipped' } } };
    writeFileSync(join(fx.dir, 'needs.json'), JSON.stringify(needs));
    const out = run(fx, ['verdict', '--plan', planFile, '--needs', join(fx.dir, 'needs.json'), '--repo', REPO, '--now', '2026-11-16T12:00:00Z'], routes);
    assert.equal(out.status, 0, out.stderr);
    const expired = run(fx, ['verdict', '--plan', planFile, '--needs', join(fx.dir, 'needs.json'), '--repo', REPO], routesFor('fresh-install', fp, [marker(fx, { lane: 'fresh-install', sha: fx.head(), fp, jobs: installs, artifactId: 9810, runId: 81, created: '2026-11-15T11:55:00Z', artifact: { expired: true } })]));
    assert.equal(expired.status, 1, 'an expired marker is still refused');
});

test('a red or cancelled Quick checks fails CI result even when its outputs all say success (2), and finish reads it (8)', (t) => {
    const { fx, verdict } = verdictFixture(t);
    const quick = (result) => ({ quick: { result, outputs: { tools: 'success', contrast: 'success', workflows: 'skipped' } } });
    for (const result of ['failure', 'cancelled']) {
        const out = run(fx, ['verdict', '--plan', join(fx.dir, 'plan.json'), '--needs', (() => {
            const file = join(fx.dir, `needs-${result}.json`);
            const base = { changes: 'success', importmap: 'success', 'lint-kit': 'skipped', php: 'success', 'static-site': 'skipped', 'fresh-install': 'skipped', 'docker-install': 'skipped', package: 'skipped', demo: 'skipped', 'prod-image': 'skipped' };
            writeFileSync(file, JSON.stringify({ ...Object.fromEntries(Object.entries(base).map(([job, r]) => [job, { result: r, outputs: {} }])), ...quick(result) }));
            return file;
        })(), '--repo', REPO], producer(fx, fx.head(), fingerprints(fx, fx.head()).lanes.demo));
        assert.equal(out.status, 1, `Quick checks ${result}`);
        assert.match(out.stderr, new RegExp(`(tools|contrast).*${result}`));
    }
    void verdict;
});

test("Quick checks' summary counts its setup steps, and a cancelled step is no pass (2, 8)", (t) => {
    const fx = scratch(t);
    const { workflow, job } = workflowJobs('ci.yml');
    const step = stepIn(workflow, 'quick', 'summary');
    assert.match(job('quick').text, /id: setup-node/);
    assert.match(job('quick').text, /id: setup-php/);
    const run2 = (steps) => {
        const output = join(fx.dir, 'q-out');
        writeFileSync(output, '');
        writeFileSync(join(fx.dir, 'q-sum'), '');
        const out = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], { encoding: 'utf8', env: { PATH: process.env.PATH, STEPS: JSON.stringify(steps), CONTRAST: 'run', WORKFLOWS: 'skip', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(fx.dir, 'q-sum') } });
        return { ...out, outputs: Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('='))) };
    };
    const s = (outcome) => ({ outcome, conclusion: outcome, outputs: {} });
    const setupFailed = run2({ 'setup-node': s('success'), 'setup-php': s('failure'), 'tools-cases': s('success'), 'contrast-tokens': s('success') });
    assert.equal(setupFailed.status, 1);
    assert.equal(setupFailed.outputs.tools, 'incomplete', 'checks run on the image\'s own PHP after its setup failed are no pass');
    assert.equal(setupFailed.outputs.contrast, 'incomplete');
    const cancelled = run2({ 'setup-node': s('success'), 'setup-php': s('success'), 'tools-cases': s('success'), 'contrast-tokens': s('cancelled') });
    assert.equal(cancelled.outputs.contrast, 'incomplete');
    const none = run2({ 'setup-node': s('success'), 'setup-php': s('success'), 'tools-cases': s('success') });
    assert.equal(none.outputs.contrast, 'incomplete', 'a selected check with no step run');
});

test("the plan's lookups for several lanes overlap, and decide as before (speed a)", (t) => {
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
    const plan = JSON.parse(readFileSync(out, 'utf8'));
    for (const lane of Object.keys(lanes)) assert.equal(plan.lanes[lane].decision, 'reuse', `${lane}: ${plan.lanes[lane].detail}`);
    const spans = readFileSync(times, 'utf8').trim().split('\n').map((line) => line.split(' ').slice(0, 2).map(Number));
    const overlapping = spans.some(([start, end], i) => spans.some(([s2], j) => j !== i && s2 > start && s2 < end));
    assert.ok(overlapping, 'some calls run at the same time');
    const serial = spans.reduce((sum, [start, end]) => sum + (end - start), 0);
    assert.ok(plan.elapsed_ms < serial * 0.6, `the plan (${plan.elapsed_ms} ms) is well under its calls one after another (${serial} ms)`);
    const listings = result.calls.filter((c) => c.includes('/actions/artifacts?name='));
    assert.equal(new Set(listings).size, listings.length, 'each listing fetched once');
    assert.equal(result.calls.filter((c) => /\/runs\/90$/.test(c)).length, 1, 'the producer run once, shared by the lanes');
});
