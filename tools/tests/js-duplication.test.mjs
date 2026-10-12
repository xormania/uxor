// The cases of tools/js-duplication.mjs: a run of tokens found in two places is a copy, comments and spacing aside; a
// name a shared module exports is not declared again; and the kit's recipes stay within the budget.
// Run: node --test tools/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BUDGET, checkKit, checkScripts, findCopies, findRedeclared, loadRecipeScripts, tokenize } from '../js-duplication.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

// a function of about fifty tokens, laid out two ways
const marking = `
function mark(links) {
    const path = window.location.pathname;
    links.forEach((link) => {
        const isCurrent = new URL(link.href, window.location.href).pathname === path;
        isCurrent ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current');
    });
}
`;
const markingReformatted = `// the same code, other comments and spacing
function mark(links) { const path = window.location.pathname; /* the URL's */
    links.forEach((link) => { const isCurrent = new URL(link.href, window.location.href).pathname === path;
        isCurrent ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current'); }); }
`;

test('the tokens of a module leave comments and spacing out, and keep strings and regular expressions whole', () => {
    const tokens = tokenize("// a comment\nconst a = '// not a comment'; /* b */\nconst re = /\"[^\"]*\"|'/g; const half = a / 2;\n");
    assert.deepEqual(
        tokens.map((token) => token.value),
        ['const', 'a', '=', "'// not a comment'", ';', 'const', 're', '=', `/"[^"]*"|'/g`, ';', 'const', 'half', '=', 'a', '/', '2', ';'],
    );
    assert.deepEqual([...new Set(tokens.map((token) => token.line))], [2, 3]);
});

test('the same run of tokens in two files is a copy, whatever its comments and spacing; each place counts its lines', () => {
    const { lines, copies } = findCopies({ 'a/assets/a.js': marking, 'b/assets/b.js': markingReformatted }, { minTokens: 40 });
    assert.deepEqual(copies, [
        { file: 'a/assets/a.js', from: 2, to: 8, alsoIn: ['b/assets/b.js'] },
        { file: 'b/assets/b.js', from: 2, to: 4, alsoIn: ['a/assets/a.js'] },
    ]);
    assert.equal(lines, 7 + 3);
});

test('a copy inside one file counts too; a run shorter than the minimum, or found once, does not', () => {
    const inOneFile = findCopies({ 'a/assets/a.js': marking + marking.replace('mark(', 'markAgain(') }, { minTokens: 40 });
    assert.equal(inOneFile.lines, 7 + 7);
    assert.deepEqual(inOneFile.copies[0].alsoIn, ['a/assets/a.js']);
    assert.deepEqual(findCopies({ 'a/assets/a.js': marking, 'b/assets/b.js': marking }, { minTokens: 200 }), { lines: 0, copies: [] });
    assert.deepEqual(findCopies({ 'a/assets/a.js': marking, 'b/assets/b.js': 'export const b = 1;\n' }, { minTokens: 40 }), { lines: 0, copies: [] });
});

test("declaring a name a shared module exports fails; importing it, a method or a comment of that name does not", () => {
    const shared = { 'turbo/assets/lib/turbo.js': 'export function isPromotedFrameCache() {}\nexport const KEPT = 1;\n' };
    const files = {
        ...shared,
        'modal/assets/controllers/modal_controller.js': "import { isPromotedFrameCache } from '../lib/turbo.js';\n// function isPromotedFrameCache() is shared\nclass A { KEPT() {} }\n",
        'popover/assets/controllers/popover_controller.js': 'import x from "y";\n\nfunction isPromotedFrameCache() {\n    return false;\n}\n',
        'toast/assets/controllers/toast_controller.js': 'const KEPT = 2;\n',
    };
    assert.deepEqual(findRedeclared(files, shared), [
        'popover/assets/controllers/popover_controller.js:3 declares isPromotedFrameCache, which turbo/assets/lib/turbo.js exports: import it from there instead of keeping a copy.',
        'toast/assets/controllers/toast_controller.js:1 declares KEPT, which turbo/assets/lib/turbo.js exports: import it from there instead of keeping a copy.',
    ]);
});

test("the kit's recipes are within the budget, and declare no shared name again", () => {
    const { problems, lines } = checkKit(root);
    assert.deepEqual(problems, []);
    assert.ok(lines <= BUDGET);
});

test("a copy of a shared module's code pasted into a recipe fails the kit", () => {
    const scripts = loadRecipeScripts(root);
    const module = scripts.files['navigation/assets/lib/uxor-navigation.js'];
    assert.ok(module, 'loadRecipeScripts reads the shared modules');
    const body = module.slice(module.indexOf('    const path'), module.indexOf('\n}\n', module.indexOf('export function markCurrentLinks')));
    scripts.files['sidebar/assets/controllers/sidebar_controller.js'] += `\nfunction marking(links) {\n${body}\n}\n`;
    const { problems } = checkScripts(scripts);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /duplicated lines in the recipes' JavaScript, over the budget of \d+/);
});
