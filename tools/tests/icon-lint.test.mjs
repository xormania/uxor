// The cases of tools/icon-lint.mjs, on scratch templates: the names a Twig expression may choose, and the ones it fails.
// Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const lint = fileURLToPath(new URL('../icon-lint.mjs', import.meta.url));

/** icon-lint's exit status and output on one template holding `body`. */
function run(body) {
    const file = join(mkdtempSync(join(tmpdir(), 'icon-lint-')), 'case.html.twig');
    writeFileSync(file, body);
    const result = spawnSync(process.execPath, [lint, file], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
}

const passes = {
    'a literal': "{{ ux_icon('flowbite:search-outline') }}",
    'a ternary between names, with a string compared in its condition': "<twig:ux:icon :name=\"query.direction == 'asc' ? 'flowbite:arrow-up-outline' : 'flowbite:arrow-down-outline'\" />",
    'a map of names looked up by key': "<twig:ux:icon :name=\"{up: 'flowbite:arrow-up-outline', 'down': 'flowbite:arrow-down-outline'}[trend]\" />",
    'a lookup by a quoted key': "{% set icons = {info: 'flowbite:info-circle-outline'} %}{{ ux_icon(icons['info']) }}",
    'a default that is a name': "{{ ux_icon(icon|default('flowbite:search-outline')) }}",
};

const fails = {
    'a filter that transforms a name': "{{ ux_icon('flowbite:search-outline'|upper) }}",
    'a filter on a chosen name': "<twig:ux:icon :name=\"(flag ? 'flowbite:a-outline' : 'flowbite:b-outline')|lower\" />",
    'an unqualified alternative': "{{ ux_icon(flag ? 'flowbite:search-outline' : 'search-outline') }}",
    'an unqualified default': "{{ ux_icon(icon|default('search')) }}",
    'an unqualified map value': "<twig:ux:icon :name=\"{up: 'flowbite:arrow-up-outline', down: 'arrow-down'}[trend]\" />",
    'another set as an alternative': "{{ ux_icon(icon ?? 'tabler:search') }}",
};

for (const [name, body] of Object.entries(passes)) {
    test(`passes ${name}`, () => {
        const { status, output } = run(body);
        assert.equal(status, 0, output);
    });
}

for (const [name, body] of Object.entries(fails)) {
    test(`fails ${name}`, () => {
        const { status, output } = run(body);
        assert.equal(status, 1, output);
    });
}
