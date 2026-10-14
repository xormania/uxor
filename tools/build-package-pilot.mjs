#!/usr/bin/env node
/** Assemble one distribution from the existing canonical recipes; never maintain a second table implementation. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const recipes = ['data-table', 'table', 'pagination', 'input', 'select', 'button', 'empty-state', 'turbo', 'theme'];
const controller = 'xormania--uxor-pilot--data-table';

function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Pilot sources must not be symlinks: ${path}`);
        return entry.isDirectory() ? files(path) : [path];
    }).sort();
}

export function buildPackage(output, repository = root) {
    output = resolve(output);
    if (existsSync(output)) throw new Error('Choose a new output directory; the pilot never overwrites an existing tree.');
    const selected = new Set(recipes);
    for (const recipe of recipes) {
        const manifest = JSON.parse(readFileSync(join(repository, recipe, 'manifest.json'), 'utf8'));
        for (const dependency of manifest.dependencies?.recipe ?? []) {
            if (!selected.has(dependency)) throw new Error(`Unpackaged recipe dependency: ${recipe} -> ${dependency}`);
        }
    }
    const templates = recipes.flatMap((recipe) => {
        const directory = join(repository, recipe, 'templates/components');
        return existsSync(directory) ? files(directory).map((path) => ({ path, name: relative(directory, path).replace(/\.html\.twig$/, '').replaceAll('/', ':') })) : [];
    });
    const names = new Set(templates.map(({ name }) => name));
    if (names.size !== templates.length) throw new Error('Two recipes declare the same component.');

    // Validate this bounded source format before making a directory. This is not a general Twig/PHP codemod.
    const rendered = templates.map(({ path }) => {
        let source = readFileSync(path, 'utf8');
        source = source.replace(/(<\/?twig:)([A-Za-z][\w:]*)/g, (match, opening, name) => {
            if (name === 'ux:icon') return match;
            if (!names.has(name)) throw new Error(`Unpackaged component ${name} in ${path}`);
            return `${opening}UXor:${name}`;
        });
        source = source.replaceAll('flowbite:', 'uxor-pilot:');
        if (path.endsWith('/DataTable.html.twig')) {
            source = source.replaceAll('App\\\\UXor\\\\DataTable', 'UXor\\\\Pilot\\\\DataTable');
            for (const [needle, replacement, expected] of [
                ["'data-controller': 'data-table'", `'data-controller': '${controller}'`, 1],
                ['->data-table#', `->${controller}#`, 4],
                ['data-data-table-target=', `data-${controller}-target=`, 1],
            ]) {
                if (source.split(needle).length - 1 !== expected) throw new Error(`Controller format changed: ${needle}`);
                source = source.replaceAll(needle, replacement);
            }
        }
        return { path, source };
    });

    const records = [];
    const copy = (from, to, source = readFileSync(from)) => {
        const target = join(output, to);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, source);
        records.push({ source: relative(repository, from), target: to, sha256: createHash('sha256').update(readFileSync(from)).digest('hex') });
    };
    mkdirSync(output, { recursive: true });
    cpSync(join(repository, 'packages/uxor-pilot'), output, { recursive: true });
    for (const { path, source } of rendered) {
        const recipe = relative(repository, path).split('/')[0];
        copy(path, relative(join(repository, recipe), path), source);
    }
    for (const path of files(join(repository, 'data-table/src/UXor/DataTable'))) {
        const source = readFileSync(path, 'utf8');
        if (!source.includes('namespace App\\UXor\\DataTable;')) throw new Error(`Unexpected PHP namespace in ${path}`);
        copy(path, `src/DataTable/${relative(join(repository, 'data-table/src/UXor/DataTable'), path)}`, source.replaceAll('App\\UXor\\DataTable', 'UXor\\Pilot\\DataTable').replaceAll('<twig:DataTable', '<twig:UXor:DataTable'));
    }
    for (const [from, to] of [
        ['data-table/assets/controllers/data_table_controller.js', 'assets/controllers/data_table_controller.js'],
        ['turbo/assets/lib/uxor-turbo.js', 'assets/lib/uxor-turbo.js'],
        ['theme/assets/styles/uxor.css', 'assets/styles/uxor.css'],
        ['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'],
    ]) copy(join(repository, from), to);
    for (const name of ['arrow-up-outline', 'arrow-down-outline', 'chevron-left-outline', 'chevron-right-outline', 'inbox-outline']) {
        copy(join(repository, `demo/assets/icons/flowbite/${name}.svg`), `assets/icons/flowbite/${name}.svg`);
    }
    writeFileSync(join(output, 'pilot-build.json'), `${JSON.stringify({ recipes, records }, null, 4)}\n`);
    return { recipes: recipes.length, templates: templates.length, records: records.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (process.argv.length !== 3) {
        process.stderr.write('Usage: node tools/build-package-pilot.mjs NEW_OUTPUT_DIRECTORY\n');
        process.exitCode = 2;
    } else {
        try { console.log(JSON.stringify(buildPackage(process.argv[2]))); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
}
