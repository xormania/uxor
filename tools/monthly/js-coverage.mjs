#!/usr/bin/env node
/*
 * The monthly job's JS coverage report (docs/TESTING.md, *Monthly job*): merges the V8 coverage the browser tests
 * record with JS_COVERAGE (tests/e2e/coverage.ts), one file per test and retry, possibly from several shards, and maps
 * it to the kit's controllers, <recipe>/assets/controllers/*.js. Scripts that are not a recipe's controller (the demo's
 * own controllers) are left out; vendor and importmap packages were never recorded.
 *
 * Per controller: lines run (a line counts when its first non-blank character, outside comments, ran), functions run,
 * and its named methods that never ran in any test, the "every controller method runs once" line. A controller no test
 * loaded is reported with every method it declares as never run.
 *
 * Usage: node tools/monthly/js-coverage.mjs --out <dir> <raw dir>...
 * Writes <dir>/js-coverage.json and <dir>/js-coverage.md (also appended to $GITHUB_STEP_SUMMARY). Exit status: 0 a
 * report, 2 nothing to read (no recorded file, or no recipe controller in any of them: JS_COVERAGE was not set, or the
 * browser recorded nothing), 64 bad usage.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INTERNAL = new Set(['', '<static_initializer>', '<instance_members_initializer>']);

/** Every recipe controller of the kit at `root`: { name: 'tooltip_controller', file: 'tooltip/assets/controllers/tooltip_controller.js' } */
export function recipeControllers(root) {
    const controllers = [];
    for (const recipe of readdirSync(root, { withFileTypes: true })) {
        if (!recipe.isDirectory() || !existsSync(join(root, recipe.name, 'manifest.json'))) {
            continue;
        }
        const dir = join(root, recipe.name, 'assets/controllers');
        if (!existsSync(dir)) {
            continue;
        }
        for (const file of readdirSync(dir).filter((name) => name.endsWith('.js')).sort()) {
            controllers.push({ name: file.slice(0, -3), file: `${recipe.name}/assets/controllers/${file}` });
        }
    }

    return controllers.sort((a, b) => a.file.localeCompare(b.file));
}

/** '/assets/controllers/tooltip_controller-a_bKK47.js' (AssetMapper's 7-character digest) => 'tooltip_controller' */
export function controllerName(url) {
    const match = new URL(url).pathname.match(/\/assets\/controllers\/(.+)-[\w-]{7}\.js$/) ?? new URL(url).pathname.match(/\/assets\/controllers\/(.+)\.js$/);

    return match ? match[1] : null;
}

/**
 * Which characters of a script ran, from V8's functions of one recording: each range paints its count over the
 * ranges enclosing it (V8 nests them; the innermost one is the most precise), so they are applied outermost first.
 */
export function ranCharacters(length, functions) {
    const ranges = functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const counts = new Int8Array(length).fill(-1);
    for (const { startOffset, endOffset, count } of ranges) {
        counts.fill(count > 0 ? 1 : 0, Math.max(0, startOffset), Math.min(length, endOffset));
    }

    return counts.map((count) => (1 === count ? 1 : 0));
}

/**
 * The code lines of a source: 0-based line index => offset of its first non-blank character. Blank lines, `//` lines
 * and block comments that start a line (the controllers' doc comments) are left out; a comment after code on the same
 * line does not matter, since only the line's first character is read.
 */
export function codeLines(source) {
    const lines = new Map();
    let inBlock = false;
    let offset = 0;
    for (const [index, line] of source.split('\n').entries()) {
        let rest = line;
        let skipped = 0;
        for (;;) {
            if (inBlock) {
                const end = rest.indexOf('*/');
                if (-1 === end) {
                    rest = '';
                    break;
                }
                inBlock = false;
                skipped += end + 2;
                rest = rest.slice(end + 2);
                continue;
            }
            const lead = rest.length - rest.trimStart().length;
            if (rest.startsWith('/*', lead)) {
                inBlock = true;
                skipped += lead + 2;
                rest = rest.slice(lead + 2);
                continue;
            }
            break;
        }
        const trimmed = rest.trimStart();
        if ('' !== trimmed && !trimmed.startsWith('//')) {
            lines.set(index, offset + skipped + (rest.length - trimmed.length));
        }
        offset += line.length + 1;
    }

    return lines;
}

/** Methods a class body declares at the controllers' indentation (4 spaces), for a controller no test loaded. */
export function declaredMethods(source) {
    const names = [];
    for (const match of source.matchAll(/^ {4}(?:static\s+)?(?:async\s+)?(?:(get|set)\s+)?(#?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) {
        if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(match[2])) {
            names.push(match[1] ? `${match[1]} ${match[2]}` : match[2]);
        }
    }

    return [...new Set(names)];
}

const pct = (covered, total) => (0 === total ? null : Math.round((covered / total) * 1000) / 10);

/** Reads every recorded file below the raw dirs: [{ test, project, scripts }] */
export function readRecordings(dirs) {
    const recordings = [];
    for (const dir of dirs) {
        if (!existsSync(dir)) {
            continue;
        }
        for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.json')) {
                recordings.push(JSON.parse(readFileSync(join(entry.parentPath ?? entry.path, entry.name), 'utf8')));
            }
        }
    }

    return recordings;
}

/** The report: per recipe controller, its lines, functions and methods run, over every recording. */
export function report(root, recordings) {
    const controllers = recipeControllers(root);
    const byName = new Map(controllers.map((controller) => [controller.name, controller]));
    const scripts = new Map(); // controller file => recordings of it
    for (const recording of recordings) {
        for (const script of recording.scripts ?? []) {
            const controller = byName.get(controllerName(script.url));
            if (controller) {
                scripts.set(controller.file, [...(scripts.get(controller.file) ?? []), script]);
            }
        }
    }

    const result = { controllers: {}, totals: {}, recordings: recordings.length, notes: [] };
    for (const { file } of controllers) {
        const source = readFileSync(join(root, file), 'utf8');
        const sha256 = createHash('sha256').update(source).digest('hex');
        const lines = codeLines(source);
        const recorded = scripts.get(file) ?? [];
        if (0 === recorded.length) {
            const methods = declaredMethods(source);
            result.controllers[file] = {
                loaded: false,
                lines: { covered: 0, total: lines.size, pct: pct(0, lines.size) },
                functions: null,
                methods: { run: 0, total: methods.length },
                neverRun: methods,
            };
            continue;
        }
        // the copy the demo served must be the recipe's file, or the offsets do not map to its lines
        const matching = recorded.filter((script) => script.sha256 === sha256);
        if (matching.length !== recorded.length) {
            result.notes.push(`${file}: ${recorded.length - matching.length} of ${recorded.length} recordings served another copy (run tools/sync-demo); only the recipe's own copy is counted`);
        }
        const ran = new Uint8Array(source.length);
        const functions = new Map(); // "start:end" => { name, ran }
        for (const script of matching) {
            ranCharacters(source.length, script.functions).forEach((value, index) => {
                ran[index] |= value;
            });
            for (const fn of script.functions) {
                const [range] = fn.ranges;
                if (0 === range.startOffset && range.endOffset >= source.length) {
                    continue; // the module's top level
                }
                const key = `${range.startOffset}:${range.endOffset}`;
                const known = functions.get(key) ?? { name: fn.functionName, ran: false, line: source.slice(0, range.startOffset).split('\n').length };
                known.ran ||= range.count > 0;
                functions.set(key, known);
            }
        }
        const covered = [...lines.values()].filter((offset) => ran[offset]).length;
        const all = [...functions.values()];
        // a callback's name V8 infers from where it is passed (`target.addEventListener.once`) is no method
        const methods = all.filter((fn) => !INTERNAL.has(fn.name) && !fn.name.includes('.'));
        // a name several functions share (an object's `run: () => …` per command) gets its line
        const shared = new Set(methods.map((fn) => fn.name).filter((name, index, names) => names.indexOf(name) !== index));
        const neverRun = methods
            .filter((fn) => !fn.ran)
            .sort((a, b) => a.line - b.line)
            .map((fn) => (shared.has(fn.name) ? `${fn.name} (line ${fn.line})` : fn.name));
        result.controllers[file] = {
            loaded: matching.length > 0,
            lines: { covered: matching.length ? covered : 0, total: lines.size, pct: pct(matching.length ? covered : 0, lines.size) },
            functions: { run: all.filter((fn) => fn.ran).length, total: all.length },
            methods: { run: methods.length - neverRun.length, total: methods.length },
            neverRun: matching.length ? neverRun : declaredMethods(source),
        };
    }

    const values = Object.values(result.controllers);
    const sum = (pick) => values.reduce((total, value) => total + (pick(value) ?? 0), 0);
    result.totals = {
        controllers: values.length,
        loaded: values.filter((value) => value.loaded).length,
        lines: { covered: sum((v) => v.lines.covered), total: sum((v) => v.lines.total) },
        functions: { run: sum((v) => v.functions?.run), total: sum((v) => v.functions?.total) },
        methods: { run: sum((v) => v.methods.run), total: sum((v) => v.methods.total) },
        neverRun: sum((v) => v.neverRun.length),
    };
    result.totals.lines.pct = pct(result.totals.lines.covered, result.totals.lines.total);
    result.totals.methods.pct = pct(result.totals.methods.run, result.totals.methods.total);

    return result;
}

const show = (value) => (null === value ? '—' : `${value}%`);

export function markdown(result) {
    const { totals } = result;
    const out = [
        '## JS coverage of the kit\'s controllers (Chromium, V8)',
        '',
        `${totals.controllers} controllers, ${totals.loaded} loaded by the tests, from ${result.recordings} recorded tests. ` +
            `Lines: **${show(totals.lines.pct)}** (${totals.lines.covered}/${totals.lines.total}). ` +
            `Methods run at least once: **${totals.methods.run}/${totals.methods.total}**.`,
        '',
        0 === totals.neverRun
            ? '**Every controller method runs once:** yes, every named method ran in at least one test.'
            : `**Every controller method runs once:** no, ${totals.neverRun} never ran (listed below).`,
        '',
        '| Controller | Lines | Functions run | Methods never run |',
        '|---|---:|---:|---|',
    ];
    for (const [file, value] of Object.entries(result.controllers)) {
        const functions = value.functions ? `${value.functions.run}/${value.functions.total}` : 'not loaded';
        const never = value.neverRun.length ? value.neverRun.map((name) => `\`${name}\``).join(', ') : '—';
        out.push(`| \`${file}\` | ${show(value.lines.pct)} (${value.lines.covered}/${value.lines.total}) | ${functions} | ${never} |`);
    }
    for (const note of result.notes) {
        out.push('', `> ${note}`);
    }

    return `${out.join('\n')}\n`;
}

function main(argv) {
    const outIndex = argv.indexOf('--out');
    if (-1 === outIndex || !argv[outIndex + 1]) {
        console.error('Usage: node tools/monthly/js-coverage.mjs --out <dir> <raw dir>...');
        return 64;
    }
    const out = argv[outIndex + 1];
    const dirs = argv.filter((_, index) => index !== outIndex && index !== outIndex + 1);
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const recordings = readRecordings(dirs);
    const result = report(root, recordings);
    if (0 === recordings.length || 0 === result.totals.loaded) {
        const why = 0 === recordings.length ? `no recorded test in ${dirs.join(', ') || '(no directory given)'}` : `${recordings.length} recorded tests, none loaded a recipe controller`;
        console.error(`js-coverage: no JS coverage to report: ${why}. Were the tests run with JS_COVERAGE=<dir>, in Chromium?`);
        if (process.env.GITHUB_STEP_SUMMARY) {
            appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## JS coverage\n\n**No coverage collected:** ${why}.\n`);
        }
        return 2;
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'js-coverage.json'), `${JSON.stringify(result, null, 2)}\n`);
    const text = markdown(result);
    writeFileSync(join(out, 'js-coverage.md'), text);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    }
    console.log(text);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}

