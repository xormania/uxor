// tools/ci/lane-evidence.mjs: the lanes' fingerprints, the plan that reuses a lane's earlier pass, the markers CI result
// records and its verdict. GitHub's API is a stub `gh` serving fixtures by path; git is real, on a scratch repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const tool = fileURLToPath(new URL('../ci/lane-evidence.mjs', import.meta.url));
const REPO = 'example/project';
const NOW = '2026-11-16T12:00:00Z';
const LANES = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows', 'package', 'prod-image'];
const REUSABLE = ['demo', 'engines', 'php', 'prod-image'];
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

function run(fx, args, routes = {}, { gitDir = fx.repo } = {}) {
    const routesFile = join(fx.dir, 'routes.json');
    const log = join(fx.dir, `gh-${Math.random().toString(36).slice(2)}.log`);
    writeFileSync(routesFile, JSON.stringify(routes));
    writeFileSync(log, '');
    const result = spawnSync(process.execPath, [tool, ...args, '--git-dir', gitDir, '--gh', join(fx.bin, 'gh'), '--now', NOW, '--retry-delay-ms', '1'], {
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

// the browser job's matrix: CHROMIUM_SHARDS (6) Chromium shards are the demo lane, three each of Firefox and WebKit the
// engines lane
const demoJobs = (base = 500, attempt = 1, shards = 6) => Array.from({ length: shards }, (_, i) => `chromium ${i + 1}/${shards}`)
    .map((label, i) => ({ id: base + i, name: `Demo + Playwright (${label})`, conclusion: 'success', status: 'completed', run_attempt: attempt }));
const engineJobs = (base = 700, attempt = 1) => [...[1, 2, 3].map((s) => `firefox ${s}/3`), ...[1, 2, 3].map((s) => `webkit ${s}/3`)]
    .map((label, i) => ({ id: base + i, name: `Demo + Playwright (${label})`, conclusion: 'success', status: 'completed', run_attempt: attempt }));
const DEMO_JOBS = demoJobs();
const SKIPPED_DEMO = { id: 499, name: 'Demo + Playwright (${{ matrix.browser }} ${{ matrix.shard }}/${{ matrix.shards }})', conclusion: 'skipped', status: 'completed', run_attempt: 1 };
const brief = (jobs) => jobs.map(({ id, name, conclusion, run_attempt }) => ({ id, name, conclusion, run_attempt }));

/**
 * One marker artifact and the producer run behind it, as API routes: the artifact, its ZIP, its run and the run's
 * latest jobs. `evidence`, `run`, `artifact` and `jobs` override the defaults; `latestJobs` is what the run lists now.
 */
function marker(fx, { lane = 'demo', fp, sha, kind = 'pass', runId = 71, artifactId = 9001, attempt = 1, jobs = DEMO_JOBS, latestJobs, created = '2026-11-15T12:00:00Z', evidence = {}, run = {}, artifact = {}, zipBytes, deflate = false } = {}) {
    const name = `ci-${kind}-v1-${lane}-${fp}`;
    const content = { schema: 1, kind, lane, fingerprint: fp, repo: REPO, sha, run_id: runId, run_attempt: attempt, jobs: brief(jobs), flaky: 2, tests: { passed: 600, failed: 0, flaky: 2, skipped: 3 }, runner: { image_os: 'ubuntu24', image_version: '20261110.1' }, recorded_at: created, ...evidence };
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
    assert.equal(p.lanes.demo.evidence.jobs.length, 6);
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
        marker(fx, { sha, fp, kind: 'fail', runId: 73, artifactId: 9102, attempt: 2, created: '2026-11-15T14:00:00Z', jobs: demoJobs(550, 2), latestJobs: demoJobs(600, 3) })];
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

function recorded(fx, planLanes, jobs, { needs, reuse = true } = {}) {
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
    const result = run(fx, ['record', '--plan', planFile, '--jobs', jobsFile, '--needs', needsFile, '--run-id', '88', '--run-attempt', '2', '--out', out, '--github-output', github]);
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
    assert.equal(pass.run_attempt, 2);
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
        [...failedDemo, { id: 600, name: 'Kit PHP', conclusion: 'success', status: 'completed', run_attempt: 1 }], { reuse: false });
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
        writeFileSync(jobsFile, JSON.stringify(jobs));
        const out = run(fx, ['verdict', '--plan', planFile, '--needs', needs(overrides), '--jobs', jobsFile, '--repo', REPO, '--summary', summary, '--github-output', github, ...extra], r);
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
    assert.equal(verdict({}, undefined, ['--wo-draft', 'true']).status, 1, 'a work order draft still fails');
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

test('a red daily engines run names the commits since the last all-browser pass', (t) => {
    const { fx, routes, verdict } = verdictFixture(t, { engines: lane('run', 'f'.repeat(64)), event: 'daily' });
    const last = 'a'.repeat(40);
    const head = fx.head();
    const daily = {
        ...routes,
        [`repos/${REPO}/actions/workflows/ci.yml/runs?branch=dev&status=success&per_page=30`]: { json: { workflow_runs: [
            { id: 61, head_sha: 'b'.repeat(40), path: '.github/workflows/ci.yml', head_repository: { full_name: REPO }, html_url: 'https://github.com/example/project/actions/runs/61' },
            { id: 60, head_sha: last, path: '.github/workflows/ci.yml', head_repository: { full_name: REPO }, html_url: 'https://github.com/example/project/actions/runs/60' }] } },
        [`repos/${REPO}/actions/runs/61/artifacts?per_page=100`]: { json: { artifacts: [{ name: `ci-pass-v1-demo-${'d'.repeat(64)}`, expired: false }] } },
        [`repos/${REPO}/actions/runs/60/artifacts?per_page=100`]: { json: { artifacts: [{ name: `ci-pass-v1-engines-${'e'.repeat(64)}`, expired: false }] } },
        [`repos/${REPO}/compare/${last}...${head}`]: { json: { total_commits: 2, commits: [
            { sha: '1234567890'.repeat(4), commit: { message: 'feat(tabs): keyboard wrap\n\nbody' } },
            { sha: 'abcdef0123'.repeat(4), commit: { message: 'fix(modal): focus return' } }] } },
    };
    const engines = engineJobs().map((job, i) => (i === 0 ? { ...job, conclusion: 'failure' } : job));
    const red = verdict({ demo: 'failure' }, daily, [], engines);
    assert.equal(red.status, 1);
    assert.match(red.stderr, new RegExp(`::error::.*commits since the last all-browser pass ${last.slice(0, 12)}`));
    assert.match(red.summary, /1234567 feat\(tabs\): keyboard wrap/);
    assert.match(red.summary, /abcdef0 fix\(modal\): focus return/);
    assert.match(red.summary, /actions\/runs\/60/);
    assert.match(red.outputs, /^engines-status=failed$/m);
    assert.match(red.outputs, /^engines-report=.*1234567 feat\(tabs\): keyboard wrap/m);
    const green = verdict({ demo: 'success' }, daily, [], engineJobs());
    assert.match(green.outputs, /^engines-status=passed$/m);
    const unknown = verdict({ demo: 'failure' }, routes, [], engines);
    assert.match(unknown.summary, /no earlier all-browser pass found/, 'without one, it says so rather than inventing a range');
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
    refused('the marker aged out', producer(fx, fx.head(), fp, { created: '2026-11-01T00:00:00Z' }));
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
    for (const id of ['php', 'prod-image', 'lint-kit', 'static-site', 'fresh-install', 'contrast', 'workflows', 'package']) {
        assert.ok(job(id).if.includes(`needs.changes.outputs.${id} == 'run'`), `${id}: ${job(id).if}`);
    }
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
    assert.equal(result.name, 'CI result', 'the rulesets require this exact name');
    // the engines run in the browser job (`demo`), which CI result needs
    for (const id of [...lanes.filter((id) => id !== 'engines'), 'docker-install', 'importmap', 'tools', 'changes']) assert.ok(result.needs.includes(id), `CI result needs ${id}`);
    assert.match(result.text, /name: \$\{\{ needs\.changes\.outputs\.lane-plan \}\}/);
    assert.match(job('changes').text, /lane-plan: \$\{\{ steps\.plan\.outputs\.artifact \}\}/);
    assert.match(result.text, /set -o pipefail[\s\S]*lane-evidence\.mjs" record/);
    assert.match(result.text, /lane-evidence\.mjs" verdict[^\n]*\n?[^\n]*--jobs "\$RUNNER_TEMP\/run-jobs\.json"/, 'the verdict reads the browser lanes from the jobs');
    const steps = result.text.split(/\n(?= {12}- )/);
    for (const id of Object.keys(rules)) {
        for (const kind of ['pass', 'fail']) {
            const step = steps.find((s) => s.includes(`steps.record.outputs.${id}-kind == '${kind}'`));
            assert.ok(step, `${id}: an upload step for its ${kind} marker`);
            assert.match(step, /overwrite: true/);
            assert.match(step, new RegExp(`name: \\$\\{\\{ steps\\.record\\.outputs\\.${id}-marker \\}\\}`));
            if (kind === 'fail') assert.doesNotMatch(step, /continue-on-error/);
        }
    }
    assert.doesNotMatch(steps.find((s) => s.includes('name: Record the lanes that ran')), /continue-on-error/);

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
    assert.match(start.text, /gh workflow run ci\.yml --repo "\$REPO" --ref dev -f engines=true/);
    assert.match(start.if, /needs\.changed\.outputs\.engines != 'pass'/);
    assert.match(changed.text, /engines: \$\{\{ steps\.engines\.outputs\.engines \}\}/);
    const verdict = job('verdict');
    assert.match(verdict.text, /ENGINES: \$\{\{ needs\.changed\.outputs\.engines \}\}/);
    assert.match(verdict.needs, /start-engines/);
    assert.match(verdict.text, /no Firefox\/WebKit pass for/);
    assert.match(verdict.text, /re-run Release checks when it passes/);
});
