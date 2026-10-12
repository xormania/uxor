#!/usr/bin/env node
/*
 * The monthly job's mutation testing report (docs/TESTING.md, *Monthly job*): reads Infection's JSON log (the scope of
 * tools/monthly/php-scope.php, the recipes' src/) and reports the MSI, the counts and every surviving mutant (escaped:
 * the tests passed with the code changed; not covered: no test runs that line), each with its place and diff.
 * Report-only: a low score does not fail it.
 *
 * Usage: node tools/monthly/infection.mjs --out <dir> <infection.json>
 * Writes <dir>/infection-summary.json, <dir>/survivors.md (every survivor) and <dir>/infection.md (the summary, at most
 * 50 survivors, also appended to $GITHUB_STEP_SUMMARY). Exit status: 0 a report, 2 no log (Infection did not run to
 * the end), 3 an invalid log or no mutant generated (nothing was tested). 64 bad usage.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SUMMARY_LIMIT = 50;

/** Infection's log => { stats, survivors: [{ status, file, line, mutator, diff }] } */
export function summarize(log, root) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    const relative = (path) => (path?.startsWith(prefix) ? path.slice(prefix.length) : path);
    const survivor = (status) => (mutant) => ({
        status,
        file: relative(mutant.mutator?.originalFilePath),
        line: mutant.mutator?.originalStartLine,
        mutator: mutant.mutator?.mutatorName,
        diff: (mutant.diff ?? '').trim(),
    });
    const survivors = [...(log.escaped ?? []).map(survivor('escaped')), ...(log.uncovered ?? []).map(survivor('not covered'))].sort(
        (a, b) => `${a.file}`.localeCompare(`${b.file}`) || a.line - b.line || `${a.mutator}`.localeCompare(`${b.mutator}`),
    );
    const s = log.stats;

    return {
        stats: {
            total: s.totalMutantsCount,
            killed: s.killedCount + (s.killedByStaticAnalysisCount ?? 0),
            escaped: s.escapedCount,
            notCovered: s.notCoveredCount,
            timedOut: s.timeOutCount,
            errors: s.errorCount + (s.syntaxErrorCount ?? 0),
            skipped: (s.skippedCount ?? 0) + (s.ignoredCount ?? 0),
            msi: s.msi,
            coveredMsi: s.coveredCodeMsi,
            mutationCodeCoverage: s.mutationCodeCoverage,
        },
        survivors,
        byFile: Object.fromEntries(
            Object.entries(Object.groupBy(survivors, (m) => m.file)).map(([file, list]) => [file, list.length]).sort(([a], [b]) => a.localeCompare(b)),
        ),
    };
}

const block = (m) => [`#### \`${m.file}:${m.line}\` ${m.mutator} (${m.status})`, '', '```diff', m.diff, '```', ''].join('\n');

export function markdown(result, limit = SUMMARY_LIMIT) {
    const { stats, survivors } = result;
    const out = [
        '## Mutation testing of the recipes\' src/ (Infection)',
        '',
        `MSI **${stats.msi}%**, covered code MSI **${stats.coveredMsi}%**, mutation code coverage ${stats.mutationCodeCoverage}%. ` +
            `${stats.total} mutants: ${stats.killed} killed, **${stats.escaped} escaped**, ${stats.notCovered} not covered, ` +
            `${stats.timedOut} timed out, ${stats.errors} errors, ${stats.skipped} skipped. Report-only: no threshold.`,
        '',
    ];
    if (0 === survivors.length) {
        out.push('No surviving mutant.');
    } else {
        out.push('| File | Survivors |', '|---|---:|', ...Object.entries(result.byFile).map(([file, count]) => `| \`${file}\` | ${count} |`), '');
        out.push(`### Surviving mutants${survivors.length > limit ? ` (the first ${limit} of ${survivors.length}; all in survivors.md)` : ''}`, '');
        out.push(...survivors.slice(0, limit).map(block));
    }

    return `${out.join('\n')}\n`;
}

function fail(code, message) {
    console.error(`infection: ${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Mutation testing\n\n**No result:** ${message}\n`);
    }

    return code;
}

function main(argv) {
    const outIndex = argv.indexOf('--out');
    const logFile = argv.filter((_, index) => index !== outIndex && index !== outIndex + 1)[0];
    if (-1 === outIndex || !argv[outIndex + 1] || !logFile) {
        console.error('Usage: node tools/monthly/infection.mjs --out <dir> <infection.json>');
        return 64;
    }
    if (!existsSync(logFile)) {
        return fail(2, `no Infection log at ${logFile}: Infection did not run to the end (see its step's log).`);
    }
    let log;
    try {
        log = JSON.parse(readFileSync(logFile, 'utf8'));
    } catch (error) {
        return fail(3, `${logFile} is not valid JSON (${error.message}).`);
    }
    if (!log?.stats || !(log.stats.totalMutantsCount > 0)) {
        return fail(3, `${logFile} holds no mutant: nothing was mutation-tested.`);
    }
    const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
    const result = summarize(log, root);
    const out = argv[outIndex + 1];
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'infection-summary.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(out, 'survivors.md'), markdown(result, Infinity));
    const text = markdown(result);
    writeFileSync(join(out, 'infection.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    console.log(text.split('\n').slice(0, 4 + Object.keys(result.byFile).length + 4).join('\n'));

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
