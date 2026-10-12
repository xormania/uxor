#!/usr/bin/env node
/*
 * The monthly job's PHP coverage report (docs/TESTING.md, *Monthly job*): reads the Clover XML that PHPUnit writes
 * with the scope of tools/monthly/php-scope.php (the recipes' src/) and reports, per recipe class, the lines (Clover's
 * statements) and the methods run by the demo's PHPUnit tests, and the methods no test runs. pcov measures lines, not
 * branches.
 *
 * Usage: node tools/monthly/php-coverage.mjs --out <dir> <clover.xml>
 * Writes <dir>/php-coverage.json and <dir>/php-coverage.md (also appended to $GITHUB_STEP_SUMMARY). Exit status: 0 a
 * report, 2 no report (PHPUnit wrote none: no coverage driver, or the tests did not run), 3 a report without a measured
 * line (the driver collected nothing, or the scope is empty): never a 0% that reads as a result. 64 bad usage.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const attributes = (text) => Object.fromEntries([...text.matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
const decode = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const pct = (covered, total) => (0 === total ? null : Math.round((covered / total) * 1000) / 10);

/** Clover XML => { files: { '<recipe>/src/…php': { classes, lines, methods, neverRun } } } */
export function parseClover(xml, root) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    const files = {};
    for (const [, head, body] of xml.matchAll(/<file\s([^>]*)>([\s\S]*?)<\/file>/g)) {
        const name = decode(attributes(head).name ?? '');
        const path = name.startsWith(prefix) ? name.slice(prefix.length) : name;
        const classes = [...body.matchAll(/<class\s([^>]*)>/g)].map(([, text]) => decode(attributes(text).name));
        const metrics = [...body.matchAll(/<metrics\s([^>]*)\/>/g)].map(([, text]) => attributes(text));
        const file = metrics.find((m) => undefined !== m.loc) ?? metrics.at(-1) ?? {};
        const methods = [...body.matchAll(/<line\s([^>]*type="method"[^>]*)\/>/g)].map(([, text]) => attributes(text));
        files[path] = {
            classes,
            lines: { covered: Number(file.coveredstatements ?? 0), total: Number(file.statements ?? 0) },
            methods: { run: methods.filter((m) => Number(m.count) > 0).length, total: methods.length },
            neverRun: methods.filter((m) => 0 === Number(m.count)).map((m) => decode(m.name)),
        };
        files[path].lines.pct = pct(files[path].lines.covered, files[path].lines.total);
    }

    const values = Object.values(files);
    const sum = (pick) => values.reduce((total, value) => total + pick(value), 0);
    const totals = {
        files: values.length,
        lines: { covered: sum((v) => v.lines.covered), total: sum((v) => v.lines.total) },
        methods: { run: sum((v) => v.methods.run), total: sum((v) => v.methods.total) },
    };
    totals.lines.pct = pct(totals.lines.covered, totals.lines.total);
    totals.methods.pct = pct(totals.methods.run, totals.methods.total);

    return { driver: null, files, totals };
}

const show = (value) => (null === value ? '—' : `${value}%`);

export function markdown(result) {
    const { totals } = result;
    const out = [
        '## PHP coverage of the recipes\' src/ (PHPUnit, demo/tests)',
        '',
        `${totals.files} files${result.driver ? `, measured with ${result.driver}` : ''}. Lines: **${show(totals.lines.pct)}** (${totals.lines.covered}/${totals.lines.total}). ` +
            `Methods run: **${totals.methods.run}/${totals.methods.total}**. Branches are not measured (pcov measures lines).`,
        '',
        '| File | Class | Lines | Methods | Methods no test runs |',
        '|---|---|---:|---:|---|',
    ];
    for (const [path, value] of Object.entries(result.files).sort(([a], [b]) => a.localeCompare(b))) {
        const classes = value.classes.map((name) => `\`${name.split('\\').pop()}\``).join(', ') || '—';
        const never = value.neverRun.length ? value.neverRun.map((name) => `\`${name}\``).join(', ') : '—';
        out.push(`| \`${path}\` | ${classes} | ${show(value.lines.pct)} (${value.lines.covered}/${value.lines.total}) | ${value.methods.run}/${value.methods.total} | ${never} |`);
    }

    return `${out.join('\n')}\n`;
}

function fail(code, message) {
    console.error(`php-coverage: ${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## PHP coverage\n\n**No coverage collected:** ${message}\n`);
    }

    return code;
}

function main(argv) {
    const outIndex = argv.indexOf('--out');
    const clover = argv.filter((_, index) => index !== outIndex && index !== outIndex + 1)[0];
    if (-1 === outIndex || !argv[outIndex + 1] || !clover) {
        console.error('Usage: node tools/monthly/php-coverage.mjs --out <dir> <clover.xml>');
        return 64;
    }
    if (!existsSync(clover)) {
        return fail(2, `PHPUnit wrote no report at ${clover}: no coverage driver (pcov) loaded, or the tests did not run.`);
    }
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const result = parseClover(readFileSync(clover, 'utf8'), root.replace(/\/$/, ''));
    result.driver = process.env.COVERAGE_DRIVER || null;
    if (0 === result.totals.lines.total) {
        return fail(3, `${clover} measured no line (${result.totals.files} files): the coverage driver collected nothing, or the scope is empty.`);
    }
    const out = argv[outIndex + 1];
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'php-coverage.json'), `${JSON.stringify(result, null, 2)}\n`);
    const text = markdown(result);
    writeFileSync(join(out, 'php-coverage.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    console.log(text);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
