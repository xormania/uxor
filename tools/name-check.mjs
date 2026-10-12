#!/usr/bin/env node
// Fails when a file names this kit's repository by a URL that is not manifest.json's homepage: after a rename, the
// URLs the rename left behind. The markdown keeps literal URLs (GitHub renders it as written, and an agent reads it
// raw), so a rename is: change manifest.json's `name` and `homepage`, rename the repository, run this check and fix
// what it lists. The tools and the demo read the name and the repository from manifest.json (tools/kit-identity.mjs,
// the demo's `kit_reader` Twig global) and need no change.
//
// A URL is stale when it names one of the kit's former repositories (tools/kit-former-names.json, `owner/repo`
// each, kept on a rename) or the homepage's repository with its name in another case: `https://github.com/<owner>/
// <repo>…` (install commands, links to files), its raw files `https://raw.githubusercontent.com/<owner>/<repo>/…` and
// its gallery `https://<owner>.github.io/<repo>/`. Owners compare in any case, as GitHub reads them. Other
// repositories, the owner's other projects included, and a name outside a URL (`the old repository,
// acme/old-kit`), pass.
//
// It reads every file git tracks or would add (not ignored), or every file under --root outside dependencies and
// build output when that is not a git checkout. CHANGELOG.md's released sections (from the first `## [X.Y.Z]`
// heading) are history and are not read, except its link references (`[0.1.0]: https://…`), which must still work.
//
// A rename adds the old `owner/repo` to tools/kit-former-names.json.
//
//   node tools/name-check.mjs                 # this repository
//   node tools/name-check.mjs --root <dir>    # another kit (the tests' scratch kits)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { kitIdentity, repoRoot } from './kit-identity.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? '') : repoRoot;

let kit;
try {
    kit = kitIdentity(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')));
} catch (error) {
    console.error(`name-check: ${error.message}`);
    process.exit(1);
}

// dependencies and build output, never the kit's own text
const skipped = new Set(['.git', 'node_modules', 'vendor', 'var', 'test-results', 'playwright-report', 'playwright-results']);

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (skipped.has(entry.name)) {
            return [];
        }
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : entry.isFile() ? [relative(root, path)] : [];
    });
}

function files() {
    if (existsSync(join(root, '.git'))) {
        const listed = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
        return listed.split('\0').filter((path) => path && !path.split('/').some((part) => skipped.has(part)));
    }
    return walk(root);
}

const owner = kit.owner.toLowerCase();
const repo = kit.repo;
const formerFile = join(root, 'tools', 'kit-former-names.json');
const former = new Set(
    (existsSync(formerFile) ? JSON.parse(readFileSync(formerFile, 'utf8')) : []).map((slug) => {
        const [o = '', r = ''] = String(slug).split('/');
        return `${o.toLowerCase()}/${r.toLowerCase()}`;
    }),
);
// [the URL as written, its owner, its repository name]
const patterns = [
    /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/g,
    /https?:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/g,
];
const pages = /https?:\/\/([A-Za-z0-9-]+)\.github\.io\/([A-Za-z0-9._-]+)/g;

/** The URLs of `line` that name a former repository of the kit, or the current one in another case. */
function stale(line) {
    const found = [];
    const consider = (url, urlOwner, urlRepo) => {
        const name = urlRepo.replace(/\.git$/, '').replace(/\.+$/, '');
        const slug = `${urlOwner.toLowerCase()}/${name.toLowerCase()}`;
        const miscased = urlOwner.toLowerCase() === owner && name.toLowerCase() === repo.toLowerCase() && name !== repo;
        if (former.has(slug) || miscased) {
            found.push(url);
        }
    };
    for (const pattern of patterns) {
        for (const match of line.matchAll(pattern)) {
            consider(match[0], match[1], match[2]);
        }
    }
    for (const match of line.matchAll(pages)) {
        consider(match[0], match[1], match[2]);
    }
    return found;
}

const problems = [];
for (const path of files().sort()) {
    const absolute = join(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        continue; // deleted in the working tree
    }
    const content = readFileSync(absolute);
    if (content.includes(0)) {
        continue; // binary
    }
    let history = false;
    content.toString('utf8').split('\n').forEach((line, index) => {
        if (path === 'CHANGELOG.md') {
            history ||= /^## \[\d+\.\d+\.\d+\]/.test(line);
            if (history && !/^\[[^\]]+\]: /.test(line)) {
                return;
            }
        }
        for (const url of stale(line)) {
            problems.push(`${path}:${index + 1}: ${url}`);
        }
    });
}

if (problems.length > 0) {
    console.error(`URLs of the kit's repository that are not manifest.json's homepage (${kit.homepage}):`);
    for (const problem of problems) {
        console.error(`  ${problem}`);
    }
    console.error('Point each one at the homepage (its owner and repository name, as written there).');
    process.exit(1);
}
console.log(`name-check: every URL of the kit's repository is ${kit.homepage} (${kit.name}).`);
