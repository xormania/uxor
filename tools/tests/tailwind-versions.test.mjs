// The Tailwind CSS versions of the repository: the npm package the palette checks read (package-lock.json), and the
// standalone CLI that compiles the demo's and the consumer app's stylesheets (symfonycasts_tailwind's binary_version).
// They are one version, and the static build names the compiler it used.
// Run: node --test tools/tests/tailwind-versions.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const COMPILERS = ['demo/config/packages/symfonycasts_tailwind.yaml', 'packages/uxor/dev/app/config/packages/symfonycasts_tailwind.yaml'];

const npmVersion = (() => {
    const tailwind = JSON.parse(read('package-lock.json')).packages?.['node_modules/tailwindcss'];
    assert.ok(tailwind?.version, 'package-lock.json resolves tailwindcss');
    return tailwind.version;
})();

function binaryVersion(path) {
    const match = /^\s*binary_version:\s*['"]?v?(\d+\.\d+\.\d+)['"]?\s*(?:#.*)?$/m.exec(read(path));
    assert.ok(match, `${path} pins binary_version`);
    return match[1];
}

for (const path of COMPILERS) {
    test(`${path}'s standalone CLI is the tailwindcss version package-lock.json resolves`, () => {
        assert.equal(binaryVersion(path), npmVersion, `${path} binary_version against package-lock.json's tailwindcss ${npmVersion}`);
    });
}

test('tools/build-static.sh names the Tailwind compiler version it builds with, before tailwind:build', () => {
    const lines = read('tools/build-static.sh').split('\n');
    const build = lines.findIndex((line) => /bin\/console tailwind:build\b/.test(line) && !/^\s*#/.test(line));
    assert.ok(build >= 0, 'tools/build-static.sh runs tailwind:build');
    const logs = lines.slice(0, build).filter((line) => /^\s*(?:echo|printf)\b/.test(line) && /tailwind/i.test(line));
    assert.ok(logs.length > 0, 'a line printed before tailwind:build names the Tailwind compiler');
    // the version printed is the one found at build time, not a literal copied into the script
    assert.ok(
        logs.some((line) => /\$/.test(line) && !/\d+\.\d+\.\d+/.test(line)),
        `the printed Tailwind version comes from a variable or command, not a literal: ${logs.join(' | ')}`,
    );
});
