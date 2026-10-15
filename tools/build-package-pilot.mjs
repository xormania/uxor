#!/usr/bin/env node
/** Assemble one distribution from the existing canonical recipes; never maintain a second table implementation. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const smokeRecipes = ['data-table', 'table', 'pagination', 'input', 'select', 'button', 'empty-state', 'turbo', 'theme'];
const controller = 'xormania--uxor-pilot--data-table';

function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Pilot sources must not be symlinks: ${path}`);
        return entry.isDirectory() ? files(path) : [path];
    }).sort();
}

function sourceHash(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function safePath(path) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.' || part === '')) {
        throw new Error(`Unsupported package path: ${path}`);
    }
    return path;
}

function plannedFiles(repository, plan) {
    if (plan.format !== 1 || plan.toolkit?.package !== 'symfony/ux-toolkit' || !/^v?3\.5\.1$/.test(plan.toolkit.version) || !plan.toolkit.reference) {
        throw new Error('Unsupported Toolkit package plan; regenerate with the pinned adapter.');
    }
    if (JSON.stringify(plan.roots) !== JSON.stringify(['data-table', 'theme'])) throw new Error('Unexpected Toolkit package roots.');
    if (plan.kit.manifest.path !== 'manifest.json') throw new Error('Unexpected Toolkit kit manifest.');
    for (const recipe of plan.recipes) {
        if (recipe.manifest.path !== `${recipe.name}/manifest.json`) throw new Error(`Unexpected Toolkit recipe manifest: ${recipe.name}`);
        const directory = join(repository, safePath(recipe.name));
        const inventory = files(directory).map((path) => relative(directory, path));
        if (JSON.stringify(inventory) !== JSON.stringify(recipe.inventory)) throw new Error(`Stale Toolkit recipe inventory: ${recipe.name}`);
    }
    for (const record of [plan.kit.manifest, ...plan.recipes.map((recipe) => recipe.manifest), ...plan.files.map((file) => ({ path: file.source, sha256: file.sha256 }))]) {
        if (sourceHash(join(repository, safePath(record.path))) !== record.sha256) throw new Error(`Stale Toolkit plan: ${record.path}`);
    }
    return plan.files.map(({ source, destination }) => ({ path: join(repository, safePath(source)), destination: safePath(destination) }));
}

function composerContract(repository, plan, composerSource) {
    // Re-read the declarations bound by the checked source hashes. A changed requirements array in a
    // saved plan must not remove a recipe's constraints or invent a different owner for a diagnostic.
    const requirements = [];
    for (const [owner, path] of [['kit', 'manifest.json'], ...plan.recipes.map(({ name }) => [`recipe:${name}`, `${name}/manifest.json`])]) {
        const manifest = JSON.parse(readFileSync(join(repository, path), 'utf8'));
        for (const [type, declarations] of Object.entries(manifest.dependencies ?? {})) {
            for (const requirement of declarations) requirements.push({ owner, type, requirement });
        }
    }
    const canonical = (records) => records.map(({ owner, type, requirement }) => JSON.stringify([owner, type, requirement])).sort();
    if (!Array.isArray(plan.requirements) || JSON.stringify(canonical(requirements)) !== JSON.stringify(canonical(plan.requirements))) {
        throw new Error('Toolkit plan requirements differ from their source manifests; regenerate the plan.');
    }
    const autoload = resolve(process.env.PILOT_COMPOSER_AUTOLOAD || join(repository, 'demo/vendor/autoload.php'));
    if (!existsSync(autoload)) throw new Error('Composer validation needs the installed demo dependencies; set PILOT_COMPOSER_AUTOLOAD to their autoload.php.');
    const result = spawnSync(process.env.PHP || 'php', [join(root, 'tools/package-composer-contract.php'), autoload], {
        input: JSON.stringify({ requirements, package: JSON.parse(composerSource.toString('utf8')) }), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw new Error(`Cannot run Composer validation: ${result.error.message}`);
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Composer validation failed.');
    return { ...JSON.parse(result.stdout), manifestSha256: createHash('sha256').update(composerSource).digest('hex') };
}

export function buildPackage(output, repository = root, plan = null) {
    output = resolve(output);
    if (existsSync(output)) throw new Error('Choose a new output directory; the pilot never overwrites an existing tree.');
    if (plan !== null && (typeof plan !== 'object' || Array.isArray(plan))) throw new Error('Expected a Toolkit package plan object.');
    // The plan path is the author/release path. The original bounded mode remains a fast Node-only smoke check.
    const recipes = plan ? plan.recipes.map(({ name }) => name) : smokeRecipes;
    const selected = new Set(recipes);
    if (plan && (selected.size !== recipes.length || !['data-table', 'theme'].every((name) => selected.has(name)))) {
        throw new Error('Toolkit plan must include each root recipe and contain no duplicate recipes.');
    }
    for (const recipe of recipes) {
        const manifest = JSON.parse(readFileSync(join(repository, safePath(recipe), 'manifest.json'), 'utf8'));
        for (const dependency of manifest.dependencies?.recipe ?? []) {
            if (!selected.has(dependency)) throw new Error(`Unpackaged recipe dependency: ${recipe} -> ${dependency}`);
        }
    }
    const inputs = plan ? plannedFiles(repository, plan) : recipes.flatMap((recipe) =>
        ['templates/components', 'src', 'assets'].flatMap((folder) => {
            const directory = join(repository, recipe, folder);
            return existsSync(directory) ? files(directory).map((path) => ({ path, destination: relative(join(repository, recipe), path) })) : [];
        }));
    const templates = inputs.filter(({ destination }) => destination.startsWith('templates/components/') && destination.endsWith('.html.twig'))
        .map((input) => ({ ...input, name: input.destination.slice('templates/components/'.length).replace(/\.html\.twig$/, '').replaceAll('/', ':') }));
    const names = new Set(templates.map(({ name }) => name));
    if (names.size !== templates.length) throw new Error('Two recipes declare the same component.');

    // Validate this bounded source format before making a directory. This is not a general Twig/PHP codemod.
    const rendered = templates.map(({ path, destination }) => {
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
                ['->data-table#', `->${controller}#`, null],
                ['data-data-table-target=', `data-${controller}-target=`, null],
            ]) {
                const count = source.split(needle).length - 1;
                if (expected === null ? count < 1 : count !== expected) throw new Error(`Controller format changed: ${needle}`);
                source = source.replaceAll(needle, replacement);
            }
        }
        return { path, destination, source };
    });

    const transformed = new Map(rendered.map((file) => [file.destination, file]));
    const payload = inputs.map(({ path, destination }) => {
        if (transformed.has(destination)) return transformed.get(destination);
        if (destination.startsWith('src/UXor/DataTable/') && destination.endsWith('.php')) {
            const source = readFileSync(path, 'utf8');
            if (!source.includes('namespace App\\UXor\\DataTable;')) throw new Error(`Unexpected PHP namespace in ${path}`);
            return { path, destination: destination.replace('src/UXor/DataTable/', 'src/DataTable/'), source: source.replaceAll('App\\UXor\\DataTable', 'UXor\\Pilot\\DataTable').replaceAll('<twig:DataTable', '<twig:UXor:DataTable') };
        }
        if (!destination.startsWith('assets/') || !/\.(?:js|css|svg)$/.test(destination)) throw new Error(`Unsupported Toolkit destination: ${destination}`);
        return { path, destination, source: readFileSync(path) };
    });
    const packageSource = join(repository, 'packages/uxor-pilot');
    for (const path of files(packageSource).filter((path) => !path.startsWith(join(packageSource, 'recipe') + '/'))) {
        payload.push({ path, destination: relative(packageSource, path), source: readFileSync(path) });
    }
    for (const name of ['LICENSE', 'NOTICE']) payload.push({ path: join(repository, name), destination: name, source: readFileSync(join(repository, name)) });
    for (const name of ['arrow-up-outline', 'arrow-down-outline', 'chevron-left-outline', 'chevron-right-outline', 'inbox-outline']) {
        const path = join(repository, `demo/assets/icons/flowbite/${name}.svg`);
        payload.push({ path, destination: `assets/icons/flowbite/${name}.svg`, source: readFileSync(path) });
    }
    const destinations = new Set(['pilot-build.json']);
    for (const { destination } of payload) {
        safePath(destination);
        if (destinations.has(destination)) throw new Error(`Duplicate package destination: ${destination}`);
        destinations.add(destination);
    }
    // Validate the exact composer.json bytes about to be emitted, before creating any package output.
    // Composer handles the full transitive solve later in the isolated consumer.
    const contract = plan ? composerContract(repository, plan, payload.find(({ destination }) => destination === 'composer.json').source) : null;
    const records = [];
    mkdirSync(output, { recursive: true });
    for (const { path, destination, source } of payload) {
        const target = join(output, destination);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, source);
        records.push({ source: relative(repository, path), target: destination, sha256: sourceHash(path), outputSha256: sourceHash(target) });
    }
    records.sort((a, b) => a.target.localeCompare(b.target, 'en'));
    writeFileSync(join(output, 'pilot-build.json'), `${JSON.stringify({ recipes, toolkitPlan: plan, composerContract: contract, records }, null, 4)}\n`);
    return { recipes: recipes.length, templates: templates.length, records: records.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (process.argv.length !== 3 && !(process.argv.length === 5 && process.argv[3] === '--plan')) {
        process.stderr.write('Usage: node tools/build-package-pilot.mjs NEW_OUTPUT_DIRECTORY [--plan TOOLKIT_PLAN_JSON]\n');
        process.exitCode = 2;
    } else {
        try {
            const hasPlan = process.argv.length === 5;
            const plan = hasPlan ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : null;
            if (hasPlan && plan === null) throw new Error('Expected a Toolkit package plan object.');
            console.log(JSON.stringify(buildPackage(process.argv[2], root, plan)));
        }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
}
