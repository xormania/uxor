// tools/ci/lane-evidence.mjs: CI result's record and verdict. GitHub's API is a stub `gh` serving fixtures by path; git
// is real, on a scratch repository (tools/tests/lane-evidence-fixtures.mjs).
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
