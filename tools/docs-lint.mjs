#!/usr/bin/env node
// Fails when the repository's markdown teaches what the kit exists to prevent. In every code block of every
// markdown file (outside demo/), and in the prose outside inline code, it looks for:
//
// - Flowbite's JavaScript: `initFlowbite`, `import 'flowbite'`, `from 'flowbite'`, a `flowbite(.min).js` file;
// - palette colors: a color utility (`bg-`, `text-`, `border-`, `ring-`, `fill-`…) naming a color of Tailwind's
//   palette (tailwindcss/theme.css, as tools/contrast/check.mjs reads it) that is not one of the theme's roles
//   (kit.css): `bg-blue-700` and `text-white` fail, `bg-brand`, `text-fg-danger-strong` and `text-fg-on-brand` pass;
// - `dark:` color overrides (`dark:bg-…`, `dark:text-…`): the roles already switch with the theme;
// - inline event handlers (`onclick="…"`, any `on…=` attribute) and `style="…"` attributes.
//
// The recipes' templates (`<recipe>/templates/**/*.twig`) are checked for palette colors too, every line: a recipe
// colors through the roles, text on a solid fill through `fg-on-*`.
//
// Inline code is where the rules quote what they forbid ("never `bg-blue-700`"), so it is not read. A code block
// that shows what not to do says so in its info string, after the language: ```` ```twig do-not ````. A
// `markdown` block is read as a document of its own (its code blocks are checked, its prose is not).
//
//   node tools/docs-lint.mjs            # every markdown file and recipe template
//   node tools/docs-lint.mjs a.md b.md  # these files only (a .twig file is read as a template)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const colors = (css) => new Set([...css.matchAll(/--color-([\w-]+)\s*:/g)].map((match) => match[1]));
const roles = colors(readFileSync(join(root, 'kit.css'), 'utf8'));
const palette = [...colors(readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8'))]
    .filter((name) => !roles.has(name))
    // longest first, so `blue-700` is matched before a shorter name could be
    .sort((a, b) => b.length - a.length);
const utilities = 'bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|decoration|accent|caret|shadow|inset-shadow|placeholder';

const paletteRule = ['palette color, use a theme role', new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${utilities})-(?:${palette.join('|')})(?:/\\d+)?(?![\\w-])`)];
const rules = [
    ['Flowbite JavaScript', /initFlowbite|\bimport\s+['"]flowbite['"]|\bfrom\s+['"]flowbite['"]|\brequire\(\s*['"]flowbite['"]\s*\)|flowbite(?:\.min)?\.js\b/],
    paletteRule,
    ['dark: color override, roles switch with the theme', new RegExp(`(?<![\\w-])dark:(?:${utilities})-`)],
    ['inline event handler, use a Stimulus action', /(?<![\w.$-])on[a-zA-Z]{3,}\s*=\s*["'{]/],
    ['style attribute, use classes', /(?<![\w.$-])style\s*=\s*["'{]/],
];

const fence = /^(\s*)(`{3,}|~{3,})(.*)$/;
const problems = [];

// text: what is checked, shown: the line as written, only: the rules to apply
function check(file, line, text, shown = text, only = rules) {
    for (const [label, pattern] of only) {
        const found = [...new Set([...text.matchAll(new RegExp(pattern, 'g'))].map((match) => match[0].trim()))];
        if (found.length) {
            problems.push(`${file}:${line}: ${label} (${found.join(', ')}): ${shown.trim().slice(0, 120)}`);
        }
    }
}

// lines: the file's lines, offset: the line number of lines[0] minus 1; inner: inside a markdown block
function scan(file, lines, offset, inner) {
    for (let i = 0; i < lines.length; i++) {
        const open = lines[i].match(fence);
        // a backtick fence's info string has no backtick (CommonMark): "```` ```twig ````" is inline code
        if (!open || open[2][0] === '`' && open[3].includes('`')) {
            if (!inner) {
                // prose: raw HTML is markup, inline code is quoted
                check(file, offset + i + 1, lines[i].replace(/(`+)[^`]*?\1/g, ''), lines[i]);
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
            body.forEach((text, index) => check(file, offset + i + index + 2, text));
        }
        i = end;
    }
}

function markdownFiles(dir) {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            return ['demo', 'node_modules', 'vendor', 'test-results', 'playwright-report', 'playwright-results'].includes(entry.name) || entry.name.startsWith('.') && entry.name !== '.github'
                ? []
                : markdownFiles(path);
        }
        return entry.name.endsWith('.md') ? [path] : [];
    });
}

// every .twig file below <recipe>/templates/, for each directory with a manifest.json
function templateFiles() {
    const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
        .flatMap((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith('.twig') ? [`${dir}/${entry.name}`] : []);
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')) && existsSync(join(root, entry.name, 'templates')))
        .flatMap((entry) => walk(`${entry.name}/templates`));
}

const files = process.argv.length > 2 ? process.argv.slice(2).map((path) => relative(root, join(process.cwd(), path))) : [...markdownFiles(''), ...templateFiles()];
for (const file of files.sort()) {
    if (!existsSync(join(root, file))) {
        continue;
    }
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    if (file.endsWith('.twig')) {
        lines.forEach((text, index) => check(file, index + 1, text, text, [paletteRule]));
    } else {
        scan(file, lines, 0, false);
    }
}

if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} problem(s). Fix the template or the example, or mark a block that shows what not to do with \`do-not\` after its language (CONTRIBUTING.md, *Docs*).`);
    process.exit(1);
}
const templates = files.filter((file) => file.endsWith('.twig')).length;
console.log(`docs-lint: ${files.length - templates} markdown files teach no Flowbite JavaScript, palette color, dark: override or inline handler or style; ${templates} recipe templates use no palette color.`);
