import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Resolve the isolated lockfile installation explicitly; do not use a global or transitive semver copy.
const require = createRequire(import.meta.url);
const installed = fileURLToPath(new URL('./fixtures/npm-semver/node_modules/semver', import.meta.url));
const semver = require(installed);
assert.equal(require(`${installed}/package.json`).version, '7.8.5');

const cases = [];
const add = (version, range) => cases.push({ version, range });
const boundaries = ['0.0.0', '0.0.1', '0.0.2', '0.1.0', '0.1.1', '0.2.0', '1.0.0', '1.2.3', '1.2.4', '1.3.0', '2.0.0', '3.2.2', '4.0.2', '7.1.0', '8.0.23', '9.0.0'];
for (const range of ['*', '1.2.3', '^0', '^0.0', '^0.0.0', '^0.0.1', '^0.1', '^0.1.1', '^1', '^1.2', '^1.2.3', '~0', '~0.0', '~0.0.1', '~1', '~1.2', '~1.2.3', '^3.0.0', '^3.2.2', '^4.0.2', '^3.4.1 || ^4.0', '^7.1.0 || ^8.0', '>=1.0.0 <2.0.0', '>=2.0.0 <1.0.0', '=1.2.3', '<1.2.3', '<=1.2.3', '>1.2.3', '>=1.2.3']) {
    for (const version of boundaries) add(version, range);
}
add('9007199254740991.0.0', '>=9007199254740991.0.0');
add('9007199254740990.0.0', '>=9007199254740991.0.0');
add('9007199254740990.9.9', '^9007199254740990.0.0');
add('9007199254740991.0.0', '^9007199254740990.0.0');
add('1.2.3', ' >= \t1.2.3\n<=1.2.3\r\n');

// Fixed seed and bounded generation make every differential failure reproducible without snapshots.
let seed = 0x554f5852;
const random = max => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % max;
};
const tuple = () => [random(5), random(7), random(9)];
const operators = ['=', '>', '>=', '<', '<='];
const atom = () => {
    const parts = tuple();
    switch (random(5)) {
        case 0: return '*';
        case 1: return parts.join('.');
        case 2: return `^${random(2) ? ' ' : ''}${parts.slice(0, 1 + random(3)).join('.')}`;
        case 3: return `~${random(2) ? ' ' : ''}${parts.slice(0, 1 + random(3)).join('.')}`;
        default: return `${operators[random(operators.length)]}${random(2) ? ' ' : ''}${parts.join('.')}`;
    }
};
for (let index = 0; index < 900; ++index) {
    const alternatives = Array.from({ length: 1 + random(3) }, () => Array.from({ length: 1 + random(3) }, atom).join(random(2) ? ' ' : '\t'));
    add(tuple().join('.'), alternatives.join(' || '));
}

const expected = cases.map(({ version, range }) => {
    assert.ok(semver.valid(version), `Oracle selected version invalid: ${version}`);
    assert.notEqual(semver.validRange(range), null, `Oracle range invalid: ${range}`);
    return semver.satisfies(version, range, { loose: false, includePrerelease: false });
});
const script = fileURLToPath(new URL('./frontend-npm-ranges.php', import.meta.url));
const result = spawnSync(process.env.PHP || 'php', [script, '--oracle'], {
    input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
assert.ifError(result.error);
assert.equal(result.status, 0, `PHP oracle runner failed: ${result.stderr}${result.stdout}`);
assert.equal(result.stderr, '', 'PHP oracle runner emitted diagnostics');
const actual = JSON.parse(result.stdout);
assert.equal(actual.length, expected.length);
for (const [index, expectedMatch] of expected.entries()) {
    assert.deepEqual(actual[index], { matches: expectedMatch }, `npm/PHP mismatch for ${JSON.stringify(cases[index])}`);
}
console.log(`Stable npm oracle: ${cases.length} cases match node-semver 7.8.5 (fixed seed 0x554f5852).`);
