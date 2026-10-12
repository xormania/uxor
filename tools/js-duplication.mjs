#!/usr/bin/env node
// Copies of code across the recipes' JavaScript: the same run of tokens (comments and spacing left out) in two places,
// in two recipes or twice in one. Logic the recipes share lives once, in an assets-only recipe's module
// (`<recipe>/assets/lib/*.js`: floating, navigation, turbo) that the others import; a copy is a second place to change.
// Two checks, Node built-ins only:
//
// - The duplicated lines of all the recipes' JavaScript stay within BUDGET, the level the kit is at: a new copy of
//   MIN_TOKENS tokens or more raises it and fails. Lower BUDGET when a change removes copies; raise it only for a copy
//   that cannot be shared, saying why in the commit.
// - No recipe declares a function or constant under a name a shared module exports (`function isPromotedFrameCache`
//   in a controller): import it instead. Short helpers are below MIN_TOKENS, so the first check would not see them.
//
//   node tools/js-duplication.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The shortest run of tokens that counts as a copy (about four lines of code). */
export const MIN_TOKENS = 40;
/** The duplicated lines the kit's recipes hold today: the ones listed by `node tools/js-duplication.mjs`. */
export const BUDGET = 36;

// after these tokens a `/` starts a regular expression, after any other a division
const BEFORE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>', '&&', '||', '??', '===', '!==', '==', '!=', 'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do']);
const PUNCTUATORS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];

/** The tokens of a module, each `{ value, line }` (1-based), without comments and spacing. */
export function tokenize(source) {
    const tokens = [];
    let line = 1;
    let i = 0;
    const push = (value, startLine) => tokens.push({ value, line: startLine });
    const skipQuoted = (quote) => {
        // from the opening quote to the closing one, escapes skipped; a template literal's `${…}` is part of it
        let j = i + 1;
        while (j < source.length && source[j] !== quote) {
            if ('\\' === source[j]) {
                j++;
            } else if ('`' === quote && '$' === source[j] && '{' === source[j + 1]) {
                let depth = 0;
                for (j++; j < source.length; j++) {
                    if ('{' === source[j]) depth++;
                    else if ('}' === source[j] && 0 === --depth) break;
                }
            }
            j++;
        }
        return j + 1;
    };
    while (i < source.length) {
        const c = source[i];
        if ('\n' === c) {
            line++;
            i++;
        } else if (/\s/.test(c)) {
            i++;
        } else if ('/' === c && '/' === source[i + 1]) {
            while (i < source.length && '\n' !== source[i]) i++;
        } else if ('/' === c && '*' === source[i + 1]) {
            const end = source.indexOf('*/', i + 2);
            const stop = -1 === end ? source.length : end + 2;
            line += (source.slice(i, stop).match(/\n/g) ?? []).length;
            i = stop;
        } else if ('"' === c || "'" === c || '`' === c) {
            const end = skipQuoted(c);
            const text = source.slice(i, end);
            push(text, line);
            line += (text.match(/\n/g) ?? []).length;
            i = end;
        } else if ('/' === c && (0 === tokens.length || BEFORE_REGEX.has(tokens[tokens.length - 1].value))) {
            // a regular expression: up to the `/` outside a character class, then its flags
            let j = i + 1;
            let inClass = false;
            for (; j < source.length && '\n' !== source[j]; j++) {
                if ('\\' === source[j]) j++;
                else if ('[' === source[j]) inClass = true;
                else if (']' === source[j]) inClass = false;
                else if ('/' === source[j] && !inClass) break;
            }
            j++;
            while (j < source.length && /[a-z]/i.test(source[j])) j++;
            push(source.slice(i, j), line);
            i = j;
        } else {
            const word = /^(?:[A-Za-z_$#][\w$]*|\d[\w.]*)/.exec(source.slice(i, i + 200));
            const value = word ? word[0] : (PUNCTUATORS.find((p) => source.startsWith(p, i)) ?? c);
            push(value, line);
            i += value.length;
        }
    }
    return tokens;
}

/**
 * The copies in `files` (`{ '<path>': '<source>' }`): every run of `minTokens` tokens or more found in two places.
 * Returns `{ lines, copies }`: the number of lines holding a token of a copy (each place counts), and per file the
 * ranges of those lines with the other files holding the same code, `{ file, from, to, alsoIn }`.
 */
export function findCopies(files, { minTokens = MIN_TOKENS } = {}) {
    const tokenized = Object.entries(files).map(([file, source]) => ({ file, tokens: tokenize(source) }));
    const places = new Map();
    for (const { file, tokens } of tokenized) {
        for (let start = 0; start + minTokens <= tokens.length; start++) {
            const key = tokens.slice(start, start + minTokens).map((token) => token.value).join('\u0000');
            if (!places.has(key)) {
                places.set(key, []);
            }
            places.get(key).push({ file, start });
        }
    }
    // per file, per line: the other files holding a copy that covers it
    const covered = new Map();
    const tokensOf = new Map(tokenized.map(({ file, tokens }) => [file, tokens]));
    for (const occurrences of places.values()) {
        // two places that do not overlap: a run repeating itself in a row is not a copy
        const distinct = occurrences.filter((place, index) => occurrences.some((other, j) => j !== index && (other.file !== place.file || Math.abs(other.start - place.start) >= minTokens)));
        for (const place of distinct) {
            const lines = covered.get(place.file) ?? new Map();
            covered.set(place.file, lines);
            const others = distinct.filter((other) => other !== place).map((other) => other.file);
            for (const token of tokensOf.get(place.file).slice(place.start, place.start + minTokens)) {
                const alsoIn = lines.get(token.line) ?? new Set();
                others.forEach((other) => alsoIn.add(other));
                lines.set(token.line, alsoIn);
            }
        }
    }
    let total = 0;
    const copies = [];
    for (const [file, lines] of [...covered].sort(([a], [b]) => a.localeCompare(b))) {
        total += lines.size;
        // a range goes on over lines without code (a comment, a blank line)
        const codeLines = [...new Set(tokensOf.get(file).map((token) => token.line))];
        let range = null;
        for (const line of [...lines.keys()].sort((a, b) => a - b)) {
            if (range && !codeLines.some((other) => other > range.to && other < line)) {
                range.to = line;
                lines.get(line).forEach((other) => range.alsoIn.add(other));
            } else {
                range = { file, from: line, to: line, alsoIn: new Set(lines.get(line)) };
                copies.push(range);
            }
        }
    }
    return { lines: total, copies: copies.map((copy) => ({ ...copy, alsoIn: [...copy.alsoIn].sort() })) };
}

/** The names a module exports with `export function`, `export const`, `export let` or `export class`. */
export function exportedNames(source) {
    return [...source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/gm)].map((match) => match[1]);
}

/** `text` as a literal inside a regular expression: every character with a meaning there escaped. */
const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * The declarations in `files` of a name that a shared module exports: `function <name>`, `const|let|var <name> =` or
 * `class <name>`, in any file but the module itself. `shared` maps each shared module's path to its source.
 */
export function findRedeclared(files, shared) {
    const problems = [];
    for (const [module, source] of Object.entries(shared)) {
        for (const name of exportedNames(source)) {
            const declaration = new RegExp(`(?:\\bfunction\\*?\\s+|\\b(?:const|let|var|class)\\s+)${escapeRegExp(name)}\\b`);
            for (const [file, code] of Object.entries(files)) {
                if (file === module) {
                    continue;
                }
                const lines = code.split('\n');
                const index = lines.findIndex((text) => !/^\s*(?:\/\/|\*|\/\*)/.test(text) && declaration.test(text));
                if (-1 !== index) {
                    problems.push(`${file}:${index + 1} declares ${name}, which ${module} exports: import it from there instead of keeping a copy.`);
                }
            }
        }
    }
    return problems;
}

/** The recipes' JavaScript, `{ '<recipe>/assets/…': '<source>' }`, and their shared modules (`<recipe>/assets/lib/`). */
export function loadRecipeScripts(root) {
    const files = {};
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !existsSync(join(root, entry.name, 'manifest.json'))) {
            continue;
        }
        const walk = (dir, relative) => {
            for (const child of readdirSync(dir, { withFileTypes: true })) {
                const path = posix.join(relative, child.name);
                if (child.isDirectory()) {
                    walk(join(dir, child.name), path);
                } else if (/\.m?js$/.test(child.name)) {
                    files[path] = readFileSync(join(dir, child.name), 'utf8');
                }
            }
        };
        if (existsSync(join(root, entry.name, 'assets'))) {
            walk(join(root, entry.name, 'assets'), `${entry.name}/assets`);
        }
    }
    const shared = Object.fromEntries(Object.entries(files).filter(([path]) => /^[^/]+\/assets\/lib\//.test(path)));
    return { files, shared };
}

/** What is wrong in the kit, a list of messages (empty when it passes), and the copies found. */
export function checkKit(root, options = {}) {
    return checkScripts(loadRecipeScripts(root), options);
}

/** The same checks on scripts as `loadRecipeScripts()` returns them. */
export function checkScripts({ files, shared }, { budget = BUDGET, minTokens = MIN_TOKENS } = {}) {
    const result = findCopies(files, { minTokens });
    const problems = findRedeclared(files, shared);
    if (result.lines > budget) {
        problems.push(
            `${result.lines} duplicated lines in the recipes' JavaScript, over the budget of ${budget} (tools/js-duplication.mjs): ` +
                'move the copy into a shared module (an assets-only recipe, see floating/README.md) and import it.',
        );
    }
    return { problems, ...result };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const { problems, lines, copies } = checkKit(fileURLToPath(new URL('..', import.meta.url)));
    for (const copy of copies) {
        console.log(`${copy.file}:${copy.from}-${copy.to} also in ${copy.alsoIn.join(', ')}`);
    }
    console.log(`${lines} duplicated lines (runs of ${MIN_TOKENS} tokens or more), budget ${BUDGET}`);
    problems.forEach((problem) => console.error(problem));
    if (problems.length) {
        process.exit(1);
    }
}
