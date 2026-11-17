// The Symfony UX Dropzone versions the Dropzone recipe supports: ^3.7, the range its markup, styles and assist
// controller are built and tested for. The recipe's manifest (what ux:install requires), the demo's composer.json and its
// lock say so, and the recipe's README claims no older version: it states the manifest's constraint through its
// `::: installation` line (tools/readme-versions.mjs), never one of its own.
// Run: node --test tools/tests/dropzone-range.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unfenced } from '../readme-versions.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const PACKAGE = 'symfony/ux-dropzone';
const RANGE = '^3.7';

test(`dropzone/manifest.json requires ${PACKAGE}:${RANGE}`, () => {
    const composer = JSON.parse(read('dropzone/manifest.json')).dependencies?.composer ?? [];
    const entries = composer.filter((entry) => entry === PACKAGE || entry.startsWith(`${PACKAGE}:`));
    assert.deepEqual(entries, [`${PACKAGE}:${RANGE}`]);
});

test(`demo/composer.json requires ${PACKAGE} ${RANGE}`, () => {
    assert.equal(JSON.parse(read('demo/composer.json')).require?.[PACKAGE], RANGE);
});

test(`demo/composer.lock installs a ${PACKAGE} within ${RANGE}`, () => {
    const lock = JSON.parse(read('demo/composer.lock'));
    const dropzone = [...lock.packages, ...(lock['packages-dev'] ?? [])].find((pkg) => pkg.name === PACKAGE);
    assert.ok(dropzone, `demo/composer.lock holds ${PACKAGE}`);
    const [major, minor] = dropzone.version.replace(/^v/, '').split('.').map(Number);
    assert.ok(major === 3 && minor >= 7, `${PACKAGE} ${dropzone.version} is within ${RANGE}`);
});

test("dropzone/README.md states the manifest's constraint through its installation line and claims no older version", () => {
    const readme = read('dropzone/README.md');
    assert.ok(unfenced(readme).some(({ text }) => text.trim() === '::: installation'), 'the README renders the install steps from the manifest');
    const older = readme.split('\n').flatMap((text, i) => (/(?<![\d.])\^?3\.[0-6](?:\.\d+)?(?![\d.])/.test(text) ? [`${i + 1}: ${text.trim()}`] : []));
    assert.deepEqual(older, [], 'no line of the README names a 3.0–3.6 version');
});
