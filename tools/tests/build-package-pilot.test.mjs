import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildPackage } from '../build-package-pilot.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the distribution resolves nested names and controller actions to the package, with canonical source provenance', (t) => {
    const work = mkdtempSync(join(tmpdir(), 'uxor-package-'));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    const output = join(work, 'package');
    buildPackage(output);
    const table = readFileSync(join(output, 'templates/components/DataTable.html.twig'), 'utf8');
    assert.match(table, /<twig:UXor:Button/);
    assert.match(table, /<twig:UXor:Table:Cell/);
    assert.match(table, /data-xormania--uxor-pilot--data-table-target="form"/);
    assert.match(table, /->xormania--uxor-pilot--data-table#cancelLoading/);
    assert.doesNotMatch(table, /<twig:Button|->data-table#/);
    assert.match(table, /uxor-pilot:arrow-up-outline/);
    assert.doesNotMatch(table, /flowbite:/);
    assert.match(readFileSync(join(output, 'src/DataTable/AbstractDataTable.php'), 'utf8'), /namespace UXor\\Pilot\\DataTable;/);
    const metadata = JSON.parse(readFileSync(join(output, 'composer.json'), 'utf8'));
    assert.ok(metadata.keywords.includes('symfony-ux'), 'Flex must discover the package frontend metadata');
    assert.equal(existsSync(join(output, 'recipe')), false, 'recipe sources are distributed separately');
    const provenance = JSON.parse(readFileSync(join(output, 'pilot-build.json')));
    assert.ok(provenance.records.some(({ source }) => source === 'theme/assets/styles/uxor.css'));
    assert.throws(() => buildPackage(output), /never overwrites/);
});

test('new recipe dependencies and unresolved Twig component references stop the build', (t) => {
    const work = mkdtempSync(join(tmpdir(), 'uxor-package-'));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    const source = join(work, 'source');
    for (const recipe of ['data-table', 'table', 'pagination', 'input', 'select', 'button', 'empty-state', 'turbo', 'theme']) {
        cpSync(join(root, recipe), join(source, recipe), { recursive: true });
    }
    const manifestPath = join(source, 'data-table/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath));
    manifest.dependencies.recipe.push('new-dependency');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => buildPackage(join(work, 'missing-dependency'), source), /Unpackaged recipe dependency/);
    manifest.dependencies.recipe.pop();
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const templatePath = join(source, 'data-table/templates/components/DataTable.html.twig');
    writeFileSync(templatePath, `${readFileSync(templatePath)}\n<twig:MissingComponent />`);
    assert.throws(() => buildPackage(join(work, 'missing-component'), source), /Unpackaged component MissingComponent/);
});

function fileNames(directory, prefix = '') {
    return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? fileNames(directory, path) : [path];
    }).sort();
}

function sha256(contents) {
    return createHash('sha256').update(contents).digest('hex');
}

// This is a controlled builder input, not a second implementation of Toolkit's resolver. The PHP adapter
// tests exercise real Toolkit discovery; these cases check what the builder does with that boundary's output.
function plannedFixture(t) {
    const work = mkdtempSync(join(tmpdir(), 'uxor-planned-package-'));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    const source = join(work, 'source');
    const names = ['data-table', 'table', 'pagination', 'input', 'select', 'button', 'empty-state', 'turbo', 'theme'].sort();
    for (const path of [...names, 'packages/uxor-pilot', 'manifest.json', 'LICENSE', 'NOTICE']) {
        cpSync(join(root, path), join(source, path), { recursive: true });
    }
    const icons = join(source, 'demo/assets/icons/flowbite');
    mkdirSync(icons, { recursive: true });
    for (const name of ['arrow-up-outline', 'arrow-down-outline', 'chevron-left-outline', 'chevron-right-outline', 'inbox-outline']) {
        cpSync(join(root, 'demo/assets/icons/flowbite', `${name}.svg`), join(icons, `${name}.svg`));
    }
    const manifest = (path) => ({ path, sha256: sha256(readFileSync(join(source, path))) });
    const kit = { name: 'UXor', manifest: manifest('manifest.json') };
    const recipes = names.map((name) => ({ name, type: 'component', manifest: manifest(`${name}/manifest.json`), inventory: fileNames(join(source, name)) }));
    const files = recipes.flatMap(({ name }) => fileNames(join(source, name))
        .filter((path) => ['assets/', 'src/', 'templates/components/'].some((prefix) => path.startsWith(prefix)))
        .map((path) => ({ recipe: name, source: `${name}/${path}`, destination: path, sha256: sha256(readFileSync(join(source, name, path))) })));
    files.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
    const requirements = [];
    for (const [owner, path] of [['kit', 'manifest.json'], ...names.map((name) => [`recipe:${name}`, `${name}/manifest.json`])]) {
        const metadata = JSON.parse(readFileSync(join(source, path)));
        for (const [type, declarations] of Object.entries(metadata.dependencies ?? {})) {
            for (const requirement of declarations) requirements.push({ owner, type, requirement });
        }
    }
    const plan = {
        format: 1,
        toolkit: { package: 'symfony/ux-toolkit', version: 'v3.5.1', reference: '0'.repeat(40) },
        source: { sha256: '' }, kit, roots: ['data-table', 'theme'], recipes, files, requirements,
    };
    updatePlanIdentity(plan);
    return { work, source, plan, manifest };
}

function updatePlanIdentity(plan) {
    plan.source.sha256 = sha256(JSON.stringify({ kit: plan.kit, roots: plan.roots, recipes: plan.recipes, files: plan.files }));
}

test('a declared transitive resource uses its planned destination and builds byte-identical package files and provenance', (t) => {
    const { work, source, plan, manifest } = plannedFixture(t);
    const tablePath = join(source, 'data-table/manifest.json');
    const table = JSON.parse(readFileSync(tablePath));
    table.dependencies.recipe.push('fixture-mapped');
    writeFileSync(tablePath, JSON.stringify(table));
    plan.recipes.find(({ name }) => name === 'data-table').manifest = manifest('data-table/manifest.json');
    const directory = join(source, 'fixture-mapped');
    mkdirSync(join(directory, 'resources'), { recursive: true });
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ type: 'component', name: 'FixtureMapped', 'copy-files': { 'resources/': 'assets/custom/' } }));
    const helper = 'export const plannedResource = true;\n';
    writeFileSync(join(directory, 'resources/helper.js'), helper);
    plan.recipes.push({ name: 'fixture-mapped', type: 'component', manifest: manifest('fixture-mapped/manifest.json'), inventory: fileNames(directory) });
    plan.recipes.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    plan.files.push({ recipe: 'fixture-mapped', source: 'fixture-mapped/resources/helper.js', destination: 'assets/custom/helper.js', sha256: sha256(helper) });
    plan.requirements.push({ owner: 'recipe:data-table', type: 'recipe', requirement: 'fixture-mapped' });
    updatePlanIdentity(plan);

    const first = join(work, 'first');
    const second = join(work, 'second');
    buildPackage(first, source, plan);
    buildPackage(second, source, plan);
    assert.equal(readFileSync(join(first, 'assets/custom/helper.js'), 'utf8'), helper);
    assert.equal(existsSync(join(first, 'resources/helper.js')), false, 'the source folder must not replace the declared destination');
    const outputs = fileNames(first);
    assert.deepEqual(outputs, fileNames(second));
    for (const path of outputs) assert.deepEqual(readFileSync(join(first, path)), readFileSync(join(second, path)), `nondeterministic output: ${path}`);
    const provenance = JSON.parse(readFileSync(join(first, 'pilot-build.json')));
    assert.deepEqual(provenance.toolkitPlan, plan);
    const mapped = provenance.records.find(({ source: path }) => path === 'fixture-mapped/resources/helper.js');
    assert.deepEqual(mapped, { source: 'fixture-mapped/resources/helper.js', target: 'assets/custom/helper.js', sha256: sha256(helper), outputSha256: sha256(helper) });
    const transformed = provenance.records.find(({ target }) => target === 'templates/components/DataTable.html.twig');
    assert.notEqual(transformed.sha256, transformed.outputSha256, 'namespace transformation must retain distinct input and output hashes');
    assert.equal(transformed.outputSha256, sha256(readFileSync(join(first, transformed.target))));
});

test('stale root manifests, recipe manifests, mapped content and recipe membership reject the plan before output', (t) => {
    const { work, source, plan } = plannedFixture(t);
    for (const path of ['manifest.json', 'data-table/manifest.json', 'data-table/templates/components/DataTable.html.twig']) {
        const original = readFileSync(join(source, path));
        writeFileSync(join(source, path), Buffer.concat([original, Buffer.from('\n')]));
        const output = join(work, `stale-${path.replaceAll('/', '-')}`);
        assert.throws(() => buildPackage(output, source, plan), /Stale Toolkit plan/);
        assert.equal(existsSync(output), false);
        writeFileSync(join(source, path), original);
    }
    const added = join(source, 'data-table/assets/new-helper.js');
    writeFileSync(added, 'export const addedAfterPlanning = true;\n');
    const output = join(work, 'stale-inventory');
    assert.throws(() => buildPackage(output, source, plan), /Stale Toolkit recipe inventory/);
    assert.equal(existsSync(output), false);
});

test('unsupported destinations, escaping paths and duplicate destinations fail before creating a package', (t) => {
    const { work, source, plan } = plannedFixture(t);
    const assetIndex = plan.files.findIndex(({ destination }) => destination.startsWith('assets/'));
    const invalid = [
        ['unsupported-destination', (candidate) => { candidate.files[assetIndex].destination = 'config/services.yaml'; }, /Unsupported Toolkit destination/],
        ['parent-destination', (candidate) => { candidate.files[assetIndex].destination = '../outside.js'; }, /Unsupported package path/],
        ['absolute-destination', (candidate) => { candidate.files[assetIndex].destination = '/outside.js'; }, /Unsupported package path/],
        ['backslash-destination', (candidate) => { candidate.files[assetIndex].destination = 'assets\\outside.js'; }, /Unsupported package path/],
        ['parent-source', (candidate) => { candidate.files[assetIndex].source = '../outside.js'; }, /Unsupported package path/],
        ['duplicate-destination', (candidate) => { candidate.files.push({ ...candidate.files[assetIndex] }); }, /Duplicate package destination/],
    ];
    for (const [name, mutate, expected] of invalid) {
        const candidate = structuredClone(plan);
        mutate(candidate);
        updatePlanIdentity(candidate);
        const output = join(work, name);
        assert.throws(() => buildPackage(output, source, candidate), expected, name);
        assert.equal(existsSync(output), false, `${name} created partial output`);
    }
});
