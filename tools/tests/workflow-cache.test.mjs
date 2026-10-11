// The demo image's build caches across .github/workflows: a build reads (cache-from) only caches some build writes
// (cache-to), so no workflow keeps reading a cache that nothing fills any more. A registry cache is matched by its image
// (each workflow names it in its `cache` step) and tag; a GitHub Actions cache by its scope. A GitHub Actions cache
// nothing writes is accepted only as a fallback, after a written registry cache in the same build (CI keeps them while
// the registry fills).
// Run: node --test tools/tests/*.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = join(root, '.github/workflows');

/** A cache reference with the workflow's expressions resolved: the `cache` step's image, any branch for its tag. */
function resolve(value, image, file) {
    return value
        .replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, '$1')
        .replace(/steps\.cache\.outputs\.image/g, () => {
            assert.ok(image, `${file}: a cache names steps.cache.outputs.image, but no step with id: cache sets image=`);
            return image;
        })
        .replace(/steps\.cache\.outputs\.tag/g, '*')
        .replace(/github\.ref(_name)?/g, '*');
}

/** Every cache-from and cache-to of the workflows: { file, line, block, kind, type, key } (key: ref or scope). */
function caches() {
    const found = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
        const lines = readFileSync(join(dir, file), 'utf8').split('\n');
        const image = lines.map((line) => /^\s*image="([^"]+)"/.exec(line)?.[1]).find(Boolean);
        let block = 0;
        let previous = -2;
        lines.forEach((line, i) => {
            if (!/cache-(from|to)=/.test(line)) return;
            if (i !== previous + 1) block++;
            previous = i;
            // format('*.cache-to=…{0}:{1}…', a, b): the arguments in place
            let text = line;
            const format = /format\('([^']*)'((?:,[^,)]+)*)\)/.exec(line);
            if (format) {
                const args = format[2].split(',').slice(1).map((arg) => arg.trim());
                text = format[1].replace(/\{(\d)\}/g, (_, n) => args[Number(n)]);
            }
            const entry = /cache-(from|to)=type=(registry|gha),[^\s']*?(ref|scope)=([^,\s']+)/.exec(resolve(text, image, file));
            assert.ok(entry, `${file}:${i + 1}: a cache this test cannot read: ${line.trim()}`);
            found.push({ file, line: i + 1, block: `${file}#${block}`, kind: entry[1], type: entry[2], key: entry[4] });
        });
    }
    return found;
}

const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
const writtenBy = (from, writes) => writes.some((to) => to.type === from.type && (glob(to.key).test(from.key) || to.key === from.key));

test('every build reads only the caches some build writes (a GitHub Actions cache only as a fallback)', () => {
    const all = caches();
    const writes = all.filter((c) => c.kind === 'to');
    assert.ok(writes.length > 0, 'no workflow writes a build cache');
    const problems = [];
    for (const from of all.filter((c) => c.kind === 'from')) {
        if (writtenBy(from, writes)) continue;
        const fallback = from.type === 'gha'
            && all.some((c) => c.block === from.block && c.kind === 'from' && c.type === 'registry' && c.line < from.line && writtenBy(c, writes));
        if (!fallback) problems.push(`${from.file}:${from.line} reads ${from.type} ${from.key}, which no cache-to writes`);
    }
    assert.deepEqual(problems, []);
});

test('the registry cache every workflow reads is the one CI names', () => {
    const images = new Set(caches().filter((c) => c.type === 'registry').map((c) => c.key.replace(/:[^:/]*$/, '')));
    assert.equal(images.size, 1, [...images].join(', '));
});
