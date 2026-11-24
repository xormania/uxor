#!/usr/bin/env node
// Fails when docs/TEST-INVENTORY.md has fallen behind the repository:
//
// - a recipe shipping a Stimulus controller (`<recipe>/assets/controllers/*_controller.js`) has no row in the
//   inventory's matrix (its first column, `sidebar, navbar` naming two);
// - a test the inventory names does not exist: a spec named in a matrix cell or anywhere as `lab.<name>`
//   (`tests/e2e/<name>.spec.ts`), `recipe:<name>` (a spec in `<name>/tests/`), `shot:<recipe>` (a recipe), a PHPUnit
//   class (`FooTest`, `FooTest::testBar`, in `demo/tests/`), a spec, test file, `tools/` script or consumer check path. Struck text
//   (`~~…~~`) is history and is not read;
// - a rule of FOR-AGENTS.md's "Working well" (a bullet's bold lead-in) has no row in the inventory's "Rules and their
//   tests" (its first column, the lead-in as written), a row names a rule that is gone, or a row names no test and is
//   not marked `advice` or `gap`.
//
// It checks names, not what the tests establish: a row's claims stay the reviewer's.
//
//   node tools/test-inventory.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const errors = [];

const recipes = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')))
    .map((entry) => entry.name);
const inventory = read('docs/TEST-INVENTORY.md').replace(/~~[^~]*~~/g, '');

// A section's text, by the start of its heading
const section = (markdown, file, heading) => {
    const found = markdown.split(/^## /m).find((text) => text.startsWith(heading));
    if (undefined === found) {
        errors.push(`${file}: no "## ${heading}" section`);
    }
    return found ?? '';
};
// The rows of a section's table, each an array of trimmed cells
const table = (text) => text
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[-| ]+\|$/.test(line))
    .slice(1) // the header
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));

// The matrix: the table of the "The matrix" section
const matrix = table(section(inventory, 'docs/TEST-INVENTORY.md', 'The matrix'));

// 1. Every recipe with a controller has a row
const rows = new Set(matrix.flatMap(([first]) => first.split(',').map((name) => name.trim())));
for (const recipe of recipes) {
    const controllers = join(root, recipe, 'assets', 'controllers');
    if (existsSync(controllers) && readdirSync(controllers).some((file) => file.endsWith('_controller.js')) && !rows.has(recipe)) {
        errors.push(`docs/TEST-INVENTORY.md: ${recipe} ships a Stimulus controller and has no row in the matrix`);
    }
}

// 2. Every test it names exists
const spec = (name, where) => {
    if (!existsSync(join(root, 'tests/e2e', `${name}.spec.ts`))) {
        errors.push(`docs/TEST-INVENTORY.md: ${where} names ${name}, and tests/e2e/${name}.spec.ts does not exist`);
    }
};
for (const [first, ...cells] of matrix) {
    for (const cell of cells) {
        for (const name of cell.replace(/\([^)]*\)/g, '').split(',').map((part) => part.trim())) {
            if (!['', '·', 'css'].includes(name) && !/^(G\d+|T\d)$/.test(name)) {
                spec(name, `the matrix row ${first}`);
            }
        }
    }
}
for (const [, name] of inventory.matchAll(/(?<![\w.-])(lab\.[a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
    spec(name, 'the text');
}
for (const [, name] of inventory.matchAll(/\brecipe:([a-z0-9-]+)/g)) {
    const tests = join(root, name, 'tests');
    if (!existsSync(tests) || !readdirSync(tests).some((file) => file.endsWith('.spec.ts'))) {
        errors.push(`docs/TEST-INVENTORY.md: recipe:${name} names no spec (${name}/tests/*.spec.ts)`);
    }
}
for (const [, name] of inventory.matchAll(/\bshot:([a-z0-9-]+)/g)) {
    if (!recipes.includes(name)) {
        errors.push(`docs/TEST-INVENTORY.md: shot:${name} names no recipe`);
    }
}
const phpTests = new Map();
const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            walk(path);
        } else if (entry.name.endsWith('Test.php')) {
            phpTests.set(entry.name.slice(0, -4), read(path));
        }
    }
};
walk('demo/tests');
for (const [, test, method] of inventory.matchAll(/`([A-Z]\w*Test)(?:::(test\w+))?`/g)) {
    const source = phpTests.get(test);
    if (undefined === source) {
        errors.push(`docs/TEST-INVENTORY.md: ${test} is not a test class in demo/tests/`);
    } else if (undefined !== method && !new RegExp(`function ${method}\\(`).test(source)) {
        errors.push(`docs/TEST-INVENTORY.md: ${test} has no ${method}()`);
    }
}
for (const [, path] of inventory.matchAll(/`([\w./-]+(?:\.spec\.ts|Test\.php)|tools\/[\w./-]+\.(?:mjs|sh)|packages\/uxor\/dev\/[\w./-]+\.(?:mjs|php|py|sh))`/g)) {
    if (!existsSync(join(root, path))) {
        errors.push(`docs/TEST-INVENTORY.md: ${path} does not exist`);
    }
}

// 3. Every rule of FOR-AGENTS.md's "Working well" has a row naming its tests (checked above), or `advice` or `gap`
const rules = [...section(read('FOR-AGENTS.md'), 'FOR-AGENTS.md', 'Working well').matchAll(/^- \*\*(.+?)\*\*/gm)].map(([, rule]) => rule);
const ruleRows = table(section(inventory, 'docs/TEST-INVENTORY.md', 'Rules and their tests'));
for (const rule of rules) {
    const count = ruleRows.filter(([first]) => first === rule).length;
    if (0 === count) {
        errors.push(`FOR-AGENTS.md: the rule "${rule}" has no row in "Rules and their tests" of docs/TEST-INVENTORY.md`);
    } else if (count > 1) {
        errors.push(`docs/TEST-INVENTORY.md: "Rules and their tests" has ${count} rows for "${rule}"`);
    }
}
const named = /(?<![\w.-])lab\.[a-z0-9]|\b(?:recipe|shot):[a-z0-9]|`[A-Z]\w*Test(?:::test\w+)?`|`[\w./-]+(?:\.spec\.ts|Test\.php)`|`tools\/[\w./-]+\.(?:mjs|sh)`/;
for (const [rule, tests = ''] of ruleRows) {
    if (!rules.includes(rule)) {
        errors.push(`docs/TEST-INVENTORY.md: "Rules and their tests" has a row for "${rule}", which is not a rule of FOR-AGENTS.md's "Working well"`);
    }
    if (!/^(advice|gap)\b/.test(tests) && !named.test(tests)) {
        errors.push(`docs/TEST-INVENTORY.md: the rule "${rule}" names no test, and is not marked advice or gap`);
    }
}

if (errors.length > 0) {
    console.error([...new Set(errors)].join('\n'));
    process.exit(1);
}
console.log(`test-inventory: ${rows.size} matrix rows, ${rules.length} rules, ${phpTests.size} PHPUnit classes checked`);
