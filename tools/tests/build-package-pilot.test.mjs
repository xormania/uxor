import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildPackage } from '../build-package-pilot.mjs';
import { plannedFixture, updatePlanIdentity } from './fixtures/package-plan.mjs';

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

test('malformed plans cannot skip roots, duplicate recipes or substitute manifest paths', (t) => {
    const { work, source, plan } = plannedFixture(t);
    const cases = [
        ['missing-data-table', (candidate) => { candidate.recipes = candidate.recipes.filter(({ name }) => name !== 'data-table'); }, /must include each root recipe/],
        ['missing-theme', (candidate) => { candidate.recipes = candidate.recipes.filter(({ name }) => name !== 'theme'); }, /must include each root recipe/],
        ['duplicate-recipe', (candidate) => { candidate.recipes.push({ ...candidate.recipes[0] }); }, /no duplicate recipes/],
        ['wrong-kit-manifest', (candidate) => { candidate.kit.manifest = { ...candidate.recipes[0].manifest }; }, /Unexpected Toolkit kit manifest/],
        ['wrong-recipe-manifest', (candidate) => { candidate.recipes[0].manifest = { ...candidate.recipes[1].manifest }; }, /Unexpected Toolkit recipe manifest/],
    ];
    for (const [name, mutate, expected] of cases) {
        const malformed = structuredClone(plan);
        mutate(malformed);
        const output = join(work, name);
        assert.throws(() => buildPackage(output, source, malformed), expected);
        assert.equal(existsSync(output), false);
    }
    for (const [index, malformed] of [false, 0, []].entries()) {
        const output = join(work, `non-object-${index}`);
        assert.throws(() => buildPackage(output, source, malformed), /Expected a Toolkit package plan object/);
        assert.equal(existsSync(output), false);
    }
    const nullPlan = join(work, 'null-plan.json');
    const output = join(work, 'null-plan-output');
    writeFileSync(nullPlan, 'null\n');
    const result = spawnSync(process.execPath, [join(root, 'tools/build-package-pilot.mjs'), output, '--plan', nullPlan], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Expected a Toolkit package plan object/);
    assert.equal(existsSync(output), false, 'an explicit null plan must not fall back to the unchecked smoke build');
});
