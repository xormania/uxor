// tools/ci/lane-evidence.mjs: jobs 4 to 6 and the stack's review. GitHub's API is a stub `gh` serving fixtures by path;
// git is real, on a scratch repository (tools/tests/lane-evidence-fixtures.mjs).
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
