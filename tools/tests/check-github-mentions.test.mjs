import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('the commit-msg hook, self-contained, finds what the tool finds', () => {
    const hook = fileURLToPath(new URL('../hooks/commit-msg', import.meta.url));
    assert.doesNotMatch(fs.readFileSync(hook, 'utf8'), /check-github-mentions\.mjs"|\$root\/tools|import\(/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-'));
    const cases = [
        `fix: clean\n\n# On branch dev\n#\tmodified: a.md\n`,
        `#1 notify ${AT}release\n`,
        `fix: clean\n# ${AT}other in a comment\n`,
        `ask ${AT}Example/release-team, mail dev${AT}example.com, smoke-dark${AT}release\n`,
        `\`${AT}release\` in a span\n`,
        `fix: clean\n# ------------------------ >8 ------------------------\n+ ${AT}other in the diff\n`,
    ];
    for (const [index, message] of cases.entries()) {
        const file = path.join(dir, `m${index}`);
        fs.writeFileSync(file, message);
        const run = spawnSync('sh', [hook, file], { encoding: 'utf8' });
        const expected = findDisallowedMentions(message.split(/^# -{24} >8 -{24}$/m)[0]).map(({ token }) => token);
        const reported = [...run.stderr.matchAll(/disallowed GitHub mention (\S+)/g)].map((match) => match[1]);
        assert.deepEqual(reported, expected, message);
        assert.equal(run.status, expected.length ? 1 : 0, message);
    }
    fs.rmSync(dir, { recursive: true });
});
