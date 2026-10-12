// The cases of tools/readme-versions.mjs: a recipe README renders its install steps from its manifest.json
// (`::: installation`) and writes no version of its own, with no waiver.
// Run: node --test tools/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReadme } from '../readme-versions.mjs';

const ok = '# Chart\n\n## Installation\n\n::: installation\n';
const versionTable = '| Package | Version | Via |\n|---|---|---|\n| `twig/html-extra` | `^3.24.0` | composer |\n';

test('::: installation alone passes: the toolkit renders the manifest', () => {
    assert.deepEqual(checkReadme('chart', ok), []);
    assert.deepEqual(checkReadme('chart', '# Chart\n\n::: installation  \n'), []);
});

test('a README without ::: installation fails', () => {
    assert.deepEqual(checkReadme('chart', '# Chart\n\n## Installation\n\nRun composer require.\n'), [
        'chart/README.md: no "::: installation" line: add one, so the toolkit renders chart/manifest.json\'s dependencies.',
    ]);
});

test('a ::: installation line inside a fenced example is an example, not the directive', () => {
    assert.match(checkReadme('chart', '# Chart\n\n```markdown\n::: installation\n```\n')[0], /no "::: installation" line/);
    assert.match(checkReadme('chart', '# Chart\n\n~~~\n::: installation\n~~~\n')[0], /no "::: installation" line/);
});

test('a version table written by hand fails, beside ::: installation or instead of it', () => {
    assert.deepEqual(checkReadme('chart', `${ok}\n${versionTable}`), [
        'chart/README.md:7: a table with a Version column: versions come from chart/manifest.json through "::: installation", remove it.',
    ]);
    const without = checkReadme('chart', `# Chart\n\n${versionTable}`);
    assert.equal(without.length, 2);
    assert.match(without[0], /no "::: installation" line/);
    assert.match(without[1], /^chart\/README\.md:3: a table with a Version column/);
});

test('a Version column fails whatever the other columns, its place or its case', () => {
    assert.match(checkReadme('chart', `${ok}\n| Dependency | version |\n|---|---|\n| x | 1 |\n`)[0], /:7: a table with a Version column/);
    assert.match(checkReadme('chart', `${ok}\n| Version | Package |\n| :-- | --- |\n`)[0], /:7: a table with a Version column/);
});

test('other tables pass, and so does a version table in a code block', () => {
    assert.deepEqual(checkReadme('chart', `${ok}\n| Prop | Type | Default |\n|---|---|---|\n| size | string | md |\n`), []);
    assert.deepEqual(checkReadme('chart', `${ok}\n\`\`\`markdown\n${versionTable}\`\`\`\n`), []);
    // a Version header with no delimiter row under it is not a table
    assert.deepEqual(checkReadme('chart', `${ok}\n| Version | x |\n`), []);
});
