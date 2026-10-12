// The cases of tools/recipe-imports.mjs: a relative import in a recipe's JavaScript names a file that the recipe or one
// of its recipe dependencies installs; and the kit's own recipes pass.
// Run: node --test tools/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkRecipeImports, loadKit, relativeImports } from '../recipe-imports.mjs';

const controller = (spec) => `import { Controller } from '@hotwired/stimulus';\nimport { position } from '${spec}';\n`;
const shared = { recipes: [], files: { 'assets/lib/shared.js': 'export function position() {}\n' } };

test('the relative imports of a module: static, bare, re-exported and dynamic; packages and comments are not', () => {
    const source = [
        "import { Controller } from '@hotwired/stimulus';",
        "import { a, b } from './a.js';",
        "import '../side-effect.js';",
        "export * from './b.js';",
        "export { c } from \"./c.js\";",
        "const d = await import('./d.js');",
        "// import { e } from './e.js';",
        "/* import { f } from './f.js'; */",
    ].join('\n');
    assert.deepEqual(relativeImports(source), ['./a.js', '../side-effect.js', './b.js', './c.js', './d.js']);
});

test('an import of a file the recipe installs itself passes', () => {
    assert.deepEqual(
        checkRecipeImports({
            menu: { recipes: [], files: { 'assets/controllers/menu_controller.js': controller('./helper.js'), 'assets/controllers/helper.js': '' } },
        }),
        [],
    );
});

test('an import of a file a recipe dependency installs passes, at any depth', () => {
    assert.deepEqual(
        checkRecipeImports({
            shared,
            menu: { recipes: ['shared'], files: { 'assets/controllers/menu_controller.js': controller('../lib/shared.js') } },
            picker: { recipes: ['menu'], files: { 'assets/controllers/picker_controller.js': controller('../lib/shared.js') } },
        }),
        [],
    );
});

test('an import of a file no installed recipe copies fails, naming the recipe, the file and the path in the app', () => {
    assert.deepEqual(
        checkRecipeImports({
            shared,
            menu: { recipes: [], files: { 'assets/controllers/menu_controller.js': controller('../lib/shared.js') } },
        }),
        [
            'menu: assets/controllers/menu_controller.js imports "../lib/shared.js" (assets/lib/shared.js), which neither menu nor ' +
                'its recipe dependencies install: add the recipe that copies it to dependencies.recipe in its manifest.json.',
        ],
    );
});

test('a path that resolves elsewhere in the app fails, whatever its file name', () => {
    const problems = checkRecipeImports({
        shared,
        menu: { recipes: ['shared'], files: { 'assets/controllers/menu_controller.js': controller('./shared.js') } },
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /\(assets\/controllers\/shared\.js\)/);
});

test("the kit's recipes import only what they install", () => {
    const kit = loadKit(fileURLToPath(new URL('../..', import.meta.url)));
    assert.ok(kit.dropdown.files['assets/controllers/dropdown_controller.js'], 'loadKit reads the recipes at their path in the app');
    assert.deepEqual(checkRecipeImports(kit), []);
});
