#!/usr/bin/env node
/*
 * A JUnit report turned into the failed-attempts.json that tools/ci/jev-diagnosis.mjs reads (the shape
 * tools/ci/playwright-summary.mjs writes for the browser tests): one attempt per failed or erroring test, with its test,
 * file (relative to the repository), line and message, so Jev diagnoses these failures as it does the browser shards'.
 * It reads PHPUnit's report (bin/phpunit --log-junit: Kit PHP) and Node's built-in junit reporter (node --test
 * --test-reporter=junit: Tool tests), which writes no file or line: those come from the failure's stack, the frame of
 * its cause first, and a test inside describe() or t.test() is named with its suites. It never decides pass or fail:
 * the test runner's exit status is the verdict.
 *
 * Usage: node tools/ci/junit-attempts.mjs <junit.xml> <failed-attempts.json> [--project <name>]   (default: phpunit)
 * Environment: GITHUB_WORKSPACE (the prefix removed from paths), GITHUB_SHA, GITHUB_REF_NAME (all optional).
 * Exit status 0; 1 when there is no JUnit report to read.
 * Test: node --test tools/tests/*.test.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const decode = (text) =>
    text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const attribute = (tag, name) => {
    const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return match ? decode(match[1]) : null;
};

// One element's attributes, which may hold a raw '>' (Node writes `&lt;section>`)
const ATTRIBUTES = '((?:[^>"]|"[^"]*")*?)';
// A failure or an error and its text; its message attribute may hold a raw '>' too
const PROBLEM = new RegExp(`<(failure|error)\\b${ATTRIBUTES}>([\\s\\S]*?)</\\1>`);
const TOKENS = new RegExp(`<testsuite\\b${ATTRIBUTES}(/?)>|</testsuite>|<testcase\\b${ATTRIBUTES}(?:/>|>([\\s\\S]*?)</testcase>)`, 'g');

/** A JavaScript stack frame inside the repository, as `path:line:column` once the workspace prefix is removed. */
function nodeFrame(error) {
    const cause = error.search(/^\s*cause: /m);
    for (const text of cause >= 0 ? [error.slice(cause), error] : [error]) {
        for (const [, file, line, column] of text.matchAll(/^\s*at (?:.*\()?([^\s()]+\.[cm]?[jt]s):(\d+):(\d+)\)?$/gm)) {
            if (!file.startsWith('/') && !file.startsWith('node:') && !file.includes('node_modules/')) {
                return { file, line: Number(line), column: Number(column) };
            }
        }
    }
    return null;
}

export function attemptsOf(xml, workspace = '', project = 'phpunit') {
    const prefix = workspace ? `${workspace.replace(/\/$/, '')}/` : '';
    const relative = (path) => (path && prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path);
    const attempts = [];
    const suites = [];
    let passed = 0;
    let skipped = 0;
    for (const [token, suiteOpen, selfClosed, open, body = ''] of xml.matchAll(TOKENS)) {
        if (token.startsWith('</')) {
            suites.pop();
            continue;
        }
        if (suiteOpen !== undefined) {
            if (!selfClosed) suites.push(attribute(suiteOpen, 'name') ?? '');
            continue;
        }
        const problem = body.match(PROBLEM);
        if (!problem) {
            if (/<skipped\b/.test(body)) {
                skipped++;
            } else {
                passed++;
            }
            continue;
        }
        const className = attribute(open, 'class');
        const name = attribute(open, 'name') ?? '';
        const time = Math.round(Number(attribute(open, 'time') ?? 0) * 1000);
        if (className !== null) {
            // PHPUnit: the test's class, file and line are attributes; the message starts with the test's name
            const error = decode(problem[3]).replaceAll(prefix, '').replace(/^.*::.*\n/, '').trim();
            const frame = error.match(/^([^\s:][^:\n]*\.php):(\d+)$/m);
            attempts.push({
                testId: `${className}::${name}`,
                project,
                file: relative(attribute(open, 'file')),
                line: Number(attribute(open, 'line')) || null,
                title: `${className.split('\\').at(-1)}::${name}`,
                shard: project,
                retry: 0,
                status: 'failed',
                outcome: 'failed',
                durationMs: time,
                startTime: null,
                errorLocation: frame ? { file: frame[1], line: Number(frame[2]), column: null } : null,
                error,
            });
            continue;
        }
        // Node: no file or line; the name is escaped twice (`&amp;quot;`); a file that failed to load is its own test
        const error = decode(problem[3]).replaceAll(`file://${prefix}`, '').replaceAll(prefix, '').trim();
        const frame = nodeFrame(error);
        const title = [...suites, decode(name)].join(' › ');
        const file = frame?.file ?? (/^[^/\s][^\s]*\.[cm]?[jt]s$/.test(name) ? name : null);
        attempts.push({
            testId: file ? `${file}::${title}` : title,
            project,
            file,
            line: frame?.line ?? null,
            title,
            shard: project,
            retry: 0,
            status: 'failed',
            outcome: 'failed',
            durationMs: time,
            startTime: null,
            errorLocation: frame,
            error,
        });
    }

    return { passed, skipped, attempts };
}

function main([input, output, ...rest]) {
    const project = rest[0] === '--project' ? rest[1] : rest.length ? null : 'phpunit';
    if (!input || !output || !project) {
        console.error('Usage: node tools/ci/junit-attempts.mjs <junit.xml> <failed-attempts.json> [--project <name>]');
        return 64;
    }
    if (!existsSync(input)) {
        console.error(`junit-attempts: no JUnit report at ${input} (did the tests run?)`);
        return 1;
    }
    const { passed, skipped, attempts } = attemptsOf(readFileSync(input, 'utf8'), process.env.GITHUB_WORKSPACE ?? '', project);
    writeFileSync(output, `${JSON.stringify({
        schema: 1,
        status: 'valid',
        reason: null,
        sha: process.env.GITHUB_SHA ?? null,
        ref: process.env.GITHUB_REF_NAME ?? null,
        shard: project,
        projects: [project],
        counts: { passed, failed: attempts.length, flaky: 0, skipped },
        tests: attempts.map(({ error, errorLocation, retry, startTime, ...test }) => test),
        attempts,
        globalErrors: [],
    }, null, 2)}\n`);
    console.log(`junit-attempts: ${attempts.length} failed test(s) of ${passed + skipped + attempts.length}`);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
