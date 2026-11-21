#!/usr/bin/env node
/*
 * The release checks' structural evidence (docs/TESTING.md, *Release checks*): a Playwright run can exit 0 having run
 * only part of the suite (a project left out, a release spec skipped), so the release job checks, from the JSON
 * report, that each required project ran at least one test and each release spec skipped none. The release runner also
 * supplies its discovered selection, in which every case must appear exactly once with a passed attempt.
 *
 * Usage: node tools/ci/release-evidence.mjs --project <name>... --spec <file>... <results.json>
 * Exit status 0 when complete; 1 naming each gap, or when the report is missing or unreadable; 64 on bad usage.
 * Test: node --test tools/tests/*.test.mjs
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The project, source file and nested title identify the same case in discovery and execution. */
export function testsOf(report) {
    const tests = [];
    const walk = (suite, titles) => {
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                const project = test.projectName ?? '';
                const path = spec.file ?? suite.file ?? '';
                const title = spec.title;
                tests.push({
                    project, path, file: basename(path), status: test.status,
                    key: project && path && typeof title === 'string' && title ? JSON.stringify([project, path, ...titles, title]) : null,
                    passed: Array.isArray(test.results) && test.results.some((attempt) => attempt.status === 'passed'),
                });
            }
        }
        for (const child of suite.suites ?? []) walk(child, child.title ? [...titles, child.title] : titles);
    };
    for (const suite of report.suites ?? []) walk(suite, []);
    return tests;
}

/** The gaps in the evidence, in words; none when every required project and release spec ran as asked. */
export function evidence(report, { projects = [], specs = [], selection } = {}) {
    const tests = testsOf(report);
    const ran = (test) => 'skipped' !== test.status;
    const gaps = [];
    for (const project of projects) {
        if (!tests.some((test) => test.project === project && ran(test))) {
            gaps.push(`project ${project} ran no test`);
        }
    }
    for (const spec of specs) {
        const own = tests.filter((test) => test.file === spec);
        const skipped = own.filter((test) => !ran(test)).length;
        if (!own.some(ran)) {
            gaps.push(`${spec} ran no test`);
        } else if (skipped) {
            gaps.push(`${spec} skipped ${skipped} test${1 === skipped ? '' : 's'}`);
        }
    }
    if (selection) {
        const expected = new Set(selection);
        const executed = new Map();
        for (const test of tests) {
            if (!expected.has(test.key)) {
                gaps.push(`unexpected case: ${test.key ?? test.path}`);
            } else if (executed.has(test.key)) {
                gaps.push(`duplicate case: ${test.key}`);
            }
            executed.set(test.key, test);
        }
        for (const key of expected) {
            const test = executed.get(key);
            if (!test) gaps.push(`missing case: ${key}`);
            else if (!test.passed || !['expected', 'flaky'].includes(test.status)) gaps.push(`case did not complete successfully: ${key}`);
        }
    }
    return gaps;
}

function main(argv) {
    const required = { projects: [], specs: [] };
    let file = null;
    for (let i = 0; i < argv.length; i++) {
        if (['--project', '--spec'].includes(argv[i]) && undefined !== argv[i + 1]) {
            required[`${argv[i].slice(2)}s`].push(argv[++i]);
        } else if (!argv[i].startsWith('--') && null === file) {
            file = argv[i];
        } else {
            console.error('Usage: node tools/ci/release-evidence.mjs --project <name>... --spec <file>... <results.json>');
            return 64;
        }
    }
    if (null === file) {
        console.error('Usage: node tools/ci/release-evidence.mjs --project <name>... --spec <file>... <results.json>');
        return 64;
    }
    let report;
    try {
        report = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        console.log(`::error::No release evidence: ${file} is missing or unreadable (${error.message})`);
        return 1;
    }
    const gaps = evidence(report, required);
    for (const gap of gaps) {
        console.log(`::error::Incomplete release checks: ${gap}`);
    }
    if (!gaps.length) {
        console.log(`Release evidence complete: ${required.projects.join(', ')} ran, and ${required.specs.join(', ')} ran without a skip`);
    }
    return gaps.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
