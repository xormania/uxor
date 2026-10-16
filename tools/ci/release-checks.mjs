#!/usr/bin/env node
/*
 * The release scheduler may check out a different revision from its own workflow. Discover that prepared checkout's
 * Playwright projects before launching the release suite: only the two known contracts below are supported. A failed
 * discovery or test run never retries another family. Remove the legacy bridge when main no longer needs it.
 *
 * Run from the target checkout, even when this script comes from a separate immutable control checkout:
 *   node tools/ci/release-checks.mjs run
 *   node tools/ci/release-checks.mjs evidence
 * run records the exact selection before executing; evidence validates it and requires all three projects and release
 * specs in the target's JSON report. Missing or unreadable evidence fails. Exit statuses from Playwright are preserved;
 * an invalid contract exits 1, bad usage 64. Tests: node --test tools/tests/release-checks.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const families = {
    current: ['release', 'release-dark', 'release-harsh'],
    legacy: ['smoke', 'smoke-dark@release', 'harsh@release'],
};
const specs = ['release.timings.spec.ts', 'release.long-session.spec.ts', 'release.fuzz.spec.ts'];
const directory = resolve('playwright-results');
const selectionFile = resolve(directory, 'release-selection.json');
const resultsFile = resolve(directory, 'results.json');
const playwright = resolve('node_modules/@playwright/test/cli.js');

function selection(family) {
    return { schema: 1, family, projects: families[family], specs, grep: family === 'legacy' ? '@release' : null };
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
    for (const [family, projects] of Object.entries(families)) {
        const expected = projects.filter((name) => name !== 'smoke');
        if (projects.every((name) => names.includes(name)) && releaseNames.length === expected.length && releaseNames.every((name) => expected.includes(name))) {
            return selection(family);
        }
    }
    throw new Error(`unknown, partial or mixed release project family: ${names.join(', ') || '(none)'}`);
}

function readSelection() {
    const saved = JSON.parse(readFileSync(selectionFile, 'utf8'));
    if (!saved || !Object.hasOwn(families, saved.family)) {
        throw new Error('release selection has no supported family');
    }
    const expected = selection(saved.family);
    if (Object.keys(saved).sort().join(',') !== Object.keys(expected).sort().join(',') ||
        Object.keys(expected).some((key) => JSON.stringify(saved[key]) !== JSON.stringify(expected[key]))) {
        throw new Error('release selection does not match the complete supported contract');
    }
    return saved;
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
    writeFileSync(selectionFile, `${JSON.stringify(chosen, null, 2)}\n`);
    console.log(`Release selection: ${chosen.family} (${chosen.projects.join(', ')})`);
    const args = ['test', ...chosen.projects.map((project) => `--project=${project}`), '--workers=1', '--reporter=list,html,json'];
    if (chosen.grep) args.push('--grep', chosen.grep);
    return status(spawnSync(process.execPath, [playwright, ...args], {
        env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: resultsFile, PLAYWRIGHT_HTML_OPEN: 'never' }, stdio: 'inherit',
    }));
}

function evidence() {
    const chosen = readSelection();
    const args = [
        resolve('tools/ci/release-evidence.mjs'),
        ...chosen.projects.flatMap((project) => ['--project', project]),
        ...chosen.specs.flatMap((spec) => ['--spec', spec]),
        resultsFile,
    ];
    return status(spawnSync(process.execPath, args, { stdio: 'inherit' }));
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
