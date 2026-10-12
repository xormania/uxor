#!/usr/bin/env node
// Fails when an icon is not from UX Icons' `flowbite` set, written in full. It reads every `<twig:ux:icon>` tag and
// `ux_icon()` call in the recipes' templates (`<recipe>/templates/`) and in the markdown (outside demo/: code blocks,
// and the prose outside inline code, as tools/docs-lint.mjs reads it), and checks the name:
//
// - a literal (`name="flowbite:search-outline"`, `ux_icon('flowbite:search-outline')`, `:name="'flowbite:…'"`) is
//   a quoted `flowbite:` name: `tabler:search`, `search-outline` or `flowbite:Search` fail;
// - a Twig expression (`name="{{ icons[variant] }}"`, `:name="_icon"`, `ux_icon(item.icon)`) only chooses between
//   names written in full, where `ux:icons:lock` finds them: it fails when it builds a name (`~`, `#{…}`, text
//   around `{{ }}` as in `flowbite:arrow-{{ dir }}-outline`), changes one with a filter other than `default`
//   (`|upper`), quotes a value that is not a `flowbite:` name written in full (`'search-outline'`, `'flowbite:'`;
//   a map's or a lookup's key and a side of a comparison are not values), or is a variable with no quoted
//   `flowbite:` name in its template or code block (Toast's `icons` map). It passes otherwise, and is listed. The
//   values of a map are not traced to the variable;
// - a tag or call without a name fails.
//
// A code block that shows what not to do says so after its language (```` ```twig do-not ````), as for docs-lint.
//
//   node tools/icon-lint.mjs            # the recipes' templates and every markdown file
//   node tools/icon-lint.mjs a.md b.twig  # these files only
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const flowbite = /^flowbite:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const problems = [];
const expressions = [];

// a quoted string at text[at] (' or "): its value and the index after it, or null
function quoted(text, at) {
    const quote = text[at];
    if (quote !== "'" && quote !== '"') {
        return null;
    }
    let i = at + 1;
    while (i < text.length && text[i] !== quote) {
        i += text[i] === '\\' ? 2 : 1;
    }
    return i < text.length ? { value: text.slice(at + 1, i), end: i + 1 } : null;
}

// a Twig expression's first argument, from text[at] up to the `,` or `)` that ends it at depth 0
function argument(text, at) {
    let depth = 0;
    let i = at;
    while (i < text.length) {
        const string = quoted(text, i);
        if (string) {
            i = string.end;
            continue;
        }
        const c = text[i];
        if ('([{'.includes(c)) {
            depth++;
        } else if (')]}'.includes(c)) {
            if (depth === 0) {
                break;
            }
            depth--;
        } else if (c === ',' && depth === 0) {
            break;
        }
        i++;
    }
    return text.slice(at, i).trim();
}

function strings(expression) {
    const found = [];
    for (let i = 0; i < expression.length; i++) {
        const string = quoted(expression, i);
        if (string) {
            found.push(string.value);
            i = string.end - 1;
        }
    }
    return found;
}

// the quoted strings of an expression that can be its value: not a map's key, a lookup's key, or a side of a comparison
function candidates(expression) {
    const found = [];
    const open = [];
    for (let i = 0; i < expression.length; i++) {
        const string = quoted(expression, i);
        if (!string) {
            const c = expression[i];
            if ('([{'.includes(c)) {
                open.push({ c, lookup: c === '[' && /[\w\])]\s*$/.test(expression.slice(0, i)) });
            } else if (')]}'.includes(c)) {
                open.pop();
            }
            continue;
        }
        const before = expression.slice(0, i);
        const after = expression.slice(string.end);
        const inside = open.at(-1);
        const key = inside?.c === '{' && /[{,]\s*$/.test(before) && /^\s*:/.test(after);
        const compared = /(?:[=!<>]=|[<>]|\b(?:in|matches|starts with|ends with|same as\())\s*$/.test(before)
            || /^\s*(?:[=!<>]=|[<>]|(?:not\s+)?in\b|matches\b|starts with\b|ends with\b)/.test(after);
        if (!key && !inside?.lookup && !compared) {
            found.push(string.value);
        }
        i = string.end - 1;
    }
    return found;
}

// an expression with its quoted strings emptied, so a `|` or `~` inside one is not read as Twig
const unquoted = (expression) => {
    let out = '';
    for (let i = 0; i < expression.length; i++) {
        const string = quoted(expression, i);
        out += string ? "''" : expression[i];
        i = string ? string.end - 1 : i;
    }
    return out;
};

// what is wrong with a name: a literal, or a Twig expression (`expression` true) read in text; null when it is fine
function fault(name, expression, text) {
    if (!expression) {
        return name === '' ? 'icon without a name' : flowbite.test(name) ? null : `icon not a flowbite: name written in full (${name})`;
    }
    if (name === '') {
        return 'icon without a name';
    }
    if (/#\{/.test(name) || /~/.test(unquoted(name))) {
        return `icon name built from parts, ux:icons:lock misses it (${name})`;
    }
    // a filter other than default changes the name ux:icons:lock found
    if (/\|\s*(?!default\b)[a-z_]/i.test(unquoted(name))) {
        return `icon name changed by a filter, ux:icons:lock misses it (${name})`;
    }
    const other = candidates(name).filter((value) => !flowbite.test(value));
    if (other.length) {
        return `icon not a flowbite: name written in full (${other.join(', ')})`;
    }
    // a variable or a lookup: the names it takes are written in full in the same template or code block
    return candidates(name).some((value) => flowbite.test(value)) || strings(text).some((value) => flowbite.test(value))
        ? null
        : `icon name from a variable, and no flowbite: name written in full beside it for ux:icons:lock to find (${name})`;
}

// file: shown path, text: what is read, line: the line number of text's first line
function check(file, text, line) {
    const at = (index) => line + text.slice(0, index).split('\n').length - 1;
    const report = (index, message, shown) => problems.push(`${file}:${at(index)}: ${message}: ${shown.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    const seen = (index, name) => expressions.push(`${file}:${at(index)}: ${name}`);

    for (const tag of text.matchAll(/<twig:ux:icon\b/g)) {
        const attribute = /\s+(:?[\w:.@-]+)(?:\s*=\s*)?/y;
        let i = tag.index + tag[0].length;
        let name = null;
        let expression = false;
        for (;;) {
            attribute.lastIndex = i;
            const match = attribute.exec(text);
            if (!match) {
                break;
            }
            i = attribute.lastIndex;
            const value = text[i - 1] === '=' || /=\s*$/.test(match[0]) ? quoted(text, i) : null;
            if (value) {
                i = value.end;
            }
            if (match[1] === 'name' || match[1] === ':name') {
                name = value ? value.value : '';
                expression = match[1] === ':name';
            }
        }
        const shown = text.slice(tag.index, text.indexOf('>', i) + 1 || i);
        if (name !== null && !expression && name.includes('{{')) {
            // name="{{ … }}" is an expression; anything around it builds a name
            const inner = name.match(/^\{\{-?([\s\S]*?)-?\}\}$/);
            [name, expression] = inner && !inner[1].includes('}}') ? [inner[1].trim(), true] : [name, true];
            if (!inner) {
                report(tag.index, `icon name built from parts, ux:icons:lock misses it (${name})`, shown);
                continue;
            }
        }
        if (expression && name.length >= 2 && quoted(name, 0)?.end === name.length) {
            // :name="'flowbite:…'" is a literal
            [name, expression] = [quoted(name, 0).value, false];
        }
        const message = fault(name ?? '', expression, text);
        if (message) {
            report(tag.index, message, shown);
        } else if (expression) {
            seen(tag.index, name);
        }
    }

    for (const call of text.matchAll(/(?<![\w.])ux_icon\(\s*/g)) {
        const start = call.index + call[0].length;
        const literal = quoted(text, start);
        const arg = argument(text, start);
        const shown = text.slice(call.index, text.indexOf(')', start + arg.length) + 1 || start + arg.length);
        const expression = !(literal && text.slice(start, literal.end).trim() === arg);
        const name = expression ? arg : literal.value;
        const message = fault(name, expression, text);
        if (message) {
            report(call.index, message, shown);
        } else if (expression) {
            seen(call.index, name);
        }
    }
}

// docs-lint's reading of a markdown file: code blocks (a markdown block as a document of its own, a do-not block
// skipped) and the prose outside inline code
const fence = /^(\s*)(`{3,}|~{3,})(.*)$/;
function scan(file, lines, offset, inner) {
    for (let i = 0; i < lines.length; i++) {
        const open = lines[i].match(fence);
        if (!open || open[2][0] === '`' && open[3].includes('`')) {
            if (!inner) {
                check(file, lines[i].replace(/(`+)[^`]*?\1/g, ''), offset + i + 1);
            }
            continue;
        }
        const [, , marks, info] = open;
        const close = new RegExp(`^\\s*${marks[0] === '`' ? '`' : '~'}{${marks.length},}\\s*$`);
        let end = i + 1;
        while (end < lines.length && !close.test(lines[end])) {
            end++;
        }
        const body = lines.slice(i + 1, end);
        const words = info.trim().split(/\s+/);
        if (/^(markdown|md)$/i.test(words[0])) {
            scan(file, body, offset + i + 1, true);
        } else if (!words.includes('do-not')) {
            check(file, body.join('\n'), offset + i + 2);
        }
        i = end;
    }
}

function walk(dir, keep) {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            return ['demo', 'node_modules', 'vendor', 'test-results', 'playwright-report', 'playwright-results'].includes(entry.name) || entry.name.startsWith('.') && entry.name !== '.github'
                ? []
                : walk(path, keep);
        }
        return keep(path) ? [path] : [];
    });
}

const recipes = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')))
    .map((entry) => entry.name);
const files = process.argv.length > 2
    ? process.argv.slice(2).map((path) => relative(root, resolve(path)))
    : [
        ...walk('', (path) => path.endsWith('.md')),
        ...recipes.filter((recipe) => existsSync(join(root, recipe, 'templates'))).flatMap((recipe) => walk(`${recipe}/templates`, (path) => path.endsWith('.twig'))),
    ];
for (const file of files.sort()) {
    if (!existsSync(join(root, file))) {
        continue;
    }
    const text = readFileSync(join(root, file), 'utf8');
    if (file.endsWith('.md')) {
        scan(file, text.split('\n'), 0, false);
    } else {
        check(file, text, 1);
    }
}

if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} problem(s). Use a name of UX Icons' flowbite set written in full, quoted (flowbite:search-outline), so ux:icons:lock finds it (FOR-AGENTS.md, *Working well*).`);
    process.exit(1);
}
console.log(`icon-lint: ${files.length} templates and markdown files show only flowbite: icons written in full; ${expressions.length} names are Twig expressions choosing between them:`);
console.log(expressions.map((line) => `  ${line}`).join('\n'));
