// The cases of tools/name-check.mjs, on scratch kits: the repository URLs that match manifest.json's homepage, and the
// ones a rename leaves behind.
// Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const check = fileURLToPath(new URL('../name-check.mjs', import.meta.url));
const manifest = { name: 'Kit', description: 'A kit.', license: 'MIT', homepage: 'https://github.com/acme/kit' };

/** name-check's exit status and output on a scratch kit holding `files` ({path: content}) beside its manifest.json. */
function run(files, homepage = manifest.homepage, former = ['acme/old-kit', 'old-owner/kit']) {
    const root = mkdtempSync(join(tmpdir(), 'name-check-'));
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ ...manifest, homepage }));
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'kit-former-names.json'), JSON.stringify(former));
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    const result = spawnSync(process.execPath, [check, '--root', root], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
}

const passes = {
    'the homepage and its paths': 'See <https://github.com/acme/kit> and [SECURITY.md](https://github.com/acme/kit/blob/main/SECURITY.md).',
    'an install command with a version': '`php bin/console ux:install button --kit=https://github.com/acme/kit:0.2.0`',
    'the owner in another case': 'https://github.com/ACME/kit/issues',
    'the gallery': 'Gallery: <https://acme.github.io/kit/>.',
    'a raw file': 'https://raw.githubusercontent.com/acme/kit/dev/FOR-AGENTS.md',
    'a clone URL': 'git clone https://github.com/acme/kit.git',
    'another project': 'Built on https://github.com/themesberg/flowbite and https://github.com/symfony/ux.',
    'the owner alone': 'Maintained by https://github.com/acme.',
    'the old name outside a URL': 'Commands naming the old repository (`acme/old-kit`) stop working.',
    "a sibling repository of the owner": 'The runner: https://github.com/acme/another-project and https://acme.github.io/another-project/.',
    "another owner's repository of the same name": 'Not to be confused with https://github.com/someone/kit.',
};

const fails = {
    'the old repository': ['README.md', 'php bin/console ux:install button --kit=https://github.com/acme/old-kit'],
    'the old gallery': ['docs/guide.md', 'Gallery: <https://acme.github.io/old-kit/>.'],
    'the old raw base': ['FOR-AGENTS.md', 'https://raw.githubusercontent.com/acme/old-kit/main/FOR-AGENTS.md'],
    'a repository name in another case': ['README.md', 'https://github.com/acme/Kit'],
    'the old owner': ['README.md', 'https://github.com/old-owner/kit/blob/main/SECURITY.md'],
    'a template': ['demo/templates/base.html.twig', "{% set repository = 'https://github.com/acme/old-kit' %}"],
    'a workflow': ['.github/workflows/ci.yml', 'run: echo https://github.com/acme/old-kit'],
};

for (const [name, body] of Object.entries(passes)) {
    test(`passes ${name}`, () => {
        const { status, output } = run({ 'README.md': `${body}\n` });
        assert.equal(status, 0, output);
    });
}

for (const [name, [path, body]] of Object.entries(fails)) {
    test(`fails ${name}`, () => {
        const { status, output } = run({ [path]: `Intro.\n${body}\n` });
        assert.equal(status, 1, output);
        assert.match(output, new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:2: `));
    });
}

test("reads CHANGELOG.md's released sections as history, and checks its link references", () => {
    const changelog = [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '- Renamed: the kit is now at <https://github.com/acme/kit>.',
        '',
        '## [0.1.0] - 2026-10-06',
        '',
        '- Install with `--kit=https://github.com/acme/old-kit`.',
        '',
        '[Unreleased]: https://github.com/acme/kit/compare/0.1.0...HEAD',
        '[0.1.0]: https://github.com/acme/kit/releases/tag/0.1.0',
        '',
    ].join('\n');
    assert.equal(run({ 'CHANGELOG.md': changelog }).status, 0);

    const stale = run({ 'CHANGELOG.md': changelog.replace('[0.1.0]: https://github.com/acme/kit/', '[0.1.0]: https://github.com/acme/old-kit/') });
    assert.equal(stale.status, 1, stale.output);
    assert.match(stale.output, /CHANGELOG\.md:12: /);

    const unreleased = run({ 'CHANGELOG.md': changelog.replace('<https://github.com/acme/kit>', '<https://github.com/acme/old-kit>') });
    assert.equal(unreleased.status, 1, unreleased.output);
    assert.match(unreleased.output, /CHANGELOG\.md:5: /);
});

test('skips dependencies and build output', () => {
    const { status, output } = run({
        'node_modules/x/README.md': 'https://github.com/acme/old-kit',
        'demo/vendor/x/README.md': 'https://github.com/acme/old-kit',
        'README.md': 'https://github.com/acme/kit',
    });
    assert.equal(status, 0, output);
});

test('fails on a homepage that is not a GitHub repository', () => {
    const { status, output } = run({ 'README.md': 'Hello.\n' }, 'https://example.com/kit');
    assert.equal(status, 1, output);
    assert.match(output, /homepage/);
});
