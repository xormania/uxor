// Kit PHP runs PHP with assertions on, as the demo's dev container does (zend.assertions=1, assert.exception=1): PHPUnit
// and the code it tests check their own assert() calls, so a defect the container's run finds (a test leaving a PCRE
// limit that makes PHPUnit's own preg_replace fail its assert) fails CI too. The settings go in php.ini through
// setup-php: a `php -d` flag would not reach the tests PHPUnit runs in their own processes.
// Run: node --test tools/tests/*.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const job = workflow.split(/\n(?= {4}[a-z0-9-]+:\n)/).find((text) => /^ {4}php:\n {8}name: Kit PHP$/m.test(text));

test('Kit PHP sets PHP up with assertions on, in php.ini, before PHPUnit', () => {
    assert.ok(job, 'a Kit PHP job');
    const steps = job.split(/\n(?= {12}- )/).slice(1);
    const setup = steps.findIndex((step) => /uses: shivammathur\/setup-php@/.test(step));
    const phpunit = steps.findIndex((step) => step.includes('- name: PHPUnit\n'));
    assert.ok(setup >= 0 && setup < phpunit, 'PHP is set up before PHPUnit');
    const ini = steps[setup].match(/^ {18}ini-values: (.+)$/m)?.[1] ?? '';
    const values = Object.fromEntries(ini.split(',').map((pair) => pair.trim().split('=').map((part) => part.trim())));
    assert.equal(values['zend.assertions'], '1', `assertions compiled in and on: ${ini || 'no ini-values'}`);
    assert.equal(values['assert.exception'], '1', 'a failed assert() throws, as in the container');
    assert.doesNotMatch(steps[phpunit], /zend\.assertions/, 'not a -d flag: the tests run in their own processes would not get it');
});
