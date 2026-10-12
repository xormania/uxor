#!/usr/bin/env node
// Fails when outbound GitHub text (a pull request's title or description, a commit message) holds a token GitHub can
// read as an account or team reference: an at-sign followed by a login, alone or as org/team, case-insensitive. Such
// a token notifies or links whoever holds that name, now or after they register it, so none is allowed unless it is
// named, for this repository, in .github/mention-allowlist (or with --allow). The check is offline and deny by
// default: it never asks GitHub whether a name exists, and it stays strict inside Markdown code spans and fences,
// which a later copy (a pull request description becoming a merge commit) need not keep. E-mail-like text and a token
// glued to a word (an address, a package path) are not references and pass. CONTRIBUTING.md, *Commits and pull
// requests*; .github/workflows/metadata.yml runs it on every pull request, tools/hooks/commit-msg before a commit.
//
// Usage: node tools/check-github-mentions.mjs [--allow NAME] [--allow-file FILE] [--surface NAME] [--json] [file ...]
// Exit status 0 when nothing undeclared is found, 1 naming each finding, 2 on bad usage.
// Test: node --test tools/tests/*.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const LOGIN = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?';
const MENTION = new RegExp(
  `(^|[^A-Za-z0-9_])@(${LOGIN})(?:\/(${LOGIN}))?(?![A-Za-z0-9-])`,
  'gm',
);

function normalize(value) {
  return value.replace(/^@/, '').toLowerCase();
}

function locationAt(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

export function findDisallowedMentions(text, allowed = []) {
  const allowlist = new Set([...allowed].map(normalize));
  const findings = [];

  MENTION.lastIndex = 0;
  for (const match of text.matchAll(MENTION)) {
    const prefix = match[1];
    const account = match[2];
    const team = match[3];
    const value = team ? `${account}/${team}` : account;
    const token = `@${value}`;
    const offset = match.index + prefix.length;

    if (!allowlist.has(normalize(value))) {
      findings.push({ token, offset, ...locationAt(text, offset) });
    }
  }

  return findings;
}

function usage() {
  return `Usage: node tools/check-github-mentions.mjs [options] [file ...]

Reject undeclared GitHub mention-shaped tokens in outbound text. With no files,
read standard input.

Options:
  --allow NAME       Allow one account or org/team (repeatable)
  --allow-file FILE  Read allowed names, one per line (# comments permitted)
  --surface NAME     Label findings with the destination surface
  --json             Emit findings as JSON Lines
  --help             Show this help
`;
}

function readAllowFile(filename) {
  return fs
    .readFileSync(filename, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function parseArguments(argv) {
  const options = {
    allowed: [],
    files: [],
    surface: 'github-metadata',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      options.help = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--allow' || argument === '--allow-file' || argument === '--surface') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--allow') options.allowed.push(value);
      if (argument === '--allow-file') options.allowed.push(...readAllowFile(value));
      if (argument === '--surface') options.surface = value;
    } else if (argument.startsWith('-') && argument !== '-') {
      throw new Error(`unknown option: ${argument}`);
    } else {
      options.files.push(argument);
    }
  }

  return options;
}

function checkInput(label, text, options) {
  const findings = findDisallowedMentions(text, options.allowed);
  for (const finding of findings) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ surface: options.surface, source: label, ...finding })}\n`);
    } else {
      process.stderr.write(
        `${label}:${finding.line}:${finding.column}: disallowed GitHub mention ${finding.token} ` +
          `on ${options.surface}\n`,
      );
    }
  }
  return findings.length;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  let count = 0;
  if (options.files.length === 0 || options.files.includes('-')) {
    count += checkInput('<stdin>', fs.readFileSync(0, 'utf8'), options);
  }
  for (const filename of options.files.filter((value) => value !== '-')) {
    count += checkInput(filename, fs.readFileSync(filename, 'utf8'), options);
  }

  return count === 0 ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
