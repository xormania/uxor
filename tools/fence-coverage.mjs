#!/usr/bin/env node
// Every README example has a gallery page, and every recipe has one: a set difference between the sources and the
// static site, without a browser.
//
// The sources: each directory holding a manifest.json is a recipe; each block of its README.md opening at the start
// of a line with ```` ```<language> {json} ```` is an example (`{"preview":true}` shows it rendered), named after
// the heading above it as tools/kit/KitReader.php names it: the heading's slug, `default` under the title, `-2`,
// `-3`… when a name repeats. A block that looks like an example but that KitReader skips (indented, JSON that does
// not parse, `"preview"` not `true`) fails, since its page would silently be missing.
//
// With --site, check the published website's recipe links and embedded preview URLs against the README fences,
// and the runtime export's corresponding light/dark files. A scoped build checks only its side of that contract.
//
//   node tools/fence-coverage.mjs              # the README examples are well formed
//   node tools/fence-coverage.mjs --site _site # and the saved site has exactly their pages
//   node tools/fence-coverage.mjs --list       # prints <recipe>/<example> for each example
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];

const recipes = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')))
    .map((entry) => entry.name)
    .sort();

// AsciiSlugger without a locale (UnicodeString::ascii(), then every run of other characters one "-", trimmed, then
// lowercased). Accents go with NFKD; the Latin letters NFKD keeps whole are mapped as ascii() maps them. Any other
// character outside ASCII would need ICU's transliteration: only the punctuation checked to become a "-" is accepted,
// and anything else (another script, ©, €, ½…) is reported instead of guessed.
const latin = {
    ß: 'ss', ẞ: 'SS', Æ: 'AE', æ: 'ae', Ø: 'O', ø: 'o', Œ: 'OE', œ: 'oe', Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ð: 'D', ð: 'd',
    Þ: 'TH', þ: 'th', ı: 'i', Ŀ: 'L', ŀ: 'l', Ħ: 'H', ħ: 'h', Ŧ: 'T', ŧ: 't', Ŋ: 'N', ŋ: 'n', ĸ: 'q', ƒ: 'f',
};
const separators = /[\p{Zs}\p{Pd}\p{Pi}\p{Pf}…·×→✦✓°§¿«»ʼ]/gu;
function slug(text) {
    const ascii = [...text].map((char) => latin[char] ?? char).join('').normalize('NFKD').replace(/\p{M}/gu, '');
    const left = ascii.replace(separators, '-').match(/[^\x00-\x7F]/u);
    if (left) {
        return { error: `"${left[0]}"` };
    }
    return { id: ascii.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() };
}

// KitReader::getExampleBaseId(): the last heading above, outside code blocks; none, or the title: "default"
function baseId(before) {
    const prose = before.replace(/^```[\s\S]*?^```[ \t]*$/gm, '');
    const headings = [...prose.matchAll(/^(#{1,6})[ \t]+(.+)$/gm)];
    if (headings.length === 0 || headings.at(-1)[1] === '#') {
        return { id: 'default' };
    }
    const { id, error } = slug(headings.at(-1)[2]);
    return error ? { error, heading: headings.at(-1)[2] } : { id: id || 'default' };
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const examples = new Map(); // recipe => ids
const embedded = new Map(); // recipe => ids explicitly requesting a preview
for (const recipe of recipes) {
    const path = `${recipe}/README.md`;
    if (!existsSync(join(root, path))) {
        problems.push(`${recipe}: no README.md, so no recipe page.`);
        continue;
    }
    const doc = readFileSync(join(root, path), 'utf8');
    const ids = [];
    const previews = [];
    const read = new Set();
    // KitReader::getExamples()
    for (const match of doc.matchAll(/^```(\S+)[ \t]+(\{[\s\S]*?\})[ \t]*$\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)) {
        let options;
        try {
            options = JSON.parse(match[2]);
        } catch {
            options = null;
        }
        if (options === null || typeof options !== 'object') {
            continue; // reported below, as a block the demo skips
        }
        read.add(lineOf(doc, match.index));
        const { id: base, error, heading } = baseId(doc.slice(0, match.index));
        if (error) {
            problems.push(`${path}:${lineOf(doc, match.index)}: can't derive the example id of heading "${heading}" the way the demo does (${error} needs ICU's transliteration): keep example headings in Latin script.`);
            continue;
        }
        let id = base;
        for (let i = 2; ids.includes(id); i++) {
            id = `${base}-${i}`;
        }
        ids.push(id);
        if (options.preview === true) previews.push(id);
        if ('preview' in options && options.preview !== true) {
            problems.push(`${path}:${lineOf(doc, match.index)}: "preview" is ${JSON.stringify(options.preview)}: write {"preview":true}, or leave the options out for code shown as code only.`);
        }
    }
    // every block whose info string carries options or says preview, as a reader would see it
    for (const match of doc.matchAll(/^([ \t]*)(`{3,}|~{3,})([^\n`]*)$/gm)) {
        const info = match[3].trim();
        const line = lineOf(doc, match.index);
        if ((info.includes('{') || /preview/i.test(info)) && !read.has(line)) {
            problems.push(`${path}:${line}: "${match[2]}${info}" is not read as an example (KitReader needs \`\`\`<language> {"preview":true} at the start of the line, JSON that parses): it gets no gallery page.`);
        }
    }
    examples.set(recipe, ids);
    embedded.set(recipe, previews);
}
if (process.argv.includes('--list')) {
    examples.forEach((ids, recipe) => ids.forEach((id) => console.log(`${recipe}/${id}`)));
}
const count = [...examples.values()].reduce((sum, ids) => sum + ids.length, 0);

const site = process.argv.includes('--site') ? process.argv[process.argv.indexOf('--site') + 1] : null;
if (site) {
    const dir = resolve(site);
    const website = !process.argv.includes('--runtime-only');
    const runtime = !process.argv.includes('--website-only');
    const basePath = process.argv.find((arg) => arg.startsWith('--base-path='))?.slice('--base-path='.length);
    const dirs = (path) => existsSync(join(dir, path))
        ? readdirSync(join(dir, path), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        : [];
    if (website) {
        if (!existsSync(join(dir, 'index.html'))) {
            console.error(`${site}: no website index.html. Run tools/build-static.sh first.`);
            process.exit(1);
        }
        const index = readFileSync(join(dir, 'index.html'), 'utf8');
        for (const recipe of recipes) {
            const file = join(dir, 'r', recipe, 'index.html');
            if (!existsSync(file)) {
                problems.push(`${recipe}: no gallery page (${file}).`);
                continue;
            }
            if (!new RegExp(`/r/${recipe}/?["']`).test(index)) {
                problems.push(`${recipe}: the gallery's index does not link its page.`);
            }
            const frames = [...readFileSync(file, 'utf8').matchAll(/<iframe\b[^>]*?\ssrc=["']([^"']+)["']/gi)].map((match) => match[1]);
            for (const id of embedded.get(recipe) ?? []) {
                for (const theme of ['light', 'dark']) {
                    const path = `/preview/${recipe}/${id}/${theme}/`;
                    const found = frames.findIndex((src) => basePath === undefined ? src.endsWith(path) : src === basePath + path);
                    if (found < 0) problems.push(`${file}: missing preview iframe for ${path}.`);
                    else frames.splice(found, 1);
                }
            }
            for (const src of frames.filter((src) => src.includes('/preview/'))) {
                problems.push(`${file}: unexpected preview iframe for ${src}.`);
            }
        }
        for (const name of dirs('r').filter((name) => !recipes.includes(name))) {
            problems.push(`${site}/r/${name}: a gallery page for "${name}", which has no ${name}/manifest.json.`);
        }
    }
    if (runtime) {
        for (const [recipe, ids] of examples) {
            for (const id of ids) {
                for (const theme of ['light', 'dark']) {
                    if (!existsSync(join(dir, 'preview', recipe, id, theme, 'index.html'))) {
                        problems.push(`${recipe}/README.md, example "${id}": no ${theme} page (${site}/preview/${recipe}/${id}/${theme}/index.html).`);
                    }
                }
            }
        }
        for (const recipe of dirs('preview')) {
            for (const id of dirs(`preview/${recipe}`).filter((id) => !(examples.get(recipe) ?? []).includes(id))) {
                problems.push(`${site}/preview/${recipe}/${id}: a page no example of ${recipe}/README.md names (its heading's slug differs, or the example is gone).`);
            }
        }
    }
    // The website and the demo can each add navigation without changing the exporter's route
    // list. Follow both producers' links on the combined release as a browser would under Pages.
    if (website && runtime) {
        const sitemap = join(dir, 'sitemap.xml');
        const canonical = existsSync(sitemap) ? readFileSync(sitemap, 'utf8').match(/<loc>([^<]+)<\/loc>/)?.[1] : undefined;
        const rootUrl = new URL(canonical ?? `https://uxor.invalid${basePath ?? ''}/`);
        const mount = rootUrl.pathname.replace(/\/$/, '');
        const route = `${mount}/demo`;
        function checkLinks(folder) {
            for (const entry of readdirSync(folder, { withFileTypes: true })) {
                if (entry.name.startsWith('.')) continue;
                const file = join(folder, entry.name);
                if (entry.isDirectory()) {
                    if (folder !== dir || !['assets', 'website-assets', 'preview'].includes(entry.name)) checkLinks(file);
                    continue;
                }
                if (!entry.name.endsWith('.html')) continue;
                const page = new URL(relative(dir, file).split(sep).join('/').replace(/(^|\/)index\.html$/, '$1'), rootUrl);
                for (const [, href] of readFileSync(file, 'utf8').matchAll(/<a\b[^>]*?\shref=["']([^"']*)["']/gi)) {
                    if (!URL.canParse(href, page)) continue;
                    const link = new URL(href, page);
                    if (link.origin !== rootUrl.origin) continue;
                    if (mount && (link.pathname === '/demo' || link.pathname.startsWith('/demo/'))) {
                        problems.push(`${file}: demo link "${href}" falls outside the public base ${mount}.`);
                    }
                    if (link.pathname !== route && !link.pathname.startsWith(route + '/')) continue;
                    const target = join(dir, link.pathname.slice(mount.length));
                    if (!(existsSync(target) && statSync(target).isFile()) && !existsSync(join(target, 'index.html'))) {
                        problems.push(`${file}: demo link "${href}" has no exported page at ${link.pathname}.`);
                    }
                }
            }
        }
        checkLinks(dir);
    }
}

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log(`fence-coverage: ${recipes.length} recipes, ${count} README examples${site ? `, each with its pages in ${site}` : ', all read by the demo'}.`);
