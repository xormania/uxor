// The Symfony UX Toolkit versions ci.yml installs to lint and install the kit: one lane on the version demo/composer.lock
// holds, and one lane on the minimum supported version, labelled as such, whose comment does not claim it is the lock's.
// Run: node --test tools/tests/toolkit-pin.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflowPath = '.github/workflows/ci.yml';
const lines = readFileSync(join(root, workflowPath), 'utf8').split('\n');
const MINIMUM = '3.5.1';

const lockVersion = (() => {
    const lock = JSON.parse(readFileSync(join(root, 'demo/composer.lock'), 'utf8'));
    const toolkit = [...lock.packages, ...(lock['packages-dev'] ?? [])].find((pkg) => pkg.name === 'symfony/ux-toolkit');
    assert.ok(toolkit, 'demo/composer.lock holds symfony/ux-toolkit');
    return toolkit.version.replace(/^v/, '');
})();

/** The variables the `composer require … symfony/ux-toolkit:<version>` lines of ci.yml take their version from. */
function requiredVariables() {
    const names = new Set();
    for (const line of lines) {
        const at = line.indexOf('symfony/ux-toolkit:');
        if (!line.includes('composer require') || at < 0) continue;
        const version = line.slice(at + 'symfony/ux-toolkit:'.length);
        const match = /^\$\{\{\s*(?:env|matrix)\.([A-Za-z_][\w-]*)\s*\}\}|^\$\{?([A-Za-z_]\w*)\}?/.exec(version);
        assert.ok(match, `the toolkit version of a composer require is a variable, not a literal: ${line.trim()}`);
        names.add(match[1] ?? match[2]);
    }
    return names;
}

/** Each definition of `name` in ci.yml (an env value, or a matrix value or list), with its line and the comment above. */
function definitions(name) {
    const found = [];
    lines.forEach((line, index) => {
        const match = new RegExp(`^\\s*-?\\s*${name}:\\s*(.+?)\\s*(?:#.*)?$`).exec(line);
        if (!match) return;
        const comment = [];
        for (let above = index - 1; above >= 0 && /^\s*#/.test(lines[above]); above--) comment.unshift(lines[above].trim());
        const trailing = /#(.*)$/.exec(line.replace(/'[^']*'|"[^"]*"/g, ''))?.[1] ?? '';
        const values = [...match[1].matchAll(/['"]?(\d+\.\d+\.\d+)['"]?/g)].map((m) => m[1]);
        for (const version of values) found.push({ version, line: index + 1, comment: [...comment, trailing].join(' ') });
    });
    return found;
}

function installedLanes() {
    const variables = requiredVariables();
    assert.ok(variables.size > 0, `${workflowPath} installs symfony/ux-toolkit`);
    return [...variables].flatMap((name) => definitions(name));
}

test('ci.yml installs the toolkit version demo/composer.lock holds', () => {
    const versions = installedLanes().map(({ version }) => version);
    assert.ok(versions.includes(lockVersion), `a toolkit lane installs ${lockVersion} (demo/composer.lock); installed: ${versions.join(', ')}`);
});

test(`ci.yml keeps a minimum-supported toolkit lane on ${MINIMUM}, labelled minimum`, () => {
    const minimum = installedLanes().filter(({ version }) => version === MINIMUM);
    assert.ok(minimum.length > 0, `a toolkit lane installs ${MINIMUM}`);
    for (const { line, comment } of minimum) {
        assert.match(comment, /minimum/i, `${workflowPath}:${line} labels the ${MINIMUM} lane as the minimum supported version`);
    }
});

test('no toolkit pin claims to be the version of demo/composer.lock unless it is', () => {
    for (const { version, line, comment } of installedLanes()) {
        if (version === lockVersion) continue;
        assert.doesNotMatch(comment, /composer\.lock/, `${workflowPath}:${line} pins ${version} but its comment names demo/composer.lock (${lockVersion})`);
    }
});
