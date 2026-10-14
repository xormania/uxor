import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
