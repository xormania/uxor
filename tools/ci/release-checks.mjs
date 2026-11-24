#!/usr/bin/env node
/*
 * The release scheduler may check out a different revision from its own workflow. Discover that prepared checkout's
 * Playwright projects before launching the release suite: only the exact project set below is supported, and a failed
 * discovery or test run never retries a smaller suite.
 *
 * Run from the target checkout, even when this script comes from a separate immutable control checkout:
 *   node tools/ci/release-checks.mjs run
 *   node tools/ci/release-checks.mjs evidence
 * RELEASE_LANE=release|dark|harsh partitions the three projects for independent hosted jobs. The release lane has
 * one worker (isolated measurements); the behavior lanes have two. Without it, run the whole suite serially.
 * run records the exact selection before executing; evidence derives its required contract from the caller's lane,
 * using this control checkout's checker. Missing or unreadable evidence fails.
 * Exit statuses from Playwright are preserved;
 * an invalid contract exits 1, bad usage 64. Tests: node --test tools/tests/release-checks.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidence as reportGaps, testsOf } from './release-evidence.mjs';

const projects = ['release', 'release-dark', 'release-harsh'];
const specs = ['release.timings.spec.ts', 'release.long-session.spec.ts', 'release.fuzz.spec.ts'];
// Required change-sensitive files per project, independent of the target checkout's Playwright config.
const roster = {
    release: specs,
    'release-dark': [
        'lab.overlays', 'dropdown', 'lab.popover', 'popover', 'lab.tooltip', 'lab.live-modal', 'lab.live-drawer',
        'lab.editor', 'editor', 'lab.markdown-editor', 'markdown-editor',
    ].map((name) => `${name}.spec.ts`),
    'release-harsh': [
        'lab.data-table-frame', 'lab.data-table-live', 'lab.editor', 'lab.date-picker', 'date-picker', 'lab.autocomplete', 'chart', 'lab.chart',
    ].map((name) => `${name}.spec.ts`),
};
const directory = resolve('playwright-results');
const selectionFile = resolve(directory, 'release-selection.json');
const resultsFile = resolve(directory, 'results.json');
const playwright = resolve('node_modules/@playwright/test/cli.js');

function lane() {
    const value = process.env.RELEASE_LANE ?? 'all';
    if (!['all', 'release', 'dark', 'harsh'].includes(value)) throw new Error(`unknown release lane: ${value}`);
    return value;
}

function selection(part = 'all') {
    if (part === 'all') return { schema: 4, lane: part, projects, specs };
    return { schema: 4, lane: part, projects: [projects[['release', 'dark', 'harsh'].indexOf(part)]], specs: part === 'release' ? specs : [] };
}

function discover(report) {
    if (!report || !Array.isArray(report.config?.projects) || !Array.isArray(report.suites) || report.errors?.length) {
        throw new Error('discovery did not produce a complete Playwright project list');
    }
    const names = report.config.projects.map((project) => project?.name);
    if (names.some((name) => typeof name !== 'string' || !name) || new Set(names).size !== names.length) {
        throw new Error('discovery returned invalid or duplicate project names');
    }
    const releaseNames = names.filter((name) => name.includes('release'));
    if (releaseNames.length === projects.length && projects.every((name) => releaseNames.includes(name))) {
        return selection(lane());
    }
    throw new Error(`unknown, partial or mixed release projects: ${names.join(', ') || '(none)'}`);
}

function readSelection() {
    const content = readFileSync(selectionFile, 'utf8');
    const digest = process.env.RELEASE_SELECTION_SHA256;
    if ((digest !== undefined || process.env.GITHUB_ACTIONS === 'true') && sha256(content) !== digest) {
        throw new Error('saved release selection differs from the case list recorded before the run');
    }
    const { tests, ...saved } = JSON.parse(content);
    // The caller's lane is authority: a saved selection cannot narrow the evidence this job must provide.
    const expected = selection(lane());
    if (Object.keys(saved).sort().join(',') !== Object.keys(expected).sort().join(',') ||
        Object.keys(expected).some((key) => JSON.stringify(saved[key]) !== JSON.stringify(expected[key]))) {
        throw new Error('release selection does not match the complete supported contract');
    }
    const cases = Array.isArray(tests) && tests.map((key) => {
        const parts = typeof key === 'string' && JSON.parse(key);
        if (!Array.isArray(parts) || parts.length < 3 || parts.some((part) => typeof part !== 'string' || !part)) {
            throw new Error('release selection has an invalid case identity');
        }
        return { key, project: parts[0], path: parts[1] };
    });
    verifyRoster(saved, cases);
    return { ...saved, tests };
}

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

function verifyRoster(chosen, cases) {
    if (!Array.isArray(cases) || cases.some((test) => !test.key || !chosen.projects.includes(test.project))
        || new Set(cases.map((test) => test.key)).size !== cases.length) {
        throw new Error('release selection has missing, malformed, duplicate or unexpected case identities');
    }
    for (const project of chosen.projects) {
        const files = new Set(cases.filter((test) => test.project === project).map((test) => test.path));
        if (!files.size) throw new Error(`project ${project} selected no tests`);
        for (const name of roster[project]) {
            if (!files.has(`tests/e2e/${name}`)) throw new Error(`project ${project} did not select tests/e2e/${name}`);
        }
    }
}

function status(child) {
    if (child.error || child.signal) {
        console.error(`Release checks could not complete: ${child.error?.message ?? `terminated by ${child.signal}`}`);
    }
    return child.status ?? 1;
}

function run() {
    mkdirSync(directory, { recursive: true });
    rmSync(selectionFile, { force: true });
    rmSync(resultsFile, { force: true });
    const env = { ...process.env, RELEASE_CHECKS: '1' };
    // Keep the runner's step outputs for the case selection witness, outside Playwright's environment.
    delete env.GITHUB_OUTPUT;
    // Discovery must write JSON to stdout, regardless of the caller's reporter output environment.
    for (const key of ['PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'PLAYWRIGHT_JSON_OUTPUT_NAME']) {
        delete env[key];
    }
    // JSON retains every configured project even with a file filter. Keep discovery to these specs rather than
    // importing the entire behavior inventory; the actual suite launch below has no file filter. Anchor the basename
    // so a checkout directory containing "release" cannot turn this preflight into a full discovery.
    const listing = spawnSync(process.execPath, [playwright, 'test', '/release\\.[^/]*\\.spec\\.ts$', '--list', '--reporter=json'], {
        env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (listing.stderr) process.stderr.write(listing.stderr);
    if (listing.status !== 0) {
        if (listing.stdout) process.stdout.write(listing.stdout);
        return status(listing);
    }
    let chosen;
    try {
        chosen = discover(JSON.parse(listing.stdout));
    } catch (error) {
        if (listing.stdout) process.stdout.write(listing.stdout);
        throw new Error(`Release discovery failed: ${error.message}`);
    }
    const selectedProjects = chosen.projects.map((project) => `--project=${project}`);
    const selected = spawnSync(process.execPath, [playwright, 'test', ...selectedProjects, '--list', '--reporter=json'], {
        env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (selected.stderr) process.stderr.write(selected.stderr);
    if (selected.status !== 0) {
        if (selected.stdout) process.stdout.write(selected.stdout);
        return status(selected);
    }
    const report = JSON.parse(selected.stdout);
    if (!Array.isArray(report.suites) || report.errors?.length) throw new Error('discovery did not produce a complete release test list');
    const cases = testsOf(report);
    verifyRoster(chosen, cases);
    const content = `${JSON.stringify({ ...chosen, tests: cases.map((test) => test.key) }, null, 2)}\n`;
    writeFileSync(selectionFile, content);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `selection-sha256=${sha256(content)}\n`);
    console.log(`Release selection: ${chosen.projects.join(', ')}, ${cases.length} tests`);
    const workers = ['dark', 'harsh'].includes(lane()) ? 2 : 1;
    const args = ['test', ...selectedProjects, `--workers=${workers}`, '--reporter=list,html,json'];
    return status(spawnSync(process.execPath, [playwright, ...args], {
        env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: resultsFile, PLAYWRIGHT_HTML_OPEN: 'never' }, stdio: 'inherit',
    }));
}

function evidence() {
    const chosen = readSelection();
    let report;
    try {
        report = JSON.parse(readFileSync(resultsFile, 'utf8'));
    } catch (error) {
        console.log(`::error::No release evidence: ${resultsFile} is missing or unreadable (${error.message})`);
        return 1;
    }
    const gaps = reportGaps(report, { projects: chosen.projects, specs: chosen.specs, selection: chosen.tests });
    for (const gap of gaps) console.log(`::error::Incomplete release checks: ${gap}`);
    if (!gaps.length) console.log(`Release evidence complete: all ${chosen.tests.length} selected cases ran without a skip`);
    return gaps.length ? 1 : 0;
}

function main(argv) {
    if (argv.length !== 1 || !['run', 'evidence'].includes(argv[0])) {
        console.error('Usage: node tools/ci/release-checks.mjs <run|evidence> (from the target checkout)');
        return 64;
    }
    try {
        return argv[0] === 'run' ? run() : evidence();
    } catch (error) {
        console.error(`Release checks failed: ${error.message}`);
        return 1;
    }
}

process.exitCode = main(process.argv.slice(2));
