// The cases of tools/playwright-image.mjs: the browser image is pinned by digest in tools/playwright-image.json, and
// its tag names the @playwright/test version package-lock.json locks, so a Playwright bump cannot run another browser.
// Run: node --test tools/tests/playwright-image.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPin, lockedVersion, playwrightImage, readPin } from '../playwright-image.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const pinned = `mcr.microsoft.com/playwright:v1.58.2-noble@${digest}`;

test("the repository's pin names the locked @playwright/test version, by digest", () => {
    assert.deepEqual(checkPin(readPin(), lockedVersion()), []);
});

test('a pin for the locked version passes and is returned as is', () => {
    assert.deepEqual(checkPin(pinned, '1.58.2'), []);
    assert.equal(playwrightImage('1.58.2', pinned), pinned);
});

test('a pin for another version fails and names the refresh command', () => {
    const problems = checkPin(pinned, '1.59.0');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /v1\.58\.2-noble.*1\.59\.0/);
    assert.match(problems[0], /node tools\/playwright-image\.mjs --refresh/);
    assert.throws(() => playwrightImage('1.59.0', pinned), /1\.59\.0/);
});

test('a pin without a digest, or with another image, fails', () => {
    assert.equal(checkPin('mcr.microsoft.com/playwright:v1.58.2-noble', '1.58.2').length, 1);
    assert.equal(checkPin(`mcr.microsoft.com/playwright:v1.58.2-noble@sha256:${'a'.repeat(63)}`, '1.58.2').length, 1);
    assert.equal(checkPin(`mcr.microsoft.com/playwright:v1.58.2-jammy@${digest}`, '1.58.2').length, 1);
    assert.equal(checkPin(`example.com/playwright:v1.58.2-noble@${digest}`, '1.58.2').length, 1);
});

test('no pin at all fails', () => {
    assert.equal(checkPin(undefined, '1.58.2').length, 1);
    assert.throws(() => playwrightImage('1.58.2', null), /no pinned image/);
});
