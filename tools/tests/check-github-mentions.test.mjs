import assert from 'node:assert/strict';
import test from 'node:test';

import { findDisallowedMentions } from '../check-github-mentions.mjs';

// The at-sign is built here, never written next to a name: this file must not itself hold a reference.
const AT = String.fromCharCode(0x40);

test('rejects an undeclared account mention with its location', () => {
    assert.deepEqual(findDisallowedMentions(`ship\nnotify ${AT}Release now`), [
        { token: `${AT}Release`, offset: 12, line: 2, column: 8 },
    ]);
});

test('compares allowlisted accounts case-insensitively', () => {
    assert.deepEqual(findDisallowedMentions(`thanks ${AT}XorMania`, ['xormania']), []);
});

test('rejects org and team mentions as one token', () => {
    assert.deepEqual(findDisallowedMentions(`ask ${AT}Example/release-team`), [
        { token: `${AT}Example/release-team`, offset: 4, line: 1, column: 5 },
    ]);
});

test('does not treat e-mail-like or embedded text as a mention', () => {
    assert.deepEqual(findDisallowedMentions(`dev${AT}example.com smoke-dark${AT}release package${AT}scope/name`), []);
});

test('remains strict inside Markdown code spans and fences', () => {
    const findings = findDisallowedMentions(`\`${AT}release\`\n\`\`\`text\n${AT}other\n\`\`\``);
    assert.deepEqual(
        findings.map(({ token }) => token),
        [`${AT}release`, `${AT}other`],
    );
});

test('rejects names that do not exist without making a network lookup', () => {
    assert.equal(findDisallowedMentions(`notify ${AT}unlikely-name-847291`).length, 1);
});

test('rejects a scoped package name and a bot command written as prose', () => {
    assert.deepEqual(
        findDisallowedMentions(`bump ${AT}playwright/test, then ${AT}codex review`).map(({ token }) => token),
        [`${AT}playwright/test`, `${AT}codex`],
    );
});
