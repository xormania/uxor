// Explicit PHP + Node integration suite; intentionally outside the Node-only *.test.mjs glob.
// Run with PILOT_COMPOSER_AUTOLOAD pointing at an installation providing composer/semver.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildPackage } from '../build-package-pilot.mjs';
import { fileNames, plannedFixture, sha256, updatePlanIdentity } from './fixtures/package-plan.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const php = process.env.PHP || 'php';
const composerAutoload = resolve(process.env.PILOT_COMPOSER_AUTOLOAD || join(root, 'demo/vendor/autoload.php'));
process.env.PILOT_COMPOSER_AUTOLOAD = composerAutoload;

function generatePlan(source, output) {
    const result = spawnSync(php, [join(root, 'tools/package-toolkit-plan.php'), composerAutoload, source, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, `actual Toolkit plan failed: ${result.error?.message ?? ''}${result.stdout}${result.stderr}`);
    return JSON.parse(readFileSync(output, 'utf8'));
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

test('the actual Toolkit adapter and builder CLI emit deterministic packages with validated Composer provenance', (t) => {
    const work = mkdtempSync(join(tmpdir(), 'uxor-composer-cli-'));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    const planFile = join(work, 'plan.json');
    const plan = generatePlan(root, planFile);
    const outputs = [join(work, 'first'), join(work, 'second')];
    for (const output of outputs) {
        const result = spawnSync(process.execPath, [join(root, 'tools/build-package-pilot.mjs'), output, '--plan', planFile], { encoding: 'utf8' });
        assert.equal(result.status, 0, `actual builder CLI failed: ${result.error?.message ?? ''}${result.stdout}${result.stderr}`);
    }
    assert.deepEqual(fileNames(outputs[0]), fileNames(outputs[1]));
    for (const path of fileNames(outputs[0])) {
        assert.deepEqual(readFileSync(join(outputs[0], path)), readFileSync(join(outputs[1], path)), `nondeterministic CLI output: ${path}`);
    }
    const provenance = JSON.parse(readFileSync(join(outputs[0], 'pilot-build.json'), 'utf8'));
    assert.deepEqual(provenance.toolkitPlan, plan);
    assert.equal(provenance.composerContract.manifestSha256, sha256(readFileSync(join(outputs[0], 'composer.json'))), 'validation must bind to the exact emitted Composer manifest');
    assert.ok(provenance.composerContract.semver, 'the actual validator must identify its Composer semver implementation');
    assert.ok(provenance.composerContract.dependencies, 'the actual validator must record the dependency contract');
});

function editJson(path, edit) {
    const metadata = JSON.parse(readFileSync(path, 'utf8'));
    edit(metadata);
    writeFileSync(path, `${JSON.stringify(metadata, null, 4)}\n`);
}

function rejectWithoutOutput(output, action, expected) {
    assert.throws(action, expected);
    assert.equal(existsSync(output), false, 'a rejected contract created package output');
    assert.equal(existsSync(join(output, 'pilot-build.json')), false, 'a rejected contract left a success artifact');
}

test('source and package Composer contract failures stop actual planned builds before any output', async (t) => {
    const cases = [
        ['missing direct requirement', (source) => editJson(join(source, 'manifest.json'), (metadata) => {
            metadata.dependencies.composer = ['psr/log:^3.0'];
        }), /psr\/log/],
        ['incompatible recipe requirements', (source) => editJson(join(source, 'data-table/manifest.json'), (metadata) => {
            metadata.dependencies.composer = metadata.dependencies.composer.map((entry) => entry.startsWith('symfony/ux-twig-component:') ? 'symfony/ux-twig-component:^99.0' : entry);
        }), /symfony\/ux-twig-component/],
        ['overly broad emitted requirement', (source) => editJson(join(source, 'packages/uxor-pilot/composer.json'), (metadata) => {
            metadata.require['symfony/ux-twig-component'] = '^3.0';
        }), /symfony\/ux-twig-component/],
        ['malformed originating requirement', (source) => editJson(join(source, 'data-table/manifest.json'), (metadata) => {
            metadata.dependencies.composer = metadata.dependencies.composer.map((entry) => entry.startsWith('symfony/ux-twig-component:') ? 'symfony/ux-twig-component:^^3.5' : entry);
        }), /symfony\/ux-twig-component/],
        ['malformed emitted requirement', (source) => editJson(join(source, 'packages/uxor-pilot/composer.json'), (metadata) => {
            metadata.require['symfony/ux-twig-component'] = '^^3.5';
        }), /symfony\/ux-twig-component/],
        ['empty emitted range for an unbounded source requirement', (source) => editJson(join(source, 'packages/uxor-pilot/composer.json'), (metadata) => {
            metadata.require['symfony/http-foundation'] = '>=2 <1';
        }), /symfony\/http-foundation/],
    ];
    for (const [name, mutate, expected] of cases) {
        await t.test(name, (context) => {
            const { work, source } = plannedFixture(context);
            mutate(source);
            const plan = generatePlan(source, join(work, 'actual-plan.json'));
            const output = join(work, 'package');
            rejectWithoutOutput(output, () => buildPackage(output, source, plan), expected);
        });
    }
});

test('a forged requirement list cannot omit or reassign declarations from source manifests', (t) => {
    const { work, source } = plannedFixture(t);
    const plan = generatePlan(source, join(work, 'actual-plan.json'));
    for (const mode of ['omit', 'change-owner', 'add']) {
        const forged = structuredClone(plan);
        const index = forged.requirements.findIndex(({ type, owner }) => type === 'composer' && owner === 'recipe:data-table');
        assert.notEqual(index, -1);
        if (mode === 'omit') forged.requirements.splice(index, 1);
        if (mode === 'change-owner') forged.requirements[index].owner = 'recipe:theme';
        if (mode === 'add') forged.requirements.push({ owner: 'recipe:data-table', type: 'composer', requirement: 'psr/log:^3.0' });
        const output = join(work, mode);
        rejectWithoutOutput(output, () => buildPackage(output, source, forged), /requirements differ from their source manifests/);
    }
});

test('missing validation dependencies or PHP executable cannot produce a package', (t) => {
    const { work, source } = plannedFixture(t);
    const plan = generatePlan(source, join(work, 'actual-plan.json'));
    const previousAutoload = process.env.PILOT_COMPOSER_AUTOLOAD;
    const previousPhp = process.env.PHP;
    try {
        process.env.PILOT_COMPOSER_AUTOLOAD = join(work, 'absent-autoload.php');
        const missingAutoloadOutput = join(work, 'missing-autoload');
        rejectWithoutOutput(missingAutoloadOutput, () => buildPackage(missingAutoloadOutput, source, plan), /Composer validation needs/);
        process.env.PILOT_COMPOSER_AUTOLOAD = composerAutoload;
        process.env.PHP = join(work, 'absent-php');
        const missingPhpOutput = join(work, 'missing-php');
        rejectWithoutOutput(missingPhpOutput, () => buildPackage(missingPhpOutput, source, plan), /Cannot run Composer validation/);
    } finally {
        if (previousAutoload === undefined) delete process.env.PILOT_COMPOSER_AUTOLOAD;
        else process.env.PILOT_COMPOSER_AUTOLOAD = previousAutoload;
        if (previousPhp === undefined) delete process.env.PHP;
        else process.env.PHP = previousPhp;
    }
});
