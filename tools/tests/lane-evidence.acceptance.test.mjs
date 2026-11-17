// Acceptance tests of tools/ci/lane-evidence.mjs, written from the owner's specification (UXor CI Performance Scope and
// Specification, 2026-11-14, section 6, *Acceptance scenarios*) and docs/TESTING.md (*Reused lanes*), not from the
// implementation. One test per row of the specification's table that this tool is responsible for, each named after
// its row and asserting the row's observable result.
//
// Every test drives the real command line on a real scratch git repository, against a simulated GitHub: a CI run is
// the tool's `plan`, the jobs the plan asks for (their conclusions set by the test), then the tool's `finish` (CI
// result's step: record, then verdict). The markers `finish` writes are what later runs find, zipped as GitHub serves
// an artifact. No marker is written by hand, except where a row is about a forged or damaged one.
//
// A row the tool does not satisfy as written stays a test, marked `todo` with the word FINDING and why: it runs and is
// reported as failing ("not ok ... # TODO"), without failing the suite while the fix is open.
//
// Run: node --test tools/tests/lane-evidence.acceptance.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const tool = fileURLToPath(new URL('../ci/lane-evidence.mjs', import.meta.url));
const REPO = 'example/uxor';
const NOW = Date.parse('2026-11-16T12:00:00Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600_000).toISOString();
const HOUR = 1;
const DAY = 24;

// the selector's lanes (tools/ci-changes.sh); the engines follow the browser tests
const SELECTOR_LANES = ['lint-kit', 'php', 'static-site', 'fresh-install', 'contrast', 'demo', 'workflows', 'package', 'prod-image'];
const ALL = Object.fromEntries(SELECTOR_LANES.map((lane) => [lane, true]));
// the lanes whose pass can be reused (docs/TESTING.md, *Reused lanes*): 14 days, or 24 hours for those resolving live
const REUSABLE = ['php', 'demo', 'prod-image', 'fresh-install', 'lint-kit', 'package'];
const DAY_LANES = ['fresh-install', 'lint-kit', 'package'];
const CHROMIUM_SHARDS = 6;

// ci.yml's job names, per lane
const LANE_JOBS = {
    php: ['Kit PHP'],
    'static-site': ['Static site'],
    'prod-image': ['Production image'],
    package: ['Package'],
    'fresh-install': ['Fresh install', 'Fresh install (Symfony Docker, from GitHub)'],
    'lint-kit': ['Lint kit (locked toolkit)', 'Lint kit (minimum toolkit)'],
    demo: Array.from({ length: CHROMIUM_SHARDS }, (_, i) => `Demo + Playwright (chromium ${i + 1}/${CHROMIUM_SHARDS})`),
    engines: ['firefox', 'webkit'].flatMap((b) => [1, 2, 3].map((s) => `Demo + Playwright (${b} ${s}/3)`)),
};
// CI result's `needs` names for the lanes that are jobs of their own
const NEEDS_OF = { php: ['php'], 'static-site': ['static-site'], 'prod-image': ['prod-image'], package: ['package'], 'fresh-install': ['fresh-install', 'docker-install'], 'lint-kit': ['lint-kit'] };

/** a store-only ZIP holding one file, as GitHub serves an artifact */
function zip(name, data) {
    const raw = Buffer.from(data);
    const file = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(file.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(local.length + file.length + raw.length, 16);
    return Buffer.concat([local, file, raw, central, file, end]);
}

/**
 * A repository shaped like UXor's (the files the rows name) and a simulated GitHub holding its CI runs, their jobs and
 * their artifacts. `gh api <path>` is a stub answering from that state.
 */
function world(t) {
    const dir = mkdtempSync(join(tmpdir(), 'lane-acceptance-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = (...args) => {
        const out = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo, encoding: 'utf8' });
        assert.equal(out.status, 0, `git ${args.join(' ')}: ${out.stderr}`);
        return out.stdout.trim();
    };
    const write = (path, content) => {
        mkdirSync(join(repo, path, '..'), { recursive: true });
        writeFileSync(join(repo, path), content);
    };
    git('init', '-q', '-b', 'dev');
    const files = {
        '.github/workflows/ci.yml': 'name: CI\non: push\n',
        '.github/pull_request_template.md': '## What\n',
        'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A fix.\n\n## [0.3.1] - 2026-11-05\n\n- Earlier.\n',
        'CONTRIBUTING.md': '# Contributing\n',
        'AGENTS.md': '# Agents\n',
        'SECURITY.md': '# Security\n',
        'README.md': '# UXor\n\n```twig\n<twig:Button>Save</twig:Button>\n```\n',
        'INSTALL.md': '# Install\n\n`symfony console ux:install button`\n',
        'docs/GUIDE.md': '# Guide\n\nSee the [changelog](../CHANGELOG.md).\n',
        'button/README.md': '# Button\n\n```twig\n<twig:Button>Save</twig:Button>\n```\n',
        'button/manifest.json': '{"name": "button"}\n',
        'button/templates/components/Button.html.twig': '<button class="btn">{% block content %}{% endblock %}</button>\n',
        'manifest.json': '{"name": "uxor", "homepage": "https://example.com"}\n',
        'kit.css': '.btn { color: blue; }\n',
        'tests/e2e/fixtures.ts': 'export const guard = true;\n',
        'tests/e2e/button.spec.ts': "test('button', () => {});\n",
        'demo/composer.lock': '{"packages": []}\n',
        'demo/Dockerfile': 'FROM dunglas/frankenphp:1-php8.5@sha256:aaaa\n',
        'tools/ci-changes.sh': '#!/bin/sh\necho selector\n',
        'tools/playwright-image.json': '{"image": "mcr.microsoft.com/playwright:v1.58.2-noble@sha256:bbbb"}\n',
        'packages/uxor/resources/uxor/index.json': '{"links": "0.3.1"}\n',
    };
    for (const [path, content] of Object.entries(files)) write(path, content);
    git('add', '-A');
    git('commit', '-qm', 'base');

    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // the stub: `gh api <path>` answers from routes.json (json, a file, or a failure); an unknown artifact name lists
    // nothing, any other path is GitHub's 404
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = process.argv[3];
fs.appendFileSync(process.env.FAKE_GH_LOG, path + '\\n');
const routes = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, 'utf8'));
const route = routes[path] ?? (path.includes('/actions/artifacts?name=') ? { json: { total_count: 0, artifacts: [] } } : undefined);
if (!route) { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
if (route.fail) { process.stderr.write('gh: ' + route.fail + '\\n'); process.exit(1); }
process.stdout.write(route.file ? fs.readFileSync(route.file) : JSON.stringify(route.json));
`);
    chmodSync(join(bin, 'gh'), 0o755);

    const state = { runs: new Map(), artifacts: [], nextRun: 100, nextArtifact: 5000, nextJob: 10000, broken: {} };

    const routes = () => {
        const r = {};
        const names = new Set(state.artifacts.map((a) => a.name));
        for (const name of names) {
            const list = state.artifacts.filter((a) => a.name === name).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
            r[`repos/${REPO}/actions/artifacts?name=${name}&per_page=100`] = { json: { total_count: list.length, artifacts: list.map(({ file, ...a }) => a) } };
        }
        for (const a of state.artifacts) {
            const { file, ...meta } = a;
            if (state.broken[a.id] !== 'gone') r[`repos/${REPO}/actions/artifacts/${a.id}`] = { json: meta };
            if (state.broken[a.id] !== 'gone' && state.broken[a.id] !== 'no-zip') r[`repos/${REPO}/actions/artifacts/${a.id}/zip`] = { file };
        }
        for (const run of state.runs.values()) {
            const { jobs, ...meta } = run;
            r[`repos/${REPO}/actions/runs/${run.id}`] = { json: meta };
            r[`repos/${REPO}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`] = { json: { total_count: jobs.length, jobs } };
        }
        return r;
    };

    /** the tool, with the stub gh and the simulated clock */
    const cli = (args, { now = at(0), env = {} } = {}) => {
        const routesFile = join(dir, 'routes.json');
        const log = join(dir, `gh-${Math.random().toString(36).slice(2)}.log`);
        writeFileSync(routesFile, JSON.stringify(routes()));
        writeFileSync(log, '');
        const out = spawnSync(process.execPath, [tool, ...args, '--git-dir', repo, '--gh', join(bin, 'gh'), '--now', now, '--retry-delay-ms', '1'], {
            encoding: 'utf8', env: { PATH: process.env.PATH, FAKE_GH_ROUTES: routesFile, FAKE_GH_LOG: log, ...env },
        });
        return { ...out, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
    };

    const commit = (path, content, message = `change ${path}`) => {
        if (content === null) rmSync(join(repo, path));
        else write(path, content);
        git('add', '-A');
        git('commit', '-qm', message);
        return git('rev-parse', 'HEAD');
    };
    const head = () => git('rev-parse', 'HEAD');
    const read = (path) => readFileSync(join(repo, path), 'utf8');

    /** a job of the run, as GitHub's jobs API lists it */
    const job = (name, conclusion, attempt, when) => ({
        id: state.nextJob++, name, status: conclusion === null ? 'in_progress' : 'completed', conclusion, run_attempt: attempt,
        started_at: when, completed_at: conclusion === null ? null : when,
    });

    /** CI result's `needs` for the run's latest jobs: each lane job's result, the setup jobs', Quick checks' outputs */
    const needsFor = (plan, jobs, overrides = {}) => {
        const conclusionOf = (names) => {
            const mine = jobs.filter((j) => names.includes(j.name));
            if (!mine.length || mine.every((j) => j.conclusion === 'skipped')) return 'skipped';
            if (mine.some((j) => j.conclusion === null)) return 'cancelled';
            for (const bad of ['failure', 'timed_out', 'cancelled']) if (mine.some((j) => j.conclusion === bad)) return bad;
            return 'success';
        };
        const needs = {
            changes: { result: 'success' },
            importmap: { result: ['php', 'static-site', 'demo', 'engines'].some((lane) => plan.lanes[lane]?.decision === 'run') ? 'success' : 'skipped' },
            quick: {
                result: 'success',
                outputs: { tools: 'success', contrast: plan.lanes.contrast?.decision === 'run' ? 'success' : 'skipped', workflows: plan.lanes.workflows?.decision === 'run' ? 'success' : 'skipped' },
            },
            demo: { result: conclusionOf([...LANE_JOBS.demo, ...LANE_JOBS.engines]) },
        };
        for (const [lane, names] of Object.entries(NEEDS_OF)) {
            names.forEach((need, i) => {
                const jobNames = lane === 'fresh-install' ? [LANE_JOBS[lane][i]] : LANE_JOBS[lane];
                needs[need] = { result: conclusionOf(jobNames) };
            });
        }
        return { ...needs, ...overrides };
    };

    /** CI result for one attempt of a run: the tool's finish, then the markers it wrote become the run's artifacts */
    const finish = (run, planFile, plan, when, { imageVersion = '20261110.1', needs: needsOverride } = {}) => {
        const jobsFile = join(dir, `jobs-${run.id}-${run.run_attempt}.json`);
        const needsFile = join(dir, `needs-${run.id}-${run.run_attempt}.json`);
        const markers = join(dir, `markers-${run.id}-${run.run_attempt}`);
        writeFileSync(jobsFile, JSON.stringify(run.jobs));
        writeFileSync(needsFile, JSON.stringify(needsFor(plan, run.jobs, needsOverride)));
        const out = cli(['finish', '--plan', planFile, '--jobs', jobsFile, '--needs', needsFile, '--run-id', String(run.id), '--run-attempt', String(run.run_attempt),
            '--out', markers, '--repo', REPO, '--summary', join(dir, 'summary.md')], { now: when, env: { ImageOS: 'ubuntu24', ImageVersion: imageVersion } });
        const verdictLine = out.stdout.trim().split('\n').reverse().find((line) => line.startsWith('{"schema"'));
        const recorded = [];
        if (existsSync(markers)) {
            for (const name of readdirSync(markers)) {
                const evidence = readFileSync(join(markers, name, 'evidence.json'), 'utf8');
                // a later attempt of the run replaces its earlier marker of the same name
                state.artifacts = state.artifacts.filter((a) => !(a.name === name && a.workflow_run.id === run.id));
                const id = state.nextArtifact++;
                const file = join(dir, `artifact-${id}.zip`);
                writeFileSync(file, zip('evidence.json', evidence));
                state.artifacts.push({ id, name, expired: false, created_at: when, file,
                    workflow_run: { id: run.id, repository_id: 10, head_repository_id: 10, head_sha: run.head_sha, head_branch: run.head_branch } });
                recorded.push(name);
            }
        }
        return { status: out.status, stderr: out.stderr, stdout: out.stdout, verdict: verdictLine ? JSON.parse(verdictLine) : null, recorded };
    };

    /**
     * A CI run of `ci.yml` on the current commit: the plan, the jobs it asks for (`conclusions` by job name, default
     * success; `missing` job names never appear), then CI result. `finished: false` leaves the run going, no CI result.
     */
    const ciRun = ({ ref = 'refs/heads/feature', event = 'push', selected = ALL, reuse, hoursAgo = 2, conclusions = {}, missing = [], finished = true, imageVersion, extra = [], needs } = {}) => {
        const when = at(hoursAgo);
        const sha = head();
        const id = state.nextRun++;
        const planFile = join(dir, `plan-${id}.json`);
        const outputsFile = join(dir, `outputs-${id}`);
        writeFileSync(outputsFile, '');
        const selection = join(dir, `selection-${id}`);
        writeFileSync(selection, SELECTOR_LANES.map((lane) => `${lane}=${!!selected[lane]}`).join('\n') + '\n');
        const planned = cli(['plan', '--repo', REPO, '--sha', sha, '--ref', ref, '--event', event, '--selection', selection, '--out', planFile,
            '--github-output', outputsFile, ...(reuse ? ['--reuse', reuse] : []), ...extra], { now: when });
        assert.equal(planned.status, 0, `plan: ${planned.stderr}`);
        const plan = JSON.parse(readFileSync(planFile, 'utf8'));
        const outputs = Object.fromEntries(readFileSync(outputsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
        const jobs = [];
        for (const [lane, names] of Object.entries(LANE_JOBS)) {
            if (plan.lanes[lane]?.decision !== 'run') continue;
            for (const name of names) if (!missing.includes(name)) jobs.push(job(name, name in conclusions ? conclusions[name] : 'success', 1, when));
        }
        if (!jobs.some((j) => j.name.startsWith('Demo + Playwright'))) {
            jobs.push(job('Demo + Playwright (${{ matrix.browser }} ${{ matrix.shard }}/${{ matrix.shards }})', 'skipped', 1, when));
        }
        const run = {
            id, name: 'CI', path: '.github/workflows/ci.yml', event: event === 'push' ? 'push' : 'workflow_dispatch', head_sha: sha, head_branch: ref.replace('refs/heads/', ''),
            run_attempt: 1, status: finished ? 'completed' : 'in_progress', created_at: when, html_url: `https://github.com/${REPO}/actions/runs/${id}`,
            repository: { id: 10, full_name: REPO }, head_repository: { id: 10, full_name: REPO }, jobs,
        };
        state.runs.set(id, run);
        const result = finished ? finish(run, planFile, plan, when, { imageVersion, needs }) : null;
        // a run left going reaches CI result later, at `hoursAgo`
        const complete = ({ hoursAgo: later }) => { run.status = 'completed'; return finish(run, planFile, plan, at(later), { imageVersion, needs }); };
        return { id, sha, plan, outputs, log: planned.stdout, calls: planned.calls, planFile, run, result, complete };
    };

    /** "Re-run failed jobs": a new attempt of the run that re-runs only its failed jobs, keeping the plan */
    const rerunFailed = (ran, { conclusions = {}, hoursAgo = 1 } = {}) => {
        const when = at(hoursAgo);
        const run = state.runs.get(ran.id);
        run.run_attempt += 1;
        run.jobs = run.jobs.map((j) => (['failure', 'timed_out', 'cancelled'].includes(j.conclusion) ? job(j.name, conclusions[j.name] ?? 'success', run.run_attempt, when) : j));
        return finish(run, ran.planFile, ran.plan, when);
    };

    return { dir, repo, git, commit, head, read, cli, ciRun, rerunFailed, state, routes };
}

const decisions = (plan) => Object.fromEntries(Object.entries(plan.lanes).map(([lane, e]) => [lane, e.decision]));
const matrix = (ran) => JSON.parse(ran.outputs['browser-matrix']).include;
const markerOf = (w, name) => w.state.artifacts.find((a) => a.name === name);
const evidenceOf = (w, artifact) => {
    // the ZIP is stored: the JSON is the bytes between the local header's name and the central directory
    const bytes = readFileSync(artifact.file);
    const nameLength = bytes.readUInt16LE(26);
    const size = bytes.readUInt32LE(18);
    return JSON.parse(bytes.subarray(30 + nameLength, 30 + nameLength + size).toString('utf8'));
};
const allPassedRun = (w, options = {}) => {
    const ran = w.ciRun(options);
    assert.equal(ran.result.status, 0, `the green run's CI result: ${ran.result.stderr}`);
    assert.ok(ran.result.verdict.ok);
    return ran;
};

// ---------------------------------------------------------------------------------------------------------------------
// Row: Green code followed by CHANGELOG prose correction
// Fresh applicable documentation/policy/result checks; no unaffected expensive setup or browser execution; original
// proof identified
// ---------------------------------------------------------------------------------------------------------------------
test('green code, then a CHANGELOG prose correction: no browser or expensive lane runs again, each reused lane names the run that proved it, the docs checks run fresh', (t) => {
    const w = world(t);
    w.commit('button/templates/components/Button.html.twig', '<button class="btn btn-primary">{% block content %}{% endblock %}</button>\n');
    const green = allPassedRun(w, { hoursAgo: 3 });
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, worded better.'));
    // a branch is compared with where it left dev: the selection is still every lane the code selected
    const docs = w.ciRun({ hoursAgo: 1 });

    for (const lane of REUSABLE) {
        assert.equal(docs.plan.lanes[lane].decision, 'reuse', `${lane}: ${docs.plan.lanes[lane].reason} ${docs.plan.lanes[lane].detail}`);
        assert.equal(docs.plan.lanes[lane].evidence.run_id, green.id, `${lane} names the run that proved it`);
        assert.equal(docs.plan.lanes[lane].evidence.head_sha, green.sha, `${lane} names the commit that was tested`);
    }
    assert.deepEqual(matrix(docs), [], 'no browser shard runs');
    assert.equal(docs.outputs.browsers, 'skip');
    assert.equal(docs.outputs.importmap, 'run', 'the static site, which always runs when selected, still needs the importmap packages');
    for (const lane of ['contrast', 'workflows', 'static-site']) assert.equal(docs.plan.lanes[lane].decision, 'run', `${lane} runs fresh`);

    assert.equal(docs.result.status, 0, docs.result.stderr);
    assert.ok(docs.result.verdict.ok);
    for (const lane of REUSABLE) {
        assert.equal(docs.result.verdict.lanes[lane].status, 'reused');
        assert.equal(docs.result.verdict.lanes[lane].producer.run_id, green.id);
    }
    assert.deepEqual(docs.result.recorded, [], 'a reused lane records nothing: the evidence keeps naming the run that executed it');
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: CHANGELOG release-heading or generated-reference change
// Output/reference effects detected; affected artifact/package checks run; unrelated proof can remain usable
// ---------------------------------------------------------------------------------------------------------------------
test('a CHANGELOG release heading: the Package check, whose generated references link the latest release, runs again', {
    todo: 'FINDING: CHANGELOG.md is excluded from every lane\'s fingerprint, but Package reads it: generate-reference.php --check takes the links\' release from its latest ## [X.Y.Z] heading, and a new heading alone makes that check fail ("changed: index.json"). A Package pass on the old heading is reused.',
}, (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 3 });
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('## [Unreleased]\n', '## [Unreleased]\n\n## [0.3.2] - 2026-11-16\n'));
    const release = w.ciRun({ hoursAgo: 1 });
    assert.equal(release.plan.lanes.package.decision, 'run', `package: ${release.plan.lanes.package.reason}, reusing run ${release.plan.lanes.package.evidence?.run_id ?? '-'} (green: ${green.id})`);
});

test('a CHANGELOG release heading: the lanes that do not read it keep their proof', (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 3 });
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('## [Unreleased]\n', '## [Unreleased]\n\n## [0.3.2] - 2026-11-16\n'));
    const release = w.ciRun({ hoursAgo: 1 });
    for (const lane of ['php', 'demo', 'prod-image']) {
        assert.equal(release.plan.lanes[lane].decision, 'reuse', `${lane}: ${release.plan.lanes[lane].reason}`);
        assert.equal(release.plan.lanes[lane].evidence.run_id, green.id);
    }
});

test('a generated-reference change: its effect is detected and the Package check runs again', (t) => {
    const w = world(t);
    allPassedRun(w, { hoursAgo: 3 });
    w.commit('packages/uxor/resources/uxor/index.json', '{"links": "0.3.2"}\n');
    const generated = w.ciRun({ hoursAgo: 1 });
    assert.equal(generated.plan.lanes.package.decision, 'run', generated.plan.lanes.package.reason);
    assert.equal(generated.result.verdict.lanes.package.status, 'fresh');
    // "unrelated proof can remain usable" is permissive: what the tool does with the other lanes is recorded, not judged
    t.diagnostic(`other lanes after a generated-reference change: ${JSON.stringify(Object.fromEntries(['php', 'demo', 'prod-image'].map((l) => [l, generated.plan.lanes[l].decision])))}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: Rendered README example, INSTALL, or guide change
// Actual affected consumers are validated; Markdown suffix alone never exempts them
// ---------------------------------------------------------------------------------------------------------------------
for (const [path, edit] of [
    ['button/README.md', (text) => text.replace('Save', 'Save changes')],
    ['README.md', (text) => text.replace('Save', 'Send')],
    ['INSTALL.md', (text) => text.replace('button', 'button alert')],
    ['docs/GUIDE.md', (text) => `${text}\nA new section.\n`],
]) {
    test(`a rendered Markdown file (${path}): the lanes that render or bundle it run again, though it ends in .md`, (t) => {
        const w = world(t);
        allPassedRun(w, { hoursAgo: 3 });
        w.commit(path, edit(w.read(path)));
        const ran = w.ciRun({ hoursAgo: 1 });
        for (const lane of ['php', 'demo', 'package', 'prod-image']) {
            assert.equal(ran.plan.lanes[lane].decision, 'run', `${lane} after ${path}: ${ran.plan.lanes[lane].reason}`);
        }
        assert.equal(matrix(ran).filter((m) => m.browser === 'chromium').length, CHROMIUM_SHARDS, 'every Chromium shard runs');
        assert.ok(ran.result.verdict.ok);
        assert.equal(ran.result.verdict.lanes.demo.status, 'fresh');
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Row: Shared fixture, lock, workflow, selector, or runtime change
// Appropriate broad invalidation; full execution remains available
// ---------------------------------------------------------------------------------------------------------------------
for (const [kind, path, content] of [
    ['shared fixture', 'tests/e2e/fixtures.ts', 'export const guard = false;\n'],
    ['lock', 'demo/composer.lock', '{"packages": [{"name": "symfony/ux-toolkit"}]}\n'],
    ['workflow', '.github/workflows/ci.yml', 'name: CI\non: [push, workflow_dispatch]\n'],
    ['selector', 'tools/ci-changes.sh', '#!/bin/sh\necho selector two\n'],
    ['runtime', 'demo/Dockerfile', 'FROM dunglas/frankenphp:1-php8.5@sha256:cccc\n'],
    ['browser runtime', 'tools/playwright-image.json', '{"image": "mcr.microsoft.com/playwright:v1.58.2-noble@sha256:dddd"}\n'],
]) {
    test(`a ${kind} change (${path}): every reusable lane runs again, with its full set of jobs`, (t) => {
        const w = world(t);
        allPassedRun(w, { hoursAgo: 3 });
        w.commit(path, content);
        const ran = w.ciRun({ hoursAgo: 1 });
        for (const lane of REUSABLE) assert.equal(ran.plan.lanes[lane].decision, 'run', `${lane}: ${ran.plan.lanes[lane].reason}`);
        assert.equal(matrix(ran).filter((m) => m.browser === 'chromium').length, CHROMIUM_SHARDS);
        assert.equal(ran.result.status, 0, ran.result.stderr);
        for (const lane of REUSABLE) assert.equal(ran.result.verdict.lanes[lane].status, 'fresh', lane);
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Row: Failed, cancelled, running, or missing predecessor followed by docs
// No false reuse of incomplete work; required code validation completes
// ---------------------------------------------------------------------------------------------------------------------
const predecessors = {
    failed: (w) => w.ciRun({ hoursAgo: 3, conclusions: { 'Demo + Playwright (chromium 3/6)': 'failure', 'Kit PHP': 'failure' } }),
    cancelled: (w) => w.ciRun({ hoursAgo: 3, conclusions: Object.fromEntries([...LANE_JOBS.demo, 'Kit PHP'].map((name) => [name, 'cancelled'])) }),
    running: (w) => w.ciRun({ hoursAgo: 1, finished: false }),
    missing: () => null,
};
for (const [kind, predecessor] of Object.entries(predecessors)) {
    test(`a ${kind} predecessor, then a docs-only push: nothing incomplete is reused, and the code's validation runs to a verdict`, (t) => {
        const w = world(t);
        w.commit('kit.css', '.btn { color: red; }\n');
        predecessor(w);
        w.commit('CONTRIBUTING.md', '# Contributing\n\nA clearer sentence.\n');
        const docs = w.ciRun({ hoursAgo: 0.5 });
        for (const lane of ['php', 'demo']) assert.equal(docs.plan.lanes[lane].decision, 'run', `${lane}: ${docs.plan.lanes[lane].reason}`);
        assert.equal(matrix(docs).filter((m) => m.browser === 'chromium').length, CHROMIUM_SHARDS);
        assert.equal(docs.result.status, 0, docs.result.stderr);
        assert.equal(docs.result.verdict.lanes.demo.status, 'fresh');
        assert.equal(docs.result.verdict.lanes.php.status, 'fresh');
    });
}

test('a predecessor whose re-run is still going: its earlier pass is not reused while the latest attempt is incomplete', (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 3 });
    // "Re-run all jobs" started on the green run: its latest attempt's jobs are in progress
    const run = w.state.runs.get(green.id);
    run.run_attempt = 2;
    run.status = 'in_progress';
    run.jobs = run.jobs.map((j) => ({ ...j, id: j.id + 50000, run_attempt: 2, status: 'in_progress', conclusion: null, completed_at: null }));
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, again.'));
    const docs = w.ciRun({ hoursAgo: 0.5 });
    assert.equal(docs.plan.lanes.demo.decision, 'run', `demo: ${docs.plan.lanes.demo.reason}`);
    assert.equal(docs.plan.lanes.php.decision, 'run', `php: ${docs.plan.lanes.php.reason}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: Partial change to a previously green candidate
// Changed lanes execute; eligible unchanged lanes retain attributable proof
// ---------------------------------------------------------------------------------------------------------------------
test('a partial change to a green candidate: the lanes it changes run, and a lane it cannot affect keeps its attributable proof', {
    todo: "FINDING: a lane's fingerprint is the whole tree (all but five administrative files), so a change read by one lane only (a browser spec, read by the browser tests) gives every lane a new fingerprint: Kit PHP, Package and the production image run again with nothing of theirs changed. The per-lane excluded files in progress (stack-review) are the place for it.",
}, (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 3 });
    w.commit('tests/e2e/button.spec.ts', "test('button', () => { expect(1).toBe(1); });\n");
    const partial = w.ciRun({ hoursAgo: 1, selected: { ...ALL } });
    assert.equal(partial.plan.lanes.demo.decision, 'run', 'the browser tests, which read the spec, run');
    for (const lane of ['php', 'package', 'prod-image']) {
        assert.equal(partial.plan.lanes[lane].decision, 'reuse', `${lane}: ${partial.plan.lanes[lane].reason}`);
        assert.equal(partial.plan.lanes[lane].evidence.run_id, green.id);
    }
});

test('a partial result on a candidate: the lanes that passed keep their proof, the lane that failed runs again', (t) => {
    const w = world(t);
    const first = w.ciRun({ hoursAgo: 3, conclusions: { 'Production image': 'failure' } });
    assert.equal(first.result.verdict.ok, false);
    // a docs-only follow-up: the same inputs for every lane
    w.commit('AGENTS.md', '# Agents\n\nOne more rule.\n');
    const next = w.ciRun({ hoursAgo: 1 });
    assert.equal(next.plan.lanes['prod-image'].decision, 'run', 'the failed lane runs');
    for (const lane of ['php', 'demo', 'package']) {
        assert.equal(next.plan.lanes[lane].decision, 'reuse', `${lane}: ${next.plan.lanes[lane].reason}`);
        assert.equal(next.plan.lanes[lane].evidence.run_id, first.id, `${lane} names the run that passed it`);
    }
    assert.ok(next.result.verdict.ok);
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: One failed browser shard
// Targeted recovery preserves valid siblings and their original execution identities
// ---------------------------------------------------------------------------------------------------------------------
test('one failed browser shard, then Re-run failed jobs: the pass keeps the five siblings as they first ran and the re-run shard, and a later push reuses it', (t) => {
    const w = world(t);
    const failing = 'Demo + Playwright (chromium 4/6)';
    const first = w.ciRun({ hoursAgo: 3, conclusions: { [failing]: 'failure' } });
    assert.notEqual(first.result.status, 0, 'the first attempt fails');
    assert.equal(first.result.verdict.lanes.demo.status, 'incomplete');
    assert.ok(first.result.recorded.some((name) => name.startsWith('ci-fail-v1-demo-')), 'the failure is recorded');
    const siblings = first.run.jobs.filter((j) => LANE_JOBS.demo.includes(j.name) && j.name !== failing).map(({ id, name }) => ({ id, name }));

    const second = w.rerunFailed(first, { hoursAgo: 2 });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.verdict.lanes.demo.status, 'fresh');
    const pass = markerOf(w, second.recorded.find((name) => name.startsWith('ci-pass-v1-demo-')));
    assert.ok(pass, 'the recovered lane records a pass');
    const evidence = evidenceOf(w, pass);
    assert.equal(evidence.run_attempt, 2);
    for (const sibling of siblings) {
        const kept = evidence.jobs.find((j) => j.name === sibling.name);
        assert.deepEqual({ id: kept.id, attempt: kept.run_attempt }, { id: sibling.id, attempt: 1 }, `${sibling.name} keeps its original execution`);
    }
    assert.equal(evidence.jobs.find((j) => j.name === failing).run_attempt, 2);

    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix (recovered).'));
    const later = w.ciRun({ hoursAgo: 1 });
    assert.equal(later.plan.lanes.demo.decision, 'reuse', `demo: ${later.plan.lanes.demo.reason}`);
    assert.deepEqual({ run: later.plan.lanes.demo.evidence.run_id, attempt: later.plan.lanes.demo.evidence.run_attempt }, { run: first.id, attempt: 2 });
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: Cold/expired/corrupt cache or missing artifact
// Correct recovery or execution fallback; honest cold-start timing and no false success
// ---------------------------------------------------------------------------------------------------------------------
const damages = {
    cold: () => { /* no earlier run at all */ },
    'expired marker': (w) => { for (const a of w.state.artifacts) a.expired = true; },
    'marker older than 14 days': (w) => { for (const a of w.state.artifacts) a.created_at = at(15 * DAY); },
    'corrupt marker': (w) => { for (const a of w.state.artifacts) writeFileSync(a.file, 'not a zip at all'); },
    'marker without its download': (w) => { for (const a of w.state.artifacts) w.state.broken[a.id] = 'no-zip'; },
    'marker listed but gone': (w) => { for (const a of w.state.artifacts) w.state.broken[a.id] = 'gone'; },
    'producer run gone': (w) => { w.state.runs.clear(); },
};
for (const [kind, damage] of Object.entries(damages)) {
    test(`a ${kind}: the lanes run instead, the plan does not crash, and the verdict passes only on their fresh results`, (t) => {
        const w = world(t);
        if (kind !== 'cold') allPassedRun(w, { hoursAgo: 3 });
        damage(w);
        w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, after the damage.'));
        const ran = w.ciRun({ hoursAgo: 1 });
        for (const lane of REUSABLE) assert.equal(ran.plan.lanes[lane].decision, 'run', `${lane}: ${ran.plan.lanes[lane].reason}`);
        assert.ok(ran.plan.elapsed_ms >= 0 && Number.isInteger(ran.plan.api_calls), 'the plan reports its own time and API calls');
        assert.equal(ran.result.status, 0, ran.result.stderr);
        for (const lane of REUSABLE) assert.equal(ran.result.verdict.lanes[lane].status, 'fresh', lane);
    });
}

test('a damaged marker and failing lanes: the fallback execution decides, never the damaged evidence', (t) => {
    const w = world(t);
    allPassedRun(w, { hoursAgo: 3 });
    for (const a of w.state.artifacts) writeFileSync(a.file, 'garbage');
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, garbled.'));
    const ran = w.ciRun({ hoursAgo: 1, conclusions: { 'Demo + Playwright (chromium 1/6)': 'failure' } });
    assert.notEqual(ran.result.status, 0);
    assert.equal(ran.result.verdict.ok, false);
    assert.equal(ran.result.verdict.lanes.demo.status, 'incomplete');
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: Unrelated host metadata versus relevant runtime change
// Documented equivalence policy applied; relevance demonstrated rather than inferred from labels
// ---------------------------------------------------------------------------------------------------------------------
test('unrelated host metadata (another runner image version) on the same inputs: the documented policy reuses, and the producer\'s image stays recorded', (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 3, imageVersion: '20261103.1' });
    w.commit('SECURITY.md', '# Security\n\nReport privately.\n');
    const ran = w.ciRun({ hoursAgo: 1, imageVersion: '20261111.196' });
    for (const lane of REUSABLE) assert.equal(ran.plan.lanes[lane].decision, 'reuse', `${lane}: ${ran.plan.lanes[lane].reason}`);
    const marker = w.state.artifacts.find((a) => a.name.startsWith('ci-pass-v1-demo-') && a.workflow_run.id === green.id);
    assert.equal(evidenceOf(w, marker).runner.image_version, '20261103.1', 'the image the tests ran on is in the evidence');
});

test('a relevant runtime change (the pinned PHP base image): nothing is reused across it', (t) => {
    const w = world(t);
    allPassedRun(w, { hoursAgo: 3 });
    w.commit('demo/Dockerfile', 'FROM dunglas/frankenphp:1-php8.5@sha256:eeee\n');
    const ran = w.ciRun({ hoursAgo: 1 });
    for (const lane of REUSABLE) assert.equal(ran.plan.lanes[lane].decision, 'run', `${lane}: ${ran.plan.lanes[lane].reason}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: Missing shard, all-skipped evidence, stale/forged producer, or later contradiction
// Aggregate refuses the unsupported pass and identifies why
// ---------------------------------------------------------------------------------------------------------------------
test('a missing shard: CI result refuses the browser lane, says how many shards it had, and records no pass', (t) => {
    const w = world(t);
    const ran = w.ciRun({ hoursAgo: 1, missing: ['Demo + Playwright (chromium 6/6)'] });
    assert.notEqual(ran.result.status, 0);
    assert.equal(ran.result.verdict.lanes.demo.status, 'incomplete');
    assert.match(ran.result.verdict.lanes.demo.reason, /5 of 6/);
    assert.ok(!ran.result.recorded.some((name) => name.startsWith('ci-pass-v1-demo-')), 'no pass marker');
});

test('all-skipped evidence: a lane planned to run whose jobs were all skipped is refused, not passed', (t) => {
    const w = world(t);
    const ran = w.ciRun({ hoursAgo: 1, conclusions: Object.fromEntries([...LANE_JOBS.demo, 'Kit PHP'].map((name) => [name, 'skipped'])) });
    assert.notEqual(ran.result.status, 0);
    assert.equal(ran.result.verdict.lanes.demo.status, 'incomplete');
    assert.equal(ran.result.verdict.lanes.php.status, 'incomplete');
    assert.match(ran.result.verdict.lanes.php.reason, /skipped/);
    for (const lane of ['demo', 'php']) assert.ok(!ran.result.recorded.some((name) => name.startsWith(`ci-pass-v1-${lane}-`)), `${lane}: no pass marker`);
});

test('a stale producer (its lane ran again since and failed): the pass is not reused, and the plan says why', (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 4 });
    // Re-run all jobs on the green run: this time a Chromium shard fails, so the run's latest attempt failed the lane
    const run = w.state.runs.get(green.id);
    run.run_attempt = 2;
    run.jobs = run.jobs.map((j) => ({ ...j, id: j.id + 50000, run_attempt: 2, conclusion: j.name === 'Demo + Playwright (chromium 2/6)' ? 'failure' : j.conclusion }));
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, stale.'));
    const docs = w.ciRun({ hoursAgo: 1 });
    assert.equal(docs.plan.lanes.demo.decision, 'run');
    assert.notEqual(docs.plan.lanes.demo.reason, 'reused');
    assert.ok(docs.plan.lanes.demo.detail.length > 0, 'the refusal is explained');
    assert.match(docs.log, /^demo: run \(/m, 'the Changes job\'s log names the decision and its reason');
});

const forgeries = {
    'from another repository': (a, run) => { a.workflow_run.repository_id = 99; a.workflow_run.head_repository_id = 99; run.repository = { id: 99, full_name: 'someone/fork' }; run.head_repository = { id: 99, full_name: 'someone/fork' }; },
    'from a fork\'s head': (a, run) => { a.workflow_run.head_repository_id = 99; run.head_repository = { id: 99, full_name: 'someone/fork' }; },
    'from another workflow': (a, run) => { run.path = '.github/workflows/other.yml'; },
    'from a pull_request event': (a, run) => { run.event = 'pull_request'; },
};
for (const [kind, forge] of Object.entries(forgeries)) {
    test(`a forged producer (${kind}): its pass is not reused`, (t) => {
        const w = world(t);
        const green = allPassedRun(w, { hoursAgo: 3 });
        for (const a of w.state.artifacts) forge(a, w.state.runs.get(green.id));
        w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, forged.'));
        const docs = w.ciRun({ hoursAgo: 1 });
        for (const lane of REUSABLE) {
            assert.equal(docs.plan.lanes[lane].decision, 'run', `${lane}: ${docs.plan.lanes[lane].reason}`);
            assert.ok(docs.plan.lanes[lane].detail.length > 0, `${lane}: the refusal is explained`);
        }
    });
}

test('a forged marker naming this commit\'s fingerprint, produced on other inputs: the producer\'s own tree is recomputed and the pass refused', (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 3 });
    w.commit('kit.css', '.btn { color: green; }\n');
    const fp = JSON.parse(w.cli(['fingerprint', '--sha', w.head()]).stdout).lanes.demo;
    const genuine = w.state.artifacts.find((a) => a.name.startsWith('ci-pass-v1-demo-'));
    const evidence = evidenceOf(w, genuine);
    const file = join(w.dir, 'forged.zip');
    writeFileSync(file, zip('evidence.json', JSON.stringify({ ...evidence, fingerprint: fp })));
    w.state.artifacts.push({ ...genuine, id: 7777, name: `ci-pass-v1-demo-${fp}`, created_at: at(2), file });
    const ran = w.ciRun({ hoursAgo: 1 });
    assert.equal(ran.plan.lanes.demo.decision, 'run', `demo: ${ran.plan.lanes.demo.reason}`);
    assert.ok(ran.plan.lanes.demo.detail.length > 0);
    assert.notEqual(green.sha, w.head());
});

test('a later contradiction: a failure recorded on the same inputs after the plan reused a pass makes CI result refuse, naming it', (t) => {
    const w = world(t);
    allPassedRun(w, { hoursAgo: 5 });
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, contradicted.'));
    // the docs push plans to reuse the pass, but its CI result is held back
    const docs = w.ciRun({ hoursAgo: 2, finished: false });
    assert.equal(docs.plan.lanes.demo.decision, 'reuse');
    // meanwhile another run on the same inputs fails the browser tests
    w.ciRun({ ref: 'refs/heads/other', hoursAgo: 1.5, reuse: 'off', conclusions: { 'Demo + Playwright (chromium 5/6)': 'failure' } });
    // the docs push's CI result now runs: it checks the reused evidence again
    const late = docs.complete({ hoursAgo: 1 });
    assert.notEqual(late.status, 0, 'CI result refuses');
    const verdict = late.verdict;
    assert.equal(verdict.ok, false);
    assert.equal(verdict.lanes.demo.status, 'incomplete');
    t.diagnostic(`CI result's reason: ${verdict.lanes.demo.reason}`);
    assert.match(verdict.lanes.demo.reason, /no longer qualifies/, 'it says the reused pass no longer qualifies');
    assert.match(verdict.lanes.demo.reason, /fail/i, 'and names the failure as the reason');
    assert.match(verdict.lanes.demo.reason, /no longer qualifies/);
});

test('a later contradiction found by the plan itself: a failure on the same inputs newer than the pass stops the search', (t) => {
    const w = world(t);
    const green = allPassedRun(w, { hoursAgo: 5 });
    w.ciRun({ ref: 'refs/heads/other', hoursAgo: 3, reuse: 'off', conclusions: { 'Demo + Playwright (chromium 5/6)': 'failure' } });
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, later.'));
    const docs = w.ciRun({ hoursAgo: 1 });
    assert.equal(docs.plan.lanes.demo.decision, 'run', `demo: ${docs.plan.lanes.demo.reason}`);
    assert.ok(docs.plan.lanes.demo.detail.length > 0);
    // a lane the failing run passed is still reused from the newest pass
    assert.equal(docs.plan.lanes.php.decision, 'reuse');
    assert.notEqual(docs.plan.lanes.php.evidence.run_id, green.id, 'the newest pass is the one reused');
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: Security information or consumer dependencies change with identical source
// Declared freshness policy produces an appropriate fresh check
// ---------------------------------------------------------------------------------------------------------------------
test('identical source, consumer dependencies resolved live: a pass of the 24-hour lanes counts within a day, not after', (t) => {
    const w = world(t);
    allPassedRun(w, { hoursAgo: 25 });
    w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, a day later.'));
    const later = w.ciRun({ hoursAgo: 0.5 });
    for (const lane of DAY_LANES) assert.equal(later.plan.lanes[lane].decision, 'run', `${lane} after 25 hours: ${later.plan.lanes[lane].reason}`);
    for (const lane of ['php', 'demo', 'prod-image']) assert.equal(later.plan.lanes[lane].decision, 'reuse', `${lane}: ${later.plan.lanes[lane].reason}`);

    const v = world(t);
    allPassedRun(v, { hoursAgo: 23 });
    v.commit('CHANGELOG.md', v.read('CHANGELOG.md').replace('- A fix.', '- A fix, the same day.'));
    const sameDay = v.ciRun({ hoursAgo: 0.5 });
    for (const lane of DAY_LANES) assert.equal(sameDay.plan.lanes[lane].decision, 'reuse', `${lane} after 23 hours: ${sameDay.plan.lanes[lane].reason}`);
});

test("identical source on dev's daily run: the live-resolving lanes run fresh even with a pass minutes old, the others may be reused", (t) => {
    const w = world(t);
    allPassedRun(w, { ref: 'refs/heads/dev', hoursAgo: 0.2 });
    const daily = w.ciRun({ ref: 'refs/heads/dev', event: 'daily', hoursAgo: 0.1 });
    for (const lane of DAY_LANES) assert.equal(daily.plan.lanes[lane].decision, 'run', `${lane} on the daily run: ${daily.plan.lanes[lane].reason}`);
    for (const lane of ['php', 'demo', 'prod-image']) assert.equal(daily.plan.lanes[lane].decision, 'reuse', `${lane} on the daily run`);
    assert.equal(daily.result.status, 0, daily.result.stderr);
});

// ---------------------------------------------------------------------------------------------------------------------
// Row: Reuse-disabled full validation
// Material speed improvement with the required coverage obligations accounted for (the speed is a hosted
// measurement; the tool's part is that every obligation is run and accounted for)
// ---------------------------------------------------------------------------------------------------------------------
for (const [how, options] of [['the reuse switch off', { reuse: 'off' }], ['main', { ref: 'refs/heads/main' }]]) {
    test(`reuse disabled (${how}): no evidence is looked up, every selected lane runs in full, and each is accounted for and recorded`, (t) => {
        const w = world(t);
        allPassedRun(w, { hoursAgo: 3 });
        w.commit('CHANGELOG.md', w.read('CHANGELOG.md').replace('- A fix.', '- A fix, off.'));
        const ran = w.ciRun({ hoursAgo: 1, ...options });
        assert.equal(ran.calls.filter((c) => c.includes('/actions/artifacts')).length, 0, 'no marker lookups');
        for (const lane of REUSABLE) {
            assert.equal(ran.plan.lanes[lane].decision, 'run', lane);
            assert.match(ran.plan.lanes[lane].fingerprint, /^[0-9a-f]{64}$/, `${lane}: fingerprinted, so its markers are recorded`);
        }
        assert.equal(ran.plan.reuse, false);
        assert.equal(matrix(ran).length, CHROMIUM_SHARDS + (options.ref === 'refs/heads/main' ? 6 : 0), 'the full matrix: on main the engines too');
        assert.equal(ran.result.status, 0, ran.result.stderr);
        for (const lane of SELECTOR_LANES) assert.equal(ran.result.verdict.lanes[lane].status, 'fresh', lane);
        for (const lane of REUSABLE) assert.ok(ran.result.recorded.some((n) => n.startsWith(`ci-pass-v1-${lane}-`)), `${lane}: its pass is recorded`);
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Row: Production/package/release validation (the tool's part: the release gate's requirement)
// Consumer-facing behavior and applicable release gates remain demonstrated
// ---------------------------------------------------------------------------------------------------------------------
test('the release gate: require finds an engines pass for the head only when one verifies on its inputs', (t) => {
    const w = world(t);
    w.ciRun({ ref: 'refs/heads/dev', hoursAgo: 3, extra: ['--engines', 'true'] });
    const ok = w.cli(['require', '--lane', 'engines', '--repo', REPO, '--sha', w.head()]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    w.commit('kit.css', '.btn { color: purple; }\n');
    const none = w.cli(['require', '--lane', 'engines', '--repo', REPO, '--sha', w.head()]);
    assert.equal(none.status, 1, 'a head with other inputs has no pass');
    assert.match(none.stdout, /^engines: /m, 'and says why');
});
