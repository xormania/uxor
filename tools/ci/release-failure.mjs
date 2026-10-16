#!/usr/bin/env node
// Describes the first failed release step without inventing browser counts or replay seeds.
// The workflow's verdict remains authoritative; advisory steps have a successful conclusion.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const names = {
    checkout: 'Check out the target',
    control: 'Check out the workflow tools',
    provenance: 'Verify the tested revision',
    node: 'Set up Node',
    buildx: 'Set up Buildx',
    cache: 'Name the build cache',
    image: 'Build the demo image',
    start: 'Start the demo (composer install on first start)',
    sync: 'Sync recipes into the demo',
    install: 'Install Playwright',
    prepare: 'Prepare the tests',
    tests: 'Playwright (release checks)',
    evidence: 'Release evidence',
    properties: 'PHPUnit properties (random seed)',
    results: 'Read the results',
};

export function classifyFailure(steps, reportStatus) {
    const failed = Object.keys(names).find((id) => steps[id]?.conclusion === 'failure');
    if (!failed) return { category: '', step: '' };
    let category = 'setup failure';
    if (failed === 'tests') {
        const failedTests = Number(steps.results?.outputs?.failed);
        category = reportStatus !== 'valid'
            ? 'Playwright invocation failure (report unavailable)'
            : Number.isFinite(failedTests) && failedTests > 0
                ? 'browser test failure'
                : 'Playwright run failure (no failed test reported)';
    }
    if (failed === 'evidence') category = 'incomplete release evidence';
    if (failed === 'properties') category = 'PHP property failure';
    if (failed === 'results') category = 'missing or invalid browser evidence';
    return { category, step: names[failed] };
}

function main() {
    const steps = JSON.parse(process.env.RELEASE_STEPS ?? '{}');
    if (!steps || typeof steps !== 'object' || Array.isArray(steps)) throw new Error('RELEASE_STEPS must be a step outcome object');
    const failure = classifyFailure(steps, process.env.REPORT_STATUS);
    mkdirSync('playwright-results', { recursive: true });
    writeFileSync('playwright-results/release-failure.json', `${JSON.stringify(failure, null, 2)}\n`);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `category=${failure.category}\nstep=${failure.step}\n`);
    }
    console.log(failure.category ? `${failure.category}: ${failure.step}` : 'No failed release step');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main();
    } catch (error) {
        console.error(`release-failure: ${error.message}`);
        process.exitCode = 1;
    }
}
