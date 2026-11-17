// tools/ci/lane-evidence.mjs: fingerprints, the plan and the engines lane. GitHub's API is a stub `gh` serving fixtures
// by path; git is real, on a scratch repository (tools/tests/lane-evidence-fixtures.mjs).
import { test } from 'node:test';
import {
    DEMO_JOBS,
    EXCLUDED,
    LANES,
    LANES_ALL,
    NOW,
    REPO,
    REUSABLE,
    SKIPPED_DEMO,
    appendFileSync,
    assert,
    brief,
    chmodSync,
    closeSync,
    crc32,
    daily,
    dailyRoutes,
    deflateRawSync,
    demoJobs,
    engineJobs,
    engineRoutes,
    enginesOnly,
    enginesPlan,
    evaluate,
    existsSync,
    fileURLToPath,
    fingerprints,
    ghCalls,
    gitIn,
    installJobs,
    join,
    key,
    lane,
    lintJobs,
    manual,
    marker,
    mkdirSync,
    mkdtempSync,
    openSync,
    packageJobs,
    plan,
    producer,
    push,
    readFileSync,
    readdirSync,
    recorded,
    rmSync,
    routesFor,
    run,
    scratch,
    selection,
    spawnSync,
    stepIn,
    stubGh,
    symlinkSync,
    tmpdir,
    tool,
    verdictFixture,
    workflowJobs,
    writeFileSync,
    zip,
} from './lane-evidence-fixtures.mjs';

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
