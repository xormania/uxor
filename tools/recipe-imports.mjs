#!/usr/bin/env node
// Each relative import in a recipe's JavaScript names a file that `ux:install <recipe>` installs: one the recipe itself
// copies, or one a recipe of its `dependencies.recipe` copies (at any depth, as the toolkit resolves them). The kit lint
// checks package imports against `npm` and `importmap`, and skips relative ones; a missing file would only show in the
// browser of an app that installed the recipe without the one shipping it (the demo copies every recipe). Paths are
// compared where `copy-files` puts them in the app, so `../lib/x.js` from `assets/controllers/` is `assets/lib/x.js`.
//
//   node tools/recipe-imports.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// static `import … from '…'`, a bare `import '…'`, `export … from '…'` and `import('…')`, with a relative path
const IMPORT = /(?:\bimport\s*(?:[\w\s{},*$]+?\s*from\s*)?|\bexport\s*(?:\*(?:\s*as\s+\w+)?|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)['"`](\.{1,2}\/[^'"`\n]+)['"`]/g;

/** The relative paths a module imports, in order. */
export function relativeImports(source) {
    // line comments out first: an import in a comment imports nothing
    const code = source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...code.matchAll(IMPORT)].map((match) => match[1]);
}

/**
 * What is wrong in a kit: a list of messages, empty when every relative import resolves. `recipes` maps each recipe
 * name to `{ recipes: [its dependencies.recipe], files: { '<path in the app>': '<content>' } }`.
 */
export function checkRecipeImports(recipes) {
    const installed = (name) => {
        const paths = new Set();
        const seen = new Set();
        const stack = [name];
        while (stack.length) {
            const current = stack.pop();
            if (seen.has(current) || !recipes[current]) {
                continue;
            }
            seen.add(current);
            Object.keys(recipes[current].files).forEach((path) => paths.add(path));
            stack.push(...recipes[current].recipes);
        }
        return paths;
    };

    const problems = [];
    for (const [name, recipe] of Object.entries(recipes)) {
        const paths = installed(name);
        for (const [path, content] of Object.entries(recipe.files)) {
            if (!/\.(m?js|ts)$/.test(path)) {
                continue;
            }
            for (const spec of relativeImports(content)) {
                const target = posix.normalize(posix.join(posix.dirname(path), spec));
                if (!paths.has(target)) {
                    problems.push(
                        `${name}: ${path} imports "${spec}" (${target}), which neither ${name} nor its recipe dependencies install: ` +
                            'add the recipe that copies it to dependencies.recipe in its manifest.json.',
                    );
                }
            }
        }
    }
    return problems;
}

/** The kit's recipes as `checkRecipeImports()` reads them: each file of each `copy-files` entry, at its path in the app. */
export function loadKit(root) {
    const recipes = {};
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const manifestPath = join(root, entry.name, 'manifest.json');
        if (!entry.isDirectory() || !existsSync(manifestPath)) {
            continue;
        }
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const files = {};
        for (const [source, destination] of Object.entries(manifest['copy-files'] ?? {})) {
            const from = join(root, entry.name, source);
            const walk = (dir, relative) => {
                for (const child of readdirSync(dir, { withFileTypes: true })) {
                    if (child.name.startsWith('.')) {
                        continue;
                    }
                    const rel = relative ? `${relative}/${child.name}` : child.name;
                    if (child.isDirectory()) {
                        walk(join(dir, child.name), rel);
                    } else {
                        files[posix.join(destination, rel)] = readFileSync(join(dir, child.name), 'utf8');
                    }
                }
            };
            if (existsSync(from) && statSync(from).isDirectory()) {
                walk(from, '');
            }
        }
        recipes[entry.name] = { recipes: manifest.dependencies?.recipe ?? [], files };
    }
    return recipes;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const problems = checkRecipeImports(loadKit(fileURLToPath(new URL('..', import.meta.url))));
    problems.forEach((problem) => console.error(problem));
    if (problems.length) {
        process.exit(1);
    }
    console.log('ok: every relative import in the recipes names a file the recipe or its recipe dependencies install');
}
