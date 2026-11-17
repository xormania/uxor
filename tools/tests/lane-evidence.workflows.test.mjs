// tools/ci/lane-evidence.mjs: the workflows' wiring and shell steps, and job 3's review. GitHub's API is a stub `gh`
// serving fixtures by path; git is real, on a scratch repository (tools/tests/lane-evidence-fixtures.mjs).
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

test("ci.yml runs each lane on the plan's decision, from one browser job whose matrix the plan computes", async () => {
    const { REUSABLE: rules, LANES: lanes } = await import('../ci/lane-evidence.mjs');
    assert.deepEqual(Object.keys(rules).sort(), [...REUSABLE].sort());
    const { workflow, job } = workflowJobs('ci.yml');
    // the two settings, each in one place
    // CHROMIUM_SHARDS is tuned from measurements: set once, a whole number the plan accepts (1 to 20)
    const shards = [...workflow.matchAll(/^ {4}CHROMIUM_SHARDS: '(\d+)'$/gm)].map((m) => Number(m[1]));
    assert.equal(shards.length, 1, 'CHROMIUM_SHARDS is set once');
    assert.ok(shards[0] >= 1 && shards[0] <= 20, `CHROMIUM_SHARDS is a sane number (${shards[0]})`);
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
    assert.match(verdict.text, /ENGINES: \$\{\{ steps\.recheck\.outputs\.engines \|\| needs\.changed\.outputs\.engines \}\}/);
    assert.match(verdict.needs, /start-engines/);
    assert.match(verdict.text, /no Firefox\/WebKit pass for/);
    assert.match(verdict.text, /re-run Release checks when it passes/);
});

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

test("Release checks' verdict looks the engines evidence up itself when What to check said missing, so Re-run failed jobs recovers (the owner's Codex review)", (t) => {
    const fx = scratch(t);
    const { workflow, job } = workflowJobs('release-checks.yml');
    const verdictJob = job('verdict');
    assert.match(verdictJob.text, /^ {12}actions: read\b/m, 'it may read the run artifacts and markers');
    assert.doesNotMatch(verdictJob.text, /: write\b/, 'and holds no write token');
    const checkout = verdictJob.text.split(/\n(?= {12}- )/).find((s) => s.includes('actions/checkout@'));
    assert.ok(checkout, 'a checkout of the tool');
    assert.match(checkout, /persist-credentials: false/);
    assert.match(checkout, /sparse-checkout: \|?\s*\n?\s*tools\/ci/);
    const recheck = stepIn(workflow, 'verdict', 'recheck');
    assert.ok(recheck, 'a recheck step');
    assert.match(verdictJob.text, /id: recheck\n {14}if: .*startsWith\(needs\.changed\.outputs\.engines, 'missing'\)/);
    assert.match(verdictJob.text, /ENGINES: \$\{\{ steps\.recheck\.outputs\.engines \|\| needs\.changed\.outputs\.engines \}\}/);
    // the same command, one rule, in What to check and in the verdict
    for (const step of [stepIn(workflow, 'changed', 'engines'), recheck]) assert.match(step.run, /lane-evidence\.mjs"? require --lane engines --repo "\$REPO" --merge "\$GITHUB_SHA" --github-output "\$GITHUB_OUTPUT"/);

    // a release pull request: its head, and GitHub's merge of it into main
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
    const step = (s, sha, routes) => {
        writeFileSync(join(fx.dir, 'routes.json'), JSON.stringify(routes));
        writeFileSync(join(fx.dir, 'gh-api.log'), '');
        const output = join(fx.dir, 'verdict-out');
        writeFileSync(output, '');
        const out = spawnSync('bash', ['-eo', 'pipefail', '-c', s.run], { cwd: fx.repo, encoding: 'utf8',
            env: { PATH: `${fx.bin}:${process.env.PATH}`, REPO, GITHUB_SHA: sha, GITHUB_OUTPUT: output, FAKE_GH_ROUTES: join(fx.dir, 'routes.json'), FAKE_GH_LOG: join(fx.dir, 'gh-api.log') } });
        assert.equal(out.status, 0, out.stderr);
        return readFileSync(output, 'utf8').match(/^engines=(.*)$/m)?.[1];
    };
    const decide = (engines) => spawnSync('bash', ['-eo', 'pipefail', '-c', stepIn(workflow, 'verdict', 'decide').run], { encoding: 'utf8',
        env: { PATH: process.env.PATH, EVENT: 'pull_request', CHANGED: 'success', RUN: 'false', SUITE: 'skipped', COMPLETE: 'skipped', PROD_IMAGE: 'skipped', START: 'dispatched', BRANCH: 'release', ENGINES: engines } });
    // attempt 1 said missing; the engines run has passed since: the verdict's own lookup finds it, and the check passes
    const found = step(recheck, merge, engineRoutes(fx, head, fp));
    assert.equal(found, 'pass');
    assert.equal(decide(found).status, 0, 'Re-run failed jobs recovers once the engines passed');
    // still missing: the same message as before
    const still = step(recheck, merge, {});
    assert.match(still, /^missing: engines: no_evidence/);
    const red = decide(still);
    assert.equal(red.status, 1);
    assert.match(red.stdout + red.stderr, /no Firefox\/WebKit pass for this release's head: .*re-run Release checks when it passes/);
    // main moved on: the merge tests another tree, which no pass on the head can stand for
    fx.git('checkout', '-q', base);
    fx.git('checkout', '-qb', 'main2');
    fx.commit('README.md', 'main moved\n');
    fx.git('merge', '-q', '--no-ff', '--no-edit', 'release');
    const tree = step(recheck, fx.head(), engineRoutes(fx, head, fp));
    assert.match(tree, /^tree: /);
    assert.match(decide(tree).stdout + decide(tree).stderr, /[Bb]ring main into release/);
});
