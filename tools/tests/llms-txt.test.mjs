// Run tools/llms-txt.mjs on a small kit in a scratch Git repository: llms.txt describes the latest release in
// CHANGELOG.md, never a branch, and once that release is tagged it is the tag's own copy, so a recipe merged since never
// appears in it. Run: node --test tools/tests/llms-txt.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

function kit(t, changelog) {
    const dir = mkdtempSync(join(tmpdir(), 'llms-txt-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const write = (path, content) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
    };
    for (const tool of ['tools/llms-txt.mjs', 'tools/kit-identity.mjs']) {
        mkdirSync(join(dir, 'tools'), { recursive: true });
        copyFileSync(join(root, tool), join(dir, tool));
    }
    write('manifest.json', JSON.stringify({ name: 'Fixture', homepage: 'https://github.com/example/kit', description: 'A fixture kit.' }));
    write('packages/uxor/resources/guides.json', JSON.stringify({
        install: { file: 'INSTALL.md', title: 'Install', description: 'Install the kit.' },
        guide: { file: 'docs/GUIDE.md', title: 'Guide', description: 'Use the kit.' },
        composer: { file: 'packages/uxor/README.md', title: 'Composer', description: 'Install the package.' },
        advanced: { file: 'packages/uxor/OPERATIONS.md', title: 'Advanced', description: 'Configure the tools.' },
    }));
    write('CHANGELOG.md', changelog);
    write('button/manifest.json', '{}');
    write('docs/RECIPES.md', '# Recipes\n\n## Basic\n\n| Install | Description |\n|---|---|\n| [`button`](../button/README.md) | A button. |\n');
    write('FOR-AGENTS.md', '# Agents\n\n<!-- recipes:start -->\n<!-- recipes:end -->\n');
    write('docs/PROJECT-AGENTS-SNIPPET.md', '# Snippet\n');
    write('docs/ROADMAP.md', '# Roadmap\n\n| # | Package | Decision | Recipes | Status |\n|---|---|---|---|---|\n');
    const run = (...args) => spawnSync('node', ['tools/llms-txt.mjs', ...args], { cwd: dir, encoding: 'utf8' });
    const git = (...args) => {
        const out = spawnSync('git', ['-c', 'user.name=Local proof', '-c', 'user.email=proof@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
        assert.equal(out.status, 0, out.stderr);
    };
    return { dir, write, run, git, llms: () => readFileSync(join(dir, 'llms.txt'), 'utf8') };
}

const unreleased = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- `card`: a card.\n\n## [1.2.0] - 2026-01-01\n';

test('llms.txt names the latest release, never a branch, even with unreleased entries', (t) => {
    const k = kit(t, unreleased);
    k.git('init', '-q');
    const run = k.run();
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const llms = k.llms();
    assert.match(llms, /--kit=https:\/\/github\.com\/example\/kit:1\.2\.0`/);
    assert.match(llms, /raw\.githubusercontent\.com\/example\/kit\/1\.2\.0\/button\/README\.md/);
    for (const path of ['packages/uxor/README.md', 'packages/uxor/OPERATIONS.md']) {
        assert.ok(llms.includes(`(https://raw.githubusercontent.com/example/kit/1.2.0/${path})`), path);
    }
    assert.doesNotMatch(llms, /:dev\b|\/dev\//);
    assert.equal(k.run('--check').status, 0);
});

test('no released version in CHANGELOG.md is an error, never a branch', (t) => {
    const k = kit(t, '# Changelog\n\n## [Unreleased]\n\n- `card`: a card.\n');
    const run = k.run();
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no `## \[X\.Y\.Z\]` heading/);
});

test('once the release is tagged, llms.txt is the tag copy: a recipe merged since is not in it', (t) => {
    const k = kit(t, '# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-01-01\n');
    k.git('init', '-q');
    assert.equal(k.run().status, 0);
    k.git('add', '-A');
    k.git('commit', '-q', '-m', 'release 1.2.0');
    k.git('tag', '-a', '1.2.0', '-m', 'Fixture 1.2.0');
    const released = k.llms();

    // a recipe merged after the release, with its unreleased entry
    k.write('CHANGELOG.md', unreleased);
    k.write('card/manifest.json', '{}');
    k.write('docs/RECIPES.md', `${readFileSync(join(k.dir, 'docs/RECIPES.md'), 'utf8')}| [\`card\`](../card/README.md) | A card. |\n`);
    const run = k.run();
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(k.llms(), released, 'the tag copy, unchanged');
    assert.doesNotMatch(k.llms(), /card/);
    // the agent table of FOR-AGENTS.md still follows the working tree
    assert.match(readFileSync(join(k.dir, 'FOR-AGENTS.md'), 'utf8'), /`card`/);
    assert.equal(k.run('--check').status, 0);

    // an llms.txt edited by hand differs from the tag copy: --check fails
    k.write('llms.txt', `${released}\nedited\n`);
    const check = k.run('--check');
    assert.equal(check.status, 1);
    assert.match(check.stderr, /llms\.txt is stale/);
});

test('the website category index preserves the catalog’s group and recipe order and fails checks on missing or stale output', (t) => {
    const k = kit(t, unreleased);
    const categories = 'website/resources/recipe-categories.json';
    k.write('card/manifest.json', '{}');
    k.write('form/manifest.json', '{}');
    k.write('docs/RECIPES.md', [
        '# Recipes', '## Forms', '| [`form`](../form/README.md) | A form. |',
        '## Basic', '| [`card`](../card/README.md) | A card. |', '| [`button`](../button/README.md) | A button. |',
    ].join('\n') + '\n');

    assert.match(k.run('--check').stderr, /website\/resources\/recipe-categories\.json is stale/);
    const write = k.run();
    assert.equal(write.status, 0, write.stderr);
    const generated = JSON.parse(readFileSync(join(k.dir, categories), 'utf8'));
    assert.deepEqual(generated, [
        { title: 'Forms', recipes: ['form'] },
        { title: 'Basic', recipes: ['card', 'button'] },
    ]);
    assert.equal(k.run('--check').status, 0);

    generated[1].recipes.reverse();
    k.write(categories, JSON.stringify(generated, null, 2) + '\n');
    const stale = k.run('--check');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /website\/resources\/recipe-categories\.json is stale/);
});

test('website category assignments match those published by the Composer package', () => {
    const categories = JSON.parse(readFileSync(join(root, 'website/resources/recipe-categories.json'), 'utf8'));
    const { components } = JSON.parse(readFileSync(join(root, 'packages/uxor/resources/uxor/index.json'), 'utf8'));
    const expected = Object.fromEntries(Object.entries(components).map(([name, recipe]) => [name, recipe.category]));
    const names = categories.flatMap(({ title, recipes }) => recipes.map((name) => [name, title]));
    assert.equal(names.length, Object.keys(expected).length);
    assert.deepEqual(Object.fromEntries(names), expected);
});
